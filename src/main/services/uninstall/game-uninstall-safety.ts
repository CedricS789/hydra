import fs from "node:fs";
import path from "node:path";
import type { Game, GameUninstallSafetyBlock } from "@types";
import { isUnsafePath } from "../../events/helpers/find-game-root.js";

const GENERIC_CONTAINER_NAMES = new Set([
  "games",
  "game",
  "roms",
  "rom",
  "portable",
  "apps",
  "software",
  "programs",
  "drive_c",
  "steamlibrary",
  "epic games",
  "gog games",
  "repacks",
  "hydra",
  "common files",
  "x86",
  "x64",
]);

const LINUX_SYSTEM_ROOTS = new Set([
  "/",
  "/bin",
  "/boot",
  "/dev",
  "/etc",
  "/home",
  "/lib",
  "/lib64",
  "/media",
  "/mnt",
  "/opt",
  "/proc",
  "/root",
  "/run",
  "/sbin",
  "/srv",
  "/sys",
  "/tmp",
  "/usr",
  "/usr/bin",
  "/usr/local",
  "/usr/local/bin",
  "/var",
  "/var/lib",
]);

export interface UninstallSafetyContext {
  protectedRoots: string[];
  platform?: NodeJS.Platform;
}

export const normalizeComparablePath = (
  targetPath: string,
  platform: NodeJS.Platform = process.platform
): string => {
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  const resolved = pathApi.resolve(targetPath);
  const parsed = pathApi.parse(resolved);
  let trimmed = resolved;
  while (trimmed.length > parsed.root.length && trimmed.endsWith(pathApi.sep)) {
    trimmed = trimmed.slice(0, -1);
  }
  return platform === "win32" ? trimmed.toLowerCase() : trimmed;
};

export const isPathWithin = (
  candidatePath: string,
  parentDir: string,
  platform: NodeJS.Platform = process.platform
): boolean => {
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  const normalizedCandidate = normalizeComparablePath(candidatePath, platform);
  const normalizedParent = normalizeComparablePath(parentDir, platform);

  if (normalizedCandidate === normalizedParent) return true;

  const prefix = normalizedParent.endsWith(pathApi.sep)
    ? normalizedParent
    : `${normalizedParent}${pathApi.sep}`;

  return normalizedCandidate.startsWith(prefix);
};

const isDirectChildOfProtectedOrDriveRoot = (
  normalizedDir: string,
  normalizedProtectedRoots: string[],
  platform: NodeJS.Platform
): boolean => {
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  const parent = pathApi.dirname(normalizedDir);
  if (parent === normalizedDir) return true;

  const parsedParent = pathApi.parse(parent);
  if (parent === parsedParent.root) return true;

  return normalizedProtectedRoots.includes(parent);
};

export const isUnsafeUninstallPath = (
  dirPath: string,
  context: UninstallSafetyContext
): boolean => {
  const platform = context.platform ?? process.platform;
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  const normalizedDir = normalizeComparablePath(dirPath, platform);
  const normalizedProtected = context.protectedRoots
    .filter(Boolean)
    .map((root) => normalizeComparablePath(root, platform));

  if (isUnsafePath(dirPath)) return true;

  if (platform !== "win32" && LINUX_SYSTEM_ROOTS.has(normalizedDir)) {
    return true;
  }

  for (const protectedRoot of normalizedProtected) {
    // Never delete a protected root or any ancestor directory containing it.
    if (
      normalizedDir === protectedRoot ||
      isPathWithin(protectedRoot, normalizedDir, platform)
    ) {
      return true;
    }
  }

  const baseName = pathApi.basename(normalizedDir).toLowerCase();
  if (
    GENERIC_CONTAINER_NAMES.has(baseName) &&
    isDirectChildOfProtectedOrDriveRoot(
      normalizedDir,
      normalizedProtected,
      platform
    )
  ) {
    return true;
  }

  return false;
};

export const findConflictingLibraryGame = (
  candidateDirs: string[],
  targetGame: Pick<Game, "shop" | "objectId">,
  allGames: readonly Game[],
  platform: NodeJS.Platform = process.platform
): Game | null => {
  for (const other of allGames) {
    if (other.isDeleted) continue;
    if (
      other.shop === targetGame.shop &&
      other.objectId === targetGame.objectId
    ) {
      continue;
    }

    const otherPaths = [
      other.executablePath,
      ...(other.trackingExecutablePaths ?? []),
      ...(other.discs?.map((disc) => disc.path) ?? []),
    ].filter((value): value is string => Boolean(value));

    const hasConflict = otherPaths.some((otherPath) =>
      candidateDirs.some((dir) => isPathWithin(otherPath, dir, platform))
    );

    if (hasConflict) return other;
  }

  return null;
};

export interface DirectoryValidationResult {
  valid: boolean;
  resolvedPath: string | null;
  block: GameUninstallSafetyBlock | null;
}

export const validateUninstallDirectory = async (
  candidateDir: string,
  targetGame: Pick<Game, "shop" | "objectId" | "executablePath">,
  allGames: readonly Game[],
  context: UninstallSafetyContext
): Promise<DirectoryValidationResult> => {
  const platform = context.platform ?? process.platform;

  if (!candidateDir || !path.isAbsolute(candidateDir)) {
    return {
      valid: false,
      resolvedPath: null,
      block: { reason: "unsafe-path", details: candidateDir },
    };
  }

  if (targetGame.shop === "launchbox") {
    return {
      valid: false,
      resolvedPath: null,
      block: { reason: "unsafe-path", details: candidateDir },
    };
  }

  if (
    targetGame.executablePath &&
    !isPathWithin(targetGame.executablePath, candidateDir, platform)
  ) {
    return {
      valid: false,
      resolvedPath: null,
      block: { reason: "unsafe-path", details: candidateDir },
    };
  }

  if (isUnsafeUninstallPath(candidateDir, context)) {
    return {
      valid: false,
      resolvedPath: null,
      block: { reason: "unsafe-path", details: candidateDir },
    };
  }

  const stat = await fs.promises.lstat(candidateDir).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  });

  if (!stat) {
    return {
      valid: false,
      resolvedPath: null,
      block: { reason: "missing-files", details: candidateDir },
    };
  }

  if (stat.isSymbolicLink()) {
    return {
      valid: false,
      resolvedPath: null,
      block: { reason: "symlink-target", details: candidateDir },
    };
  }

  if (!stat.isDirectory()) {
    return {
      valid: false,
      resolvedPath: null,
      block: { reason: "unsafe-path", details: candidateDir },
    };
  }

  const realDir = await fs.promises
    .realpath(candidateDir)
    .catch(() => candidateDir);

  if (isUnsafeUninstallPath(realDir, context)) {
    return {
      valid: false,
      resolvedPath: null,
      block: { reason: "unsafe-path", details: realDir },
    };
  }

  const conflict = findConflictingLibraryGame(
    [candidateDir, realDir],
    targetGame,
    allGames,
    platform
  );

  if (conflict) {
    return {
      valid: false,
      resolvedPath: null,
      block: { reason: "shared-with-other-game", details: conflict.title },
    };
  }

  return {
    valid: true,
    resolvedPath: realDir,
    block: null,
  };
};

export interface WinePrefixIsolationOptions {
  targetGame: Pick<Game, "shop" | "objectId" | "winePrefixPath">;
  effectivePrefixPath: string | null;
  legacyDefaultPrefixPath: string | null;
  homeDir: string;
  envWinePrefix?: string | null;
  allGames: readonly Game[];
  resolveEffectivePrefixForGame: (game: Game) => string | null;
  validatePrefix: (prefixPath: string) => boolean;
  context: UninstallSafetyContext;
}

export const resolveIsolatedWinePrefixForUninstall = async (
  options: WinePrefixIsolationOptions
): Promise<string | null> => {
  const {
    targetGame,
    effectivePrefixPath,
    legacyDefaultPrefixPath,
    homeDir,
    envWinePrefix,
    allGames,
    resolveEffectivePrefixForGame,
    validatePrefix,
    context,
  } = options;
  const platform = context.platform ?? process.platform;

  if (platform !== "linux" || !effectivePrefixPath) return null;
  if (!path.isAbsolute(effectivePrefixPath)) return null;

  const sharedDefaults = [
    legacyDefaultPrefixPath,
    path.join(homeDir, ".wine"),
    envWinePrefix ?? null,
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => normalizeComparablePath(value, platform));

  const normalizedPrefix = normalizeComparablePath(
    effectivePrefixPath,
    platform
  );
  if (sharedDefaults.includes(normalizedPrefix)) return null;

  if (isUnsafeUninstallPath(effectivePrefixPath, context)) return null;

  const stat = await fs.promises
    .lstat(effectivePrefixPath)
    .catch(() => null);
  if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) return null;

  if (!validatePrefix(effectivePrefixPath)) return null;

  const realPrefix = await fs.promises
    .realpath(effectivePrefixPath)
    .catch(() => effectivePrefixPath);
  const normalizedReal = normalizeComparablePath(realPrefix, platform);

  if (
    sharedDefaults.includes(normalizedReal) ||
    isUnsafeUninstallPath(realPrefix, context)
  ) {
    return null;
  }

  for (const other of allGames) {
    if (other.isDeleted) continue;
    if (
      other.shop === targetGame.shop &&
      other.objectId === targetGame.objectId
    ) {
      continue;
    }

    const otherPrefix = resolveEffectivePrefixForGame(other);
    if (!otherPrefix) continue;

    const normalizedOther = normalizeComparablePath(otherPrefix, platform);
    if (
      normalizedOther === normalizedPrefix ||
      normalizedOther === normalizedReal
    ) {
      return null;
    }
  }

  return realPrefix;
};
