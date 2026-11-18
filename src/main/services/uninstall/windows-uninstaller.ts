import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { NativeUninstallerInfo } from "@types";
import {
  isPathWithin,
  normalizeComparablePath,
} from "./game-uninstall-safety.js";

const execFileAsync = promisify(execFile);

const UNINSTALLER_FILENAME_PATTERNS = [
  /^unins\d{3}\.exe$/i,
  /^uninstall\.exe$/i,
  /^uninst\.exe$/i,
];

const UNINSTALL_REG_KEYS = [
  String.raw`HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall`,
  String.raw`HKLM\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall`,
  String.raw`HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall`,
];

const MSI_GUID_REGEX =
  /\{[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}\}/i;

const SHELL_METACHARACTERS = /[&|;<>`$\r\n]/;

export interface ParsedRegistryUninstallEntry {
  keyPath: string;
  displayName?: string;
  installLocation?: string;
  displayIcon?: string;
  uninstallString?: string;
  quietUninstallString?: string;
  systemComponent?: string;
}

const getUninstallerPriority = (fileName: string): number => {
  const index = UNINSTALLER_FILENAME_PATTERNS.findIndex((pattern) =>
    pattern.test(fileName)
  );
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
};

const isRegularNonSymlinkFile = async (filePath: string): Promise<boolean> => {
  const stat = await fs.promises.lstat(filePath).catch(() => null);
  return Boolean(stat && stat.isFile() && !stat.isSymbolicLink());
};

export const findInFolderUninstaller = async (
  gameRoot: string,
  executablePath?: string | null
): Promise<NativeUninstallerInfo | null> => {
  const searchDirs = [gameRoot];
  if (executablePath) {
    const exeDir = path.dirname(executablePath);
    if (
      isPathWithin(exeDir, gameRoot) &&
      normalizeComparablePath(exeDir) !== normalizeComparablePath(gameRoot)
    ) {
      searchDirs.push(exeDir);
    }
  }

  for (const dir of searchDirs) {
    const entries = await fs.promises
      .readdir(dir, { withFileTypes: true })
      .catch(() => []);

    const candidates = entries
      .filter((entry) => getUninstallerPriority(entry.name) !== Number.MAX_SAFE_INTEGER)
      .sort(
        (a, b) =>
          getUninstallerPriority(a.name) - getUninstallerPriority(b.name) ||
          a.name.localeCompare(b.name)
      );

    for (const candidate of candidates) {
      const fullPath = path.join(dir, candidate.name);
      if (await isRegularNonSymlinkFile(fullPath)) {
        return {
          kind: "in-folder",
          label: candidate.name,
          executablePath: fullPath,
          args: [],
          requiresElevationHint: true,
        };
      }
    }
  }

  return null;
};

export const parseRegQueryOutput = (
  output: string
): ParsedRegistryUninstallEntry[] => {
  const entries: ParsedRegistryUninstallEntry[] = [];
  let current: ParsedRegistryUninstallEntry | null = null;

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line.trim()) continue;

    if (!rawLine.startsWith(" ") && !rawLine.startsWith("\t")) {
      if (current) entries.push(current);
      current = { keyPath: line.trim() };
      continue;
    }

    if (!current) continue;

    const match = /^\s+([^\s]+(?:\s+[^\s]+)*?)\s+REG_(?:SZ|EXPAND_SZ|DWORD)\s+(.*)$/.exec(
      rawLine
    );
    if (!match) continue;

    const valueName = match[1].trim().toLowerCase();
    const valueData = match[2].trim();

    if (valueName === "displayname") current.displayName = valueData;
    else if (valueName === "installlocation")
      current.installLocation = valueData;
    else if (valueName === "displayicon") current.displayIcon = valueData;
    else if (valueName === "uninstallstring")
      current.uninstallString = valueData;
    else if (valueName === "quietuninstallstring")
      current.quietUninstallString = valueData;
    else if (valueName === "systemcomponent")
      current.systemComponent = valueData;
  }

  if (current) entries.push(current);
  return entries;
};

const splitCommandTokens = (raw: string): string[] | null => {
  const trimmed = raw.trim();
  if (!trimmed || SHELL_METACHARACTERS.test(trimmed)) return null;

  const tokens: string[] = [];
  let current = "";
  let inQuotes = false;

  for (const ch of trimmed) {
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (!inQuotes && /\s/.test(ch)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += ch;
  }

  if (inQuotes) return null;
  if (current.length > 0) tokens.push(current);

  return tokens;
};

const extractExecutableAndArgs = (
  rawCommand: string
): { executable: string; args: string[] } | null => {
  const trimmed = rawCommand.trim();
  if (!trimmed || SHELL_METACHARACTERS.test(trimmed)) return null;

  if (trimmed.startsWith('"')) {
    const tokens = splitCommandTokens(trimmed);
    if (!tokens || tokens.length === 0) return null;
    return { executable: tokens[0], args: tokens.slice(1) };
  }

  // Unquoted Windows paths may contain spaces before `.exe`, e.g. `C:\Program Files\Game\unins000.exe /SILENT`
  const exeBoundary = /^(.+?\.exe)(?:\s+(.*))?$/i.exec(trimmed);
  if (exeBoundary) {
    const executable = exeBoundary[1].trim();
    const rest = exeBoundary[2]?.trim() ?? "";
    const args = rest ? splitCommandTokens(rest) : [];
    if (args === null) return null;
    return { executable, args };
  }

  const tokens = splitCommandTokens(trimmed);
  if (!tokens || tokens.length === 0) return null;
  return { executable: tokens[0], args: tokens.slice(1) };
};

export const parseUninstallCommand = async (
  rawCommand: string,
  gameRoot: string,
  options: {
    displayName?: string;
    winDir?: string;
    fileExists?: (filePath: string) => Promise<boolean>;
    platform?: NodeJS.Platform;
  } = {}
): Promise<NativeUninstallerInfo | null> => {
  const platform = options.platform ?? "win32";
  const winDir = options.winDir ?? process.env.WINDIR ?? String.raw`C:\Windows`;
  const checkFile = options.fileExists ?? isRegularNonSymlinkFile;
  const trimmed = rawCommand.trim();

  if (!trimmed || SHELL_METACHARACTERS.test(trimmed)) return null;
  if (/^(steam|com\.epicgames\.launcher):\/\//i.test(trimmed)) return null;

  const parsed = extractExecutableAndArgs(trimmed);
  if (!parsed) return null;

  const exeBase = path.basename(parsed.executable).toLowerCase();
  if (exeBase === "msiexec" || exeBase === "msiexec.exe") {
    const joinedArgs = parsed.args.join(" ");
    const guidMatch = MSI_GUID_REGEX.exec(joinedArgs);
    if (!guidMatch) return null;

    return {
      kind: "registry-msi",
      label: options.displayName || "Windows Installer",
      executablePath: path.join(winDir, "System32", "msiexec.exe"),
      args: ["/x", guidMatch[0]],
      requiresElevationHint: true,
    };
  }

  if (!parsed.executable.toLowerCase().endsWith(".exe")) return null;
  if (!isPathWithin(parsed.executable, gameRoot, platform)) return null;
  if (!(await checkFile(parsed.executable))) return null;

  return {
    kind: "registry-exe",
    label: options.displayName || path.basename(parsed.executable),
    executablePath: parsed.executable,
    args: parsed.args,
    requiresElevationHint: true,
  };
};

const stripIconIndex = (displayIcon: string): string => {
  const cleaned = displayIcon.trim().replace(/^"(.*)"$/, "$1");
  return cleaned.replace(/,-?\d+$/, "").trim();
};

const cleanInstallLocation = (location: string): string =>
  location.trim().replace(/^"(.*)"$/, "$1");

const doesEntryOwnGameRoot = (
  entry: ParsedRegistryUninstallEntry,
  gameRoot: string,
  parsedCommand: NativeUninstallerInfo | null,
  platform: NodeJS.Platform
): boolean => {
  if (parsedCommand?.kind === "registry-exe") {
    return isPathWithin(parsedCommand.executablePath, gameRoot, platform);
  }

  if (entry.installLocation) {
    const cleanLoc = cleanInstallLocation(entry.installLocation);
    if (
      cleanLoc &&
      path.isAbsolute(cleanLoc) &&
      normalizeComparablePath(cleanLoc, platform) ===
        normalizeComparablePath(gameRoot, platform)
    ) {
      return true;
    }
  }

  if (entry.displayIcon) {
    const iconPath = stripIconIndex(entry.displayIcon);
    if (
      iconPath &&
      path.isAbsolute(iconPath) &&
      isPathWithin(iconPath, gameRoot, platform)
    ) {
      return true;
    }
  }

  return false;
};

export const matchRegistryUninstallerEntries = async (
  entries: readonly ParsedRegistryUninstallEntry[],
  gameRoot: string,
  options: {
    winDir?: string;
    fileExists?: (filePath: string) => Promise<boolean>;
    platform?: NodeJS.Platform;
  } = {}
): Promise<NativeUninstallerInfo | null> => {
  const platform = options.platform ?? "win32";

  for (const entry of entries) {
    if (entry.systemComponent === "1") continue;
    const rawCommand = entry.uninstallString;
    if (!rawCommand) continue;

    const parsedCommand = await parseUninstallCommand(rawCommand, gameRoot, {
      displayName: entry.displayName,
      winDir: options.winDir,
      fileExists: options.fileExists,
      platform,
    });
    if (!parsedCommand) continue;

    if (doesEntryOwnGameRoot(entry, gameRoot, parsedCommand, platform)) {
      return parsedCommand;
    }
  }

  return null;
};

const queryUninstallRegistryKey = async (
  keyPath: string
): Promise<ParsedRegistryUninstallEntry[]> => {
  try {
    const { stdout } = await execFileAsync("reg.exe", ["query", keyPath, "/s"], {
      windowsHide: true,
      timeout: 4000,
      maxBuffer: 10 * 1024 * 1024,
    });
    return parseRegQueryOutput(stdout);
  } catch {
    return [];
  }
};

export const findRegistryUninstaller = async (
  gameRoot: string,
  platform: NodeJS.Platform = process.platform
): Promise<NativeUninstallerInfo | null> => {
  if (platform !== "win32") return null;

  const entryBatches = await Promise.all(
    UNINSTALL_REG_KEYS.map((key) => queryUninstallRegistryKey(key))
  );

  return matchRegistryUninstallerEntries(entryBatches.flat(), gameRoot, {
    platform,
  });
};

export const detectNativeUninstaller = async (
  gameRoot: string,
  executablePath?: string | null,
  platform: NodeJS.Platform = process.platform
): Promise<NativeUninstallerInfo | null> => {
  const inFolder = await findInFolderUninstaller(gameRoot, executablePath);
  if (inFolder) return inFolder;

  return findRegistryUninstaller(gameRoot, platform);
};
