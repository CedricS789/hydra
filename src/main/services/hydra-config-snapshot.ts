import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type {
  DownloadSource,
  EmulatorConfig,
  EmulatorSystem,
  ExcludedLibraryGame,
  Game,
  LudusaviGameSettings,
  LudusaviLocalSettings,
  RetroArchConfig,
  Theme,
  UserPreferences,
} from "@types";
import type { SourceWebsiteProfile } from "../../types/source-browser.types";
import {
  ALL_HYDRA_CONFIG_SECTION_IDS,
  HYDRA_CONFIG_MAX_ASSET_BYTES,
  HYDRA_CONFIG_MAX_TOTAL_SNAPSHOT_BYTES,
  HYDRA_CONFIG_SECTIONS,
  HYDRA_CONFIG_SNAPSHOT_SCHEMA,
  mergePreservedSecretUserPreferences,
  stripSecretUserPreferences,
  type HydraConfigPathWarning,
  type HydraConfigRestoreSelection,
  type HydraConfigSectionDiff,
  type HydraConfigSectionId,
} from "../../shared/hydra-config-backup.js";
import {
  settingsValueEqual,
  reviewSettings,
} from "../../shared/settings-changes.js";
import {
  allowsDirectTorrent,
  validateDirectTorrentChange,
} from "../../shared/direct-torrent-policy.js";
import { parseSaveEngineConfig } from "./ludusavi-local-config.js";

const ALLOWED_THEME_SOUND_EXTS = new Set([".wav", ".mp3", ".ogg", ".m4a"]);

export interface HydraConfigSnapshotManifest {
  schemaVersion: number;
  exportedAt: string;
  appVersion: string;
  hostname: string;
  platform: string;
  files: Record<string, { sha256: string; bytes: number }>;
}

export interface HydraConfigThemeEntry {
  theme: Theme;
  assetFile?: string;
}

export interface HydraConfigData {
  preferences: {
    language: string | null;
    preferences: UserPreferences;
  };
  ludusavi: {
    settings: LudusaviLocalSettings;
    advancedYaml: string | null;
  };
  downloadSources: DownloadSource[];
  emulators: {
    emulators: [EmulatorSystem, EmulatorConfig][];
    retroarch: [string, RetroArchConfig][];
    emulatorDestinations: [string, unknown][];
  };
  themes: {
    themes: HydraConfigThemeEntry[];
  };
  sourceProfiles: Record<string, SourceWebsiteProfile>;
  library: {
    games: [string, Game][];
    excludedGames: [string, ExcludedLibraryGame][];
    cloudSaveCustomPaths: [string, unknown][];
    cloudSaveAutomaticSync: [string, boolean][];
  };
}

export interface ValidatedHydraConfigSnapshot {
  manifest: HydraConfigSnapshotManifest;
  data: HydraConfigData;
  rootDir: string;
}

export interface HydraConfigStoreAdapter {
  appVersion: string;
  hostname: string;
  platform: string;
  now?: () => number;
  pathExists?: (targetPath: string) => Promise<boolean>;
  getUserPreferences(): Promise<UserPreferences | null>;
  putUserPreferences(value: UserPreferences): Promise<void>;
  getLanguage(): Promise<string | null>;
  putLanguage(language: string): Promise<void>;
  getLudusaviSettings(): Promise<LudusaviLocalSettings>;
  putLudusaviSettings(value: LudusaviLocalSettings): Promise<void>;
  readAdvancedYaml(): Promise<string | null>;
  writeAdvancedYaml(yamlText: string | null): Promise<void>;
  getDownloadSources(): Promise<DownloadSource[]>;
  replaceDownloadSources(items: DownloadSource[]): Promise<void>;
  getEmulators(): Promise<[EmulatorSystem, EmulatorConfig][]>;
  replaceEmulators(entries: [EmulatorSystem, EmulatorConfig][]): Promise<void>;
  getRetroArch(): Promise<[string, RetroArchConfig][]>;
  replaceRetroArch(entries: [string, RetroArchConfig][]): Promise<void>;
  getEmulatorDestinations(): Promise<[string, unknown][]>;
  replaceEmulatorDestinations(entries: [string, unknown][]): Promise<void>;
  getThemes(): Promise<Theme[]>;
  replaceThemes(themes: Theme[]): Promise<void>;
  resolveThemeSoundPath(theme: Theme): string | null;
  installThemeSoundAsset(theme: Theme, sourceFile: string): Promise<void>;
  getSourceProfiles(): Promise<Record<string, SourceWebsiteProfile>>;
  putSourceProfiles(
    profiles: Record<string, SourceWebsiteProfile>
  ): Promise<void>;
  getGames(): Promise<[string, Game][]>;
  replaceGames(entries: [string, Game][]): Promise<void>;
  getExcludedGames(): Promise<[string, ExcludedLibraryGame][]>;
  replaceExcludedGames(entries: [string, ExcludedLibraryGame][]): Promise<void>;
  getCloudSaveCustomPaths(): Promise<[string, unknown][]>;
  replaceCloudSaveCustomPaths(entries: [string, unknown][]): Promise<void>;
  getCloudSaveAutomaticSync(): Promise<[string, boolean][]>;
  replaceCloudSaveAutomaticSync(entries: [string, boolean][]): Promise<void>;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const sha256 = (data: Buffer | string) =>
  createHash("sha256").update(data).digest("hex");

const sanitizeAssetFolderSegment = (value: string) =>
  value.replaceAll(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) || "theme";

const defaultPathExists = (targetPath: string) =>
  fs
    .stat(targetPath)
    .then(() => true)
    .catch(() => false);

export function validateSnapshotLudusaviSettings(
  value: unknown
): asserts value is LudusaviLocalSettings {
  if (!isPlainObject(value)) {
    throw new Error("Invalid Ludusavi configuration in snapshot.");
  }
  const candidate = value as unknown as LudusaviLocalSettings;
  if (
    typeof candidate.enabled !== "boolean" ||
    typeof candidate.destination !== "string" ||
    !path.isAbsolute(candidate.destination) ||
    !Number.isInteger(candidate.fullRetention) ||
    candidate.fullRetention < 1 ||
    candidate.fullRetention > 255 ||
    !Number.isInteger(candidate.exitDelaySeconds) ||
    candidate.exitDelaySeconds < 5 ||
    candidate.exitDelaySeconds > 300 ||
    !isPlainObject(candidate.games) ||
    (candidate.differentialRetention !== undefined &&
      (!Number.isInteger(candidate.differentialRetention) ||
        candidate.differentialRetention < 0 ||
        candidate.differentialRetention > 255)) ||
    (candidate.format !== undefined &&
      !["zip", "simple"].includes(candidate.format)) ||
    (candidate.compression !== undefined &&
      !["none", "deflate", "bzip2", "zstd"].includes(candidate.compression))
  ) {
    throw new Error("Invalid Ludusavi settings values in snapshot.");
  }
  for (const game of Object.values(candidate.games)) {
    if (!isPlainObject(game)) {
      throw new Error("Invalid per-game Ludusavi rule in snapshot.");
    }
    const g = game as unknown as LudusaviGameSettings;
    if (
      typeof g.enabled !== "boolean" ||
      !Array.isArray(g.savePaths) ||
      !Array.isArray(g.trackingPaths) ||
      (g.manifestTitle !== undefined &&
        (typeof g.manifestTitle !== "string" ||
          !g.manifestTitle.trim() ||
          g.manifestTitle.length > 1000)) ||
      (g.steamId !== undefined &&
        (typeof g.steamId !== "string" ||
          !/^\d+$/.test(g.steamId) ||
          Number(g.steamId) < 1 ||
          Number(g.steamId) > 4294967295)) ||
      [...g.savePaths, ...g.trackingPaths].some(
        (p) => typeof p !== "string" || !path.isAbsolute(p) || /[?*]/.test(p)
      )
    ) {
      throw new Error("Invalid per-game Ludusavi paths in snapshot.");
    }
  }
}

function assertTupleArray(value: unknown, label: string): [string, unknown][] {
  if (
    !Array.isArray(value) ||
    value.some(
      (entry) =>
        !Array.isArray(entry) ||
        entry.length !== 2 ||
        typeof entry[0] !== "string" ||
        !entry[0]
    )
  ) {
    throw new Error(`Invalid ${label} structure in snapshot.`);
  }
  return value as [string, unknown][];
}

async function readConfinedRegularFile(rootReal: string, relPath: string) {
  if (
    !relPath ||
    relPath.includes("\\") ||
    path.posix.isAbsolute(relPath) ||
    relPath
      .split("/")
      .some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error(`Unsafe snapshot file path: ${relPath}`);
  }
  const target = path.join(rootReal, ...relPath.split("/"));
  const stat = await fs.lstat(target);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`Snapshot entry is not a regular file: ${relPath}`);
  }
  const actual = await fs.realpath(target);
  const relative = path.relative(rootReal, actual);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`Snapshot entry escapes root directory: ${relPath}`);
  }
  return { target: actual, stat };
}

export async function readLiveHydraConfig(
  adapter: HydraConfigStoreAdapter
): Promise<HydraConfigData> {
  const [
    rawPrefs,
    language,
    ludusaviSettings,
    advancedYaml,
    downloadSources,
    emulators,
    retroarch,
    emulatorDestinations,
    themes,
    sourceProfiles,
    games,
    excludedGames,
    cloudSaveCustomPaths,
    cloudSaveAutomaticSync,
  ] = await Promise.all([
    adapter.getUserPreferences(),
    adapter.getLanguage(),
    adapter.getLudusaviSettings(),
    adapter.readAdvancedYaml(),
    adapter.getDownloadSources(),
    adapter.getEmulators(),
    adapter.getRetroArch(),
    adapter.getEmulatorDestinations(),
    adapter.getThemes(),
    adapter.getSourceProfiles(),
    adapter.getGames(),
    adapter.getExcludedGames(),
    adapter.getCloudSaveCustomPaths(),
    adapter.getCloudSaveAutomaticSync(),
  ]);

  return {
    preferences: {
      language,
      preferences: stripSecretUserPreferences(rawPrefs),
    },
    ludusavi: {
      settings: ludusaviSettings,
      advancedYaml,
    },
    downloadSources: [...downloadSources].sort((a, b) =>
      a.id.localeCompare(b.id)
    ),
    emulators: {
      emulators: [...emulators].sort(([a], [b]) => a.localeCompare(b)),
      retroarch: [...retroarch].sort(([a], [b]) => a.localeCompare(b)),
      emulatorDestinations: [...emulatorDestinations].sort(([a], [b]) =>
        a.localeCompare(b)
      ),
    },
    themes: {
      themes: [...themes]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((theme) => ({ theme })),
    },
    sourceProfiles,
    library: {
      games: [...games].sort(([a], [b]) => a.localeCompare(b)),
      excludedGames: [...excludedGames].sort(([a], [b]) => a.localeCompare(b)),
      cloudSaveCustomPaths: [...cloudSaveCustomPaths].sort(([a], [b]) =>
        a.localeCompare(b)
      ),
      cloudSaveAutomaticSync: [...cloudSaveAutomaticSync].sort(([a], [b]) =>
        a.localeCompare(b)
      ),
    },
  };
}

export async function writeHydraConfigSnapshotToDir(
  adapter: HydraConfigStoreAdapter,
  targetDir: string
): Promise<{
  manifest: HydraConfigSnapshotManifest;
  files: number;
  bytes: number;
}> {
  const now = adapter.now ?? (() => Date.now());
  const data = await readLiveHydraConfig(adapter);
  const parentDir = path.dirname(targetDir);
  await fs.mkdir(parentDir, { recursive: true });
  const pendingDir = `${targetDir}.pending-${randomUUID()}`;
  const oldDir = `${targetDir}.old-${randomUUID()}`;
  await fs.mkdir(pendingDir, { recursive: true });

  const fileManifest: Record<string, { sha256: string; bytes: number }> = {};
  let totalBytes = 0;

  const writeSnapshotFile = async (
    relPath: string,
    content: Buffer | string
  ) => {
    const buffer =
      typeof content === "string" ? Buffer.from(content, "utf8") : content;
    totalBytes += buffer.byteLength;
    if (totalBytes > HYDRA_CONFIG_MAX_TOTAL_SNAPSHOT_BYTES) {
      throw new Error("Hydra configuration snapshot exceeds the 64 MiB limit.");
    }
    const fullPath = path.join(pendingDir, ...relPath.split("/"));
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, buffer);
    fileManifest[relPath] = {
      sha256: sha256(buffer),
      bytes: buffer.byteLength,
    };
  };

  try {
    const themeEntries: HydraConfigThemeEntry[] = [];
    for (const item of data.themes.themes) {
      const soundPath = adapter.resolveThemeSoundPath(item.theme);
      let assetFile: string | undefined;
      if (soundPath) {
        const stat = await fs.lstat(soundPath).catch(() => null);
        const ext = path.extname(soundPath).toLowerCase();
        if (
          stat &&
          !stat.isSymbolicLink() &&
          stat.isFile() &&
          stat.size <= HYDRA_CONFIG_MAX_ASSET_BYTES &&
          ALLOWED_THEME_SOUND_EXTS.has(ext)
        ) {
          assetFile = `themes-assets/${sanitizeAssetFolderSegment(item.theme.id)}/achievement${ext}`;
          await writeSnapshotFile(assetFile, await fs.readFile(soundPath));
        }
      }
      themeEntries.push({
        theme: item.theme,
        ...(assetFile ? { assetFile } : {}),
      });
    }

    await writeSnapshotFile(
      "preferences.json",
      JSON.stringify(data.preferences, null, 2)
    );
    await writeSnapshotFile(
      "ludusavi-settings.json",
      JSON.stringify(data.ludusavi.settings, null, 2)
    );
    if (data.ludusavi.advancedYaml !== null) {
      await writeSnapshotFile(
        "ludusavi-advanced.yaml",
        data.ludusavi.advancedYaml
      );
    }
    await writeSnapshotFile(
      "download-sources.json",
      JSON.stringify(data.downloadSources, null, 2)
    );
    await writeSnapshotFile(
      "emulators.json",
      JSON.stringify(data.emulators, null, 2)
    );
    await writeSnapshotFile(
      "themes.json",
      JSON.stringify({ themes: themeEntries }, null, 2)
    );
    await writeSnapshotFile(
      "source-profiles.json",
      JSON.stringify(data.sourceProfiles, null, 2)
    );
    await writeSnapshotFile(
      "library.json",
      JSON.stringify(data.library, null, 2)
    );

    const manifest: HydraConfigSnapshotManifest = {
      schemaVersion: HYDRA_CONFIG_SNAPSHOT_SCHEMA,
      exportedAt: new Date(now()).toISOString(),
      appVersion: adapter.appVersion,
      hostname: adapter.hostname,
      platform: adapter.platform,
      files: fileManifest,
    };
    const manifestBuffer = Buffer.from(
      JSON.stringify(manifest, null, 2),
      "utf8"
    );
    await fs.writeFile(path.join(pendingDir, "manifest.json"), manifestBuffer);

    const renameWithRetry = async (from: string, to: string) => {
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          await fs.rename(from, to);
          return;
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if ((code === "EPERM" || code === "EBUSY") && attempt < 4) {
            await new Promise((resolve) =>
              setTimeout(resolve, 25 * (attempt + 1))
            );
            continue;
          }
          throw error;
        }
      }
    };

    const hadExisting = await defaultPathExists(targetDir);
    if (hadExisting) {
      await renameWithRetry(targetDir, oldDir);
    }
    try {
      await renameWithRetry(pendingDir, targetDir);
    } catch (error) {
      if (hadExisting) {
        await renameWithRetry(oldDir, targetDir).catch(() => undefined);
      }
      throw error;
    }
    if (hadExisting) {
      await fs
        .rm(oldDir, { recursive: true, force: true })
        .catch(() => undefined);
    }

    return {
      manifest,
      files: Object.keys(fileManifest).length + 1,
      bytes: totalBytes + manifestBuffer.byteLength,
    };
  } catch (error) {
    await fs
      .rm(pendingDir, { recursive: true, force: true })
      .catch(() => undefined);
    throw error;
  }
}

export async function readAndValidateHydraConfigSnapshot(
  dir: string
): Promise<ValidatedHydraConfigSnapshot> {
  const rootReal = await fs.realpath(dir);
  const manifestPath = (
    await readConfinedRegularFile(rootReal, "manifest.json")
  ).target;
  const manifestRaw = await fs.readFile(manifestPath);
  if (manifestRaw.byteLength > 1024 * 1024) {
    throw new Error("Snapshot manifest exceeds size limits.");
  }
  const manifest = JSON.parse(
    manifestRaw.toString("utf8")
  ) as HydraConfigSnapshotManifest;
  if (
    !isPlainObject(manifest) ||
    manifest.schemaVersion !== HYDRA_CONFIG_SNAPSHOT_SCHEMA ||
    !isPlainObject(manifest.files) ||
    typeof manifest.exportedAt !== "string"
  ) {
    throw new Error("Unsupported or malformed Hydra configuration snapshot.");
  }

  let totalBytes = 0;
  const buffers = new Map<string, Buffer>();
  for (const [relPath, entry] of Object.entries(manifest.files)) {
    if (
      !isPlainObject(entry) ||
      typeof entry.sha256 !== "string" ||
      !Number.isInteger(entry.bytes) ||
      entry.bytes < 0
    ) {
      throw new Error(`Invalid manifest metadata for ${relPath}.`);
    }
    totalBytes += entry.bytes;
    if (totalBytes > HYDRA_CONFIG_MAX_TOTAL_SNAPSHOT_BYTES) {
      throw new Error("Snapshot exceeds maximum allowed size.");
    }
    const { target, stat } = await readConfinedRegularFile(rootReal, relPath);
    if (stat.size !== entry.bytes) {
      throw new Error(`Snapshot file size mismatch: ${relPath}`);
    }
    const buf = await fs.readFile(target);
    if (buf.byteLength !== entry.bytes || sha256(buf) !== entry.sha256) {
      throw new Error(`Snapshot file checksum mismatch: ${relPath}`);
    }
    buffers.set(relPath, buf);
  }

  const readJson = <T>(relPath: string): T => {
    const buf = buffers.get(relPath);
    if (!buf) throw new Error(`Missing snapshot file: ${relPath}`);
    return JSON.parse(buf.toString("utf8")) as T;
  };

  const prefsPayload = readJson<{
    language?: unknown;
    preferences?: unknown;
  }>("preferences.json");
  if (
    !isPlainObject(prefsPayload) ||
    (prefsPayload.language !== null &&
      prefsPayload.language !== undefined &&
      typeof prefsPayload.language !== "string") ||
    !isPlainObject(prefsPayload.preferences)
  ) {
    throw new Error("Invalid preferences.json in snapshot.");
  }

  const ludusaviSettings = readJson<unknown>("ludusavi-settings.json");
  validateSnapshotLudusaviSettings(ludusaviSettings);

  let advancedYaml: string | null = null;
  if (buffers.has("ludusavi-advanced.yaml")) {
    advancedYaml = buffers.get("ludusavi-advanced.yaml")!.toString("utf8");
    parseSaveEngineConfig(advancedYaml);
  }

  const downloadSources = readJson<unknown>("download-sources.json");
  if (
    !Array.isArray(downloadSources) ||
    downloadSources.some(
      (item) =>
        !isPlainObject(item) ||
        typeof item.id !== "string" ||
        typeof item.url !== "string" ||
        typeof item.name !== "string"
    )
  ) {
    throw new Error("Invalid download-sources.json in snapshot.");
  }

  const emulatorsRaw = readJson<unknown>("emulators.json");
  if (!isPlainObject(emulatorsRaw)) {
    throw new Error("Invalid emulators.json in snapshot.");
  }
  const emulators = assertTupleArray(emulatorsRaw.emulators, "emulators") as [
    EmulatorSystem,
    EmulatorConfig,
  ][];
  const retroarch = assertTupleArray(emulatorsRaw.retroarch, "retroarch") as [
    string,
    RetroArchConfig,
  ][];
  const emulatorDestinations = assertTupleArray(
    emulatorsRaw.emulatorDestinations,
    "emulatorDestinations"
  );

  const themesRaw = readJson<unknown>("themes.json");
  if (!isPlainObject(themesRaw) || !Array.isArray(themesRaw.themes)) {
    throw new Error("Invalid themes.json in snapshot.");
  }
  for (const item of themesRaw.themes) {
    if (
      !isPlainObject(item) ||
      !isPlainObject(item.theme) ||
      typeof item.theme.id !== "string" ||
      typeof item.theme.name !== "string"
    ) {
      throw new Error("Invalid theme entry in snapshot.");
    }
    if (item.assetFile !== undefined) {
      if (
        typeof item.assetFile !== "string" ||
        !item.assetFile.startsWith("themes-assets/") ||
        !buffers.has(item.assetFile) ||
        !ALLOWED_THEME_SOUND_EXTS.has(
          path.extname(item.assetFile).toLowerCase()
        ) ||
        buffers.get(item.assetFile)!.byteLength > HYDRA_CONFIG_MAX_ASSET_BYTES
      ) {
        throw new Error(
          `Invalid theme sound asset in snapshot: ${String(item.assetFile)}`
        );
      }
    }
  }

  const sourceProfiles = readJson<unknown>("source-profiles.json");
  if (!isPlainObject(sourceProfiles)) {
    throw new Error("Invalid source-profiles.json in snapshot.");
  }

  const libraryRaw = readJson<unknown>("library.json");
  if (!isPlainObject(libraryRaw)) {
    throw new Error("Invalid library.json in snapshot.");
  }
  const games = assertTupleArray(libraryRaw.games, "games") as [string, Game][];
  const excludedGames = assertTupleArray(
    libraryRaw.excludedGames,
    "excludedGames"
  ) as [string, ExcludedLibraryGame][];
  const cloudSaveCustomPaths = assertTupleArray(
    libraryRaw.cloudSaveCustomPaths,
    "cloudSaveCustomPaths"
  );
  const cloudSaveAutomaticSync = assertTupleArray(
    libraryRaw.cloudSaveAutomaticSync,
    "cloudSaveAutomaticSync"
  ) as [string, boolean][];

  return {
    manifest,
    rootDir: rootReal,
    data: {
      preferences: {
        language:
          typeof prefsPayload.language === "string"
            ? prefsPayload.language
            : null,
        preferences: stripSecretUserPreferences(
          prefsPayload.preferences as UserPreferences
        ),
      },
      ludusavi: {
        settings: ludusaviSettings,
        advancedYaml,
      },
      downloadSources: downloadSources as DownloadSource[],
      emulators: {
        emulators,
        retroarch,
        emulatorDestinations,
      },
      themes: {
        themes: themesRaw.themes as HydraConfigThemeEntry[],
      },
      sourceProfiles: sourceProfiles as Record<string, SourceWebsiteProfile>,
      library: {
        games,
        excludedGames,
        cloudSaveCustomPaths,
        cloudSaveAutomaticSync,
      },
    },
  };
}

function changedPreferenceSummary(
  current: UserPreferences,
  incoming: UserPreferences
): string[] {
  const patch: Partial<UserPreferences> = {};
  const allKeys = new Set([
    ...Object.keys(current),
    ...Object.keys(incoming),
  ]) as Set<keyof UserPreferences>;
  for (const key of allKeys) {
    if (!settingsValueEqual(current[key], incoming[key])) {
      (patch as Record<string, unknown>)[key] = incoming[key];
    }
  }
  return reviewSettings(patch).slice(0, 20);
}

export async function diffHydraConfigSnapshot(
  adapter: HydraConfigStoreAdapter,
  snapshot: ValidatedHydraConfigSnapshot
): Promise<{
  sections: HydraConfigSectionDiff[];
  pathWarnings: HydraConfigPathWarning[];
  destinationDiffers: boolean;
  currentDestination: string;
  snapshotDestination: string;
  directTorrentConfirmation: boolean;
}> {
  const live = await readLiveHydraConfig(adapter);
  const pathExists = adapter.pathExists ?? defaultPathExists;
  const warnings: HydraConfigPathWarning[] = [];
  const differentPlatform = snapshot.manifest.platform !== adapter.platform;

  const checkPath = async (
    section: HydraConfigSectionId,
    label: string,
    targetPath: string | null | undefined
  ) => {
    if (!targetPath || warnings.length >= 25) return;
    if (differentPlatform) {
      warnings.push({
        section,
        label,
        path: targetPath,
        reason: "different-platform",
      });
      return;
    }
    if (!(await pathExists(targetPath))) {
      warnings.push({
        section,
        label,
        path: targetPath,
        reason: "missing",
      });
    }
  };

  const snap = snapshot.data;
  const prefDetails = changedPreferenceSummary(
    live.preferences.preferences,
    snap.preferences.preferences
  );
  if (live.preferences.language !== snap.preferences.language) {
    prefDetails.unshift(
      `Language: ${live.preferences.language ?? "default"} -> ${snap.preferences.language ?? "default"}`
    );
  }

  const currentDest = live.ludusavi.settings.destination;
  const snapshotDest = snap.ludusavi.settings.destination;
  const destinationDiffers =
    path.win32.normalize(currentDest).toLowerCase() !==
    path.win32.normalize(snapshotDest).toLowerCase();

  const ludusaviDetails: string[] = [];
  if (destinationDiffers) {
    ludusaviDetails.push(
      `Backup destination differs: current "${currentDest}" vs snapshot "${snapshotDest}"`
    );
  }
  if (live.ludusavi.settings.enabled !== snap.ludusavi.settings.enabled) {
    ludusaviDetails.push(
      `Automatic backups: ${snap.ludusavi.settings.enabled ? "On" : "Off"}`
    );
  }
  if (
    live.ludusavi.settings.fullRetention !==
      snap.ludusavi.settings.fullRetention ||
    (live.ludusavi.settings.differentialRetention ?? 0) !==
      (snap.ludusavi.settings.differentialRetention ?? 0)
  ) {
    ludusaviDetails.push(
      `Retention: ${snap.ludusavi.settings.fullRetention} full / ${snap.ludusavi.settings.differentialRetention ?? 0} differential`
    );
  }
  if (
    !settingsValueEqual(
      live.ludusavi.settings.games,
      snap.ludusavi.settings.games
    )
  ) {
    ludusaviDetails.push(
      `Per-game save rules: ${Object.keys(snap.ludusavi.settings.games).length} entries`
    );
  }
  if (live.ludusavi.advancedYaml !== snap.ludusavi.advancedYaml) {
    ludusaviDetails.push("Ludusavi advanced.yaml rules differ");
  }

  const downloadSourcesChanged = !settingsValueEqual(
    live.downloadSources,
    snap.downloadSources
  );
  const emulatorsChanged = !settingsValueEqual(live.emulators, snap.emulators);
  const themesChanged =
    !settingsValueEqual(
      live.themes.themes.map((t) => t.theme),
      snap.themes.themes.map((t) => t.theme)
    ) || snap.themes.themes.some((t) => Boolean(t.assetFile));
  const sourceProfilesChanged = !settingsValueEqual(
    live.sourceProfiles,
    snap.sourceProfiles
  );
  const libraryChanged = !settingsValueEqual(live.library, snap.library);

  await checkPath(
    "preferences",
    "Default download folder",
    snap.preferences.preferences.downloadsPath
  );
  await checkPath(
    "preferences",
    "Screenshots folder",
    snap.preferences.preferences.screenshotsFolderPath
  );
  await checkPath("ludusavi", "Snapshot backup destination", snapshotDest);
  for (const [, emulator] of snap.emulators.emulators) {
    await checkPath(
      "emulators",
      `${emulator.system.toUpperCase()} executable`,
      emulator.executablePath
    );
    await checkPath(
      "emulators",
      `${emulator.system.toUpperCase()} BIOS`,
      emulator.biosPath
    );
  }
  for (const [, ra] of snap.emulators.retroarch) {
    await checkPath("emulators", "RetroArch executable", ra.executablePath);
    await checkPath("emulators", "RetroArch cores folder", ra.coresDir);
  }
  for (const [, game] of snap.library.games) {
    if (!game.isDeleted && game.executablePath) {
      await checkPath("library", game.title, game.executablePath);
    }
  }

  const descriptorMap = new Map(
    HYDRA_CONFIG_SECTIONS.map((item) => [item.id, item])
  );
  const sections: HydraConfigSectionDiff[] = [
    {
      id: "preferences",
      label: descriptorMap.get("preferences")!.label,
      available: true,
      hasChanges: prefDetails.length > 0,
      currentCount: Object.keys(live.preferences.preferences).length,
      snapshotCount: Object.keys(snap.preferences.preferences).length,
      summary:
        prefDetails.length > 0
          ? `${prefDetails.length} preference change(s)`
          : "No preference changes",
      details: prefDetails,
    },
    {
      id: "ludusavi",
      label: descriptorMap.get("ludusavi")!.label,
      available: true,
      hasChanges: ludusaviDetails.length > 0,
      currentCount: Object.keys(live.ludusavi.settings.games).length,
      snapshotCount: Object.keys(snap.ludusavi.settings.games).length,
      summary:
        ludusaviDetails.length > 0
          ? `${ludusaviDetails.length} save-backup configuration change(s)`
          : "No save-backup configuration changes",
      details: ludusaviDetails,
    },
    {
      id: "downloadSources",
      label: descriptorMap.get("downloadSources")!.label,
      available: true,
      hasChanges: downloadSourcesChanged,
      currentCount: live.downloadSources.length,
      snapshotCount: snap.downloadSources.length,
      summary: `${live.downloadSources.length} current -> ${snap.downloadSources.length} in snapshot`,
      details: snap.downloadSources
        .map((s) => `${s.name} (${s.url})`)
        .slice(0, 15),
    },
    {
      id: "emulators",
      label: descriptorMap.get("emulators")!.label,
      available: true,
      hasChanges: emulatorsChanged,
      currentCount:
        live.emulators.emulators.length + live.emulators.retroarch.length,
      snapshotCount:
        snap.emulators.emulators.length + snap.emulators.retroarch.length,
      summary: emulatorsChanged
        ? `${snap.emulators.emulators.length} emulator(s), ${snap.emulators.retroarch.length} RetroArch config(s)`
        : "No emulator changes",
      details: snap.emulators.emulators.map(
        ([system, cfg]) => `${system}: ${cfg.executablePath ?? "not set"}`
      ),
    },
    {
      id: "themes",
      label: descriptorMap.get("themes")!.label,
      available: true,
      hasChanges: themesChanged,
      currentCount: live.themes.themes.length,
      snapshotCount: snap.themes.themes.length,
      summary: `${live.themes.themes.length} current -> ${snap.themes.themes.length} in snapshot`,
      details: snap.themes.themes.map(
        ({ theme, assetFile }) =>
          `${theme.name}${theme.isActive ? " (active)" : ""}${assetFile ? " + custom sound" : ""}`
      ),
    },
    {
      id: "sourceProfiles",
      label: descriptorMap.get("sourceProfiles")!.label,
      available: true,
      hasChanges: sourceProfilesChanged,
      currentCount: Object.keys(live.sourceProfiles).length,
      snapshotCount: Object.keys(snap.sourceProfiles).length,
      summary: `${Object.keys(live.sourceProfiles).length} current -> ${Object.keys(snap.sourceProfiles).length} in snapshot`,
      details: Object.values(snap.sourceProfiles)
        .map((p) => `${p.name ?? p.website} (${p.website})`)
        .slice(0, 15),
    },
    {
      id: "library",
      label: descriptorMap.get("library")!.label,
      available: true,
      hasChanges: libraryChanged,
      currentCount: live.library.games.length,
      snapshotCount: snap.library.games.length,
      summary: `${live.library.games.length} current -> ${snap.library.games.length} in snapshot (${snap.library.excludedGames.length} excluded)`,
      details: [
        `Games: ${snap.library.games.length}`,
        `Excluded games: ${snap.library.excludedGames.length}`,
        `Cloud save custom paths: ${snap.library.cloudSaveCustomPaths.length}`,
      ],
    },
  ];

  const directTorrentConfirmation =
    !allowsDirectTorrent(live.preferences.preferences) &&
    allowsDirectTorrent(snap.preferences.preferences);

  return {
    sections,
    pathWarnings: warnings,
    destinationDiffers,
    currentDestination: currentDest,
    snapshotDestination: snapshotDest,
    directTorrentConfirmation,
  };
}

export async function applyHydraConfigSnapshot(
  adapter: HydraConfigStoreAdapter,
  snapshot: ValidatedHydraConfigSnapshot,
  selection: HydraConfigRestoreSelection,
  torrentConfirmation?: string
): Promise<{
  appliedSections: HydraConfigSectionId[];
  destinationPreserved: boolean;
  previousLanguage: string | null;
  newLanguage: string | null;
  previousPreferences: UserPreferences | null;
  newPreferences: UserPreferences | null;
}> {
  const validIds = new Set<HydraConfigSectionId>(ALL_HYDRA_CONFIG_SECTION_IDS);
  const selected = [...new Set(selection.sections)].filter((id) =>
    validIds.has(id)
  );
  if (!selected.length) {
    throw new Error("Select at least one configuration section to restore.");
  }

  const currentPrefs = await adapter.getUserPreferences();
  const previousLanguage = await adapter.getLanguage();
  let nextPreferences: UserPreferences | null = null;
  let newLanguage: string | null = previousLanguage;
  let destinationPreserved = true;

  if (selected.includes("preferences")) {
    validateDirectTorrentChange(
      currentPrefs,
      snapshot.data.preferences.preferences,
      torrentConfirmation
    );
  }

  for (const section of selected) {
    if (section === "preferences") {
      const merged = mergePreservedSecretUserPreferences(
        snapshot.data.preferences.preferences,
        currentPrefs
      );
      if (!allowsDirectTorrent(merged)) {
        merged.allowDirectTorrent = false;
        merged.seedAfterDownloadComplete = false;
      }
      await adapter.putUserPreferences(merged);
      nextPreferences = merged;
      if (snapshot.data.preferences.language) {
        await adapter.putLanguage(snapshot.data.preferences.language);
        newLanguage = snapshot.data.preferences.language;
      }
    } else if (section === "ludusavi") {
      const currentLudusavi = await adapter.getLudusaviSettings();
      const targetLudusavi: LudusaviLocalSettings = {
        ...structuredClone(snapshot.data.ludusavi.settings),
        destination: selection.overwriteDestination
          ? snapshot.data.ludusavi.settings.destination
          : currentLudusavi.destination,
      };
      destinationPreserved = !selection.overwriteDestination;
      validateSnapshotLudusaviSettings(targetLudusavi);
      await adapter.putLudusaviSettings(targetLudusavi);
      await adapter.writeAdvancedYaml(snapshot.data.ludusavi.advancedYaml);
    } else if (section === "downloadSources") {
      await adapter.replaceDownloadSources(snapshot.data.downloadSources);
    } else if (section === "emulators") {
      await adapter.replaceEmulators(snapshot.data.emulators.emulators);
      await adapter.replaceRetroArch(snapshot.data.emulators.retroarch);
      await adapter.replaceEmulatorDestinations(
        snapshot.data.emulators.emulatorDestinations
      );
    } else if (section === "themes") {
      const themes: Theme[] = [];
      for (const entry of snapshot.data.themes.themes) {
        themes.push(entry.theme);
      }
      await adapter.replaceThemes(themes);
      for (const entry of snapshot.data.themes.themes) {
        if (entry.assetFile) {
          const { target } = await readConfinedRegularFile(
            snapshot.rootDir,
            entry.assetFile
          );
          await adapter.installThemeSoundAsset(entry.theme, target);
        }
      }
    } else if (section === "sourceProfiles") {
      await adapter.putSourceProfiles(snapshot.data.sourceProfiles);
    } else if (section === "library") {
      await adapter.replaceGames(snapshot.data.library.games);
      await adapter.replaceExcludedGames(snapshot.data.library.excludedGames);
      await adapter.replaceCloudSaveCustomPaths(
        snapshot.data.library.cloudSaveCustomPaths
      );
      await adapter.replaceCloudSaveAutomaticSync(
        snapshot.data.library.cloudSaveAutomaticSync
      );
    }
  }

  return {
    appliedSections: selected,
    destinationPreserved,
    previousLanguage,
    newLanguage,
    previousPreferences: currentPrefs,
    newPreferences: nextPreferences,
  };
}
