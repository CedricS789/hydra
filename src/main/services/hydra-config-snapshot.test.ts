import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type {
  DownloadSource,
  EmulatorConfig,
  EmulatorSystem,
  ExcludedLibraryGame,
  Game,
  LudusaviLocalSettings,
  RetroArchConfig,
  Theme,
  UserPreferences,
} from "@types";
import type { SourceWebsiteProfile } from "../../types/source-browser.types";
import {
  applyHydraConfigSnapshot,
  diffHydraConfigSnapshot,
  readAndValidateHydraConfigSnapshot,
  writeHydraConfigSnapshotToDir,
  type HydraConfigStoreAdapter,
} from "./hydra-config-snapshot.js";
import { DIRECT_TORRENT_CONFIRMATION } from "../../shared/direct-torrent-policy.js";
import { DownloadSourceStatus } from "../../shared/constants.js";

function createMemoryAdapter(
  root: string,
  options?: {
    preferences?: UserPreferences;
    language?: string;
    destination?: string;
    existingPaths?: Set<string>;
    soundFile?: string;
  }
) {
  let preferences: UserPreferences | null = {
    language: "en",
    downloadsPath: "D:/Downloads",
    allowDirectTorrent: false,
    realDebridApiToken: "rd-secret-token",
    premiumizeApiToken: "pm-secret-token",
    allDebridApiToken: "ad-secret-token",
    torBoxApiToken: "tb-secret-token",
    retroAchievementsWebApiKey: "ra-secret-key",
    ggDealsApiKey: "gg-secret-key",
    ...options?.preferences,
  };
  let language: string | null = options?.language ?? "en";
  let ludusaviSettings: LudusaviLocalSettings = {
    enabled: true,
    destination: options?.destination ?? "D:/Backups",
    fullRetention: 10,
    differentialRetention: 2,
    exitDelaySeconds: 10,
    format: "zip",
    compression: "deflate",
    games: {
      "steam:100": {
        enabled: true,
        savePaths: ["C:/Saves/Game100"],
        trackingPaths: [],
      },
    },
  };
  let advancedYaml: string | null = "roots: []\n";
  let downloadSources: DownloadSource[] = [
    {
      id: "src-1",
      name: "Hydra Source",
      url: "https://example.com/source.json",
      status: DownloadSourceStatus.Matched,
      downloadCount: 10,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  ];
  let emulators: [EmulatorSystem, EmulatorConfig][] = [
    [
      "ps2",
      {
        system: "ps2",
        binary: "pcsx2",
        executablePath: "D:/Emulators/pcsx2.exe",
        detectedVersion: "2.0",
        detectedAt: 1,
        biosPath: "D:/Emulators/bios",
        romFolders: [],
        lastScanAt: null,
        totalFiles: 0,
        totalSizeBytes: 0,
      },
    ],
  ];
  let retroarch: [string, RetroArchConfig][] = [];
  let emulatorDestinations: [string, unknown][] = [];
  let themes: Theme[] = [
    {
      id: "theme-1",
      name: "Midnight",
      isActive: true,
      code: "body { color: #fff; }",
      hasCustomSound: Boolean(options?.soundFile),
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    },
  ];
  let sourceProfiles: Record<string, SourceWebsiteProfile> = {
    "src-1": {
      name: "Example",
      website: "https://example.com",
      searchUrl: "https://example.com/?q={query}",
      approvedDomains: ["example.com"],
    },
  };
  let games: [string, Game][] = [
    [
      "steam:100",
      {
        title: "Sample Game",
        shop: "steam",
        objectId: "100",
        executablePath: "D:/Games/Sample/game.exe",
        iconUrl: null,
        libraryHeroImageUrl: null,
        logoImageUrl: null,
        playTimeInMilliseconds: 1200,
        lastTimePlayed: null,
        remoteId: null,
        isDeleted: false,
      } as Game,
    ],
  ];
  let excludedGames: [string, ExcludedLibraryGame][] = [];
  let cloudSaveCustomPaths: [string, unknown][] = [];
  let cloudSaveAutomaticSync: [string, boolean][] = [];
  const installedSounds: { themeId: string; file: string }[] = [];

  const adapter: HydraConfigStoreAdapter = {
    appVersion: "4.4.1-remix.4",
    hostname: "host-a",
    platform: "win32",
    now: () => Date.parse("2026-11-17T10:00:00.000Z"),
    pathExists: async (p) => options?.existingPaths?.has(p) ?? true,
    getUserPreferences: async () => structuredClone(preferences),
    putUserPreferences: async (v) => {
      preferences = structuredClone(v);
    },
    getLanguage: async () => language,
    putLanguage: async (l) => {
      language = l;
    },
    getLudusaviSettings: async () => structuredClone(ludusaviSettings),
    putLudusaviSettings: async (v) => {
      ludusaviSettings = structuredClone(v);
    },
    readAdvancedYaml: async () => advancedYaml,
    writeAdvancedYaml: async (v) => {
      advancedYaml = v;
    },
    getDownloadSources: async () => structuredClone(downloadSources),
    replaceDownloadSources: async (items) => {
      downloadSources = structuredClone(items);
    },
    getEmulators: async () => structuredClone(emulators),
    replaceEmulators: async (entries) => {
      emulators = structuredClone(entries);
    },
    getRetroArch: async () => structuredClone(retroarch),
    replaceRetroArch: async (entries) => {
      retroarch = structuredClone(entries);
    },
    getEmulatorDestinations: async () => structuredClone(emulatorDestinations),
    replaceEmulatorDestinations: async (entries) => {
      emulatorDestinations = structuredClone(entries);
    },
    getThemes: async () => structuredClone(themes),
    replaceThemes: async (items) => {
      themes = structuredClone(items);
    },
    resolveThemeSoundPath: (theme) =>
      theme.id === "theme-1" ? (options?.soundFile ?? null) : null,
    installThemeSoundAsset: async (theme, sourceFile) => {
      const destDir = path.join(root, "installed-themes", theme.id);
      await fs.mkdir(destDir, { recursive: true });
      const destFile = path.join(
        destDir,
        `achievement${path.extname(sourceFile)}`
      );
      await fs.copyFile(sourceFile, destFile);
      installedSounds.push({ themeId: theme.id, file: destFile });
    },
    getSourceProfiles: async () => structuredClone(sourceProfiles),
    putSourceProfiles: async (p) => {
      sourceProfiles = structuredClone(p);
    },
    getGames: async () => structuredClone(games),
    replaceGames: async (entries) => {
      games = structuredClone(entries);
    },
    getExcludedGames: async () => structuredClone(excludedGames),
    replaceExcludedGames: async (entries) => {
      excludedGames = structuredClone(entries);
    },
    getCloudSaveCustomPaths: async () => structuredClone(cloudSaveCustomPaths),
    replaceCloudSaveCustomPaths: async (entries) => {
      cloudSaveCustomPaths = structuredClone(entries);
    },
    getCloudSaveAutomaticSync: async () =>
      structuredClone(cloudSaveAutomaticSync),
    replaceCloudSaveAutomaticSync: async (entries) => {
      cloudSaveAutomaticSync = structuredClone(entries);
    },
  };

  return {
    adapter,
    installedSounds,
    getState: () => ({
      preferences,
      language,
      ludusaviSettings,
      advancedYaml,
      downloadSources,
      themes,
      games,
    }),
  };
}

test("snapshot strips API secrets, bundles theme sounds, and preserves local secrets on restore", async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "hydra-cfg-snapshot-test-")
  );
  try {
    const soundFile = path.join(root, "achievement.wav");
    await fs.writeFile(soundFile, "RIFF-WAVE-DUMMY");
    const snapDir = path.join(root, "snapshot");
    const source = createMemoryAdapter(root, { soundFile });

    const written = await writeHydraConfigSnapshotToDir(
      source.adapter,
      snapDir
    );
    assert.ok(written.files >= 9);

    const prefsText = await fs.readFile(
      path.join(snapDir, "preferences.json"),
      "utf8"
    );
    for (const secret of [
      "rd-secret-token",
      "pm-secret-token",
      "ad-secret-token",
      "tb-secret-token",
      "ra-secret-key",
      "gg-secret-key",
    ]) {
      assert.ok(!prefsText.includes(secret), `Secret leaked: ${secret}`);
    }

    const validated = await readAndValidateHydraConfigSnapshot(snapDir);
    assert.equal(
      validated.data.themes.themes[0]?.assetFile,
      "themes-assets/theme-1/achievement.wav"
    );

    const target = createMemoryAdapter(root, {
      preferences: {
        language: "fr",
        downloadsPath: "C:/OtherDownloads",
        realDebridApiToken: "local-rd-keep",
        ggDealsApiKey: "local-gg-keep",
      },
      language: "fr",
      destination: "C:/LocalBackups",
    });

    await applyHydraConfigSnapshot(target.adapter, validated, {
      sections: [
        "preferences",
        "ludusavi",
        "downloadSources",
        "emulators",
        "themes",
        "sourceProfiles",
        "library",
      ],
      overwriteDestination: false,
    });

    const restored = target.getState();
    assert.equal(restored.preferences?.realDebridApiToken, "local-rd-keep");
    assert.equal(restored.preferences?.ggDealsApiKey, "local-gg-keep");
    assert.equal(restored.preferences?.downloadsPath, "D:/Downloads");
    assert.equal(restored.language, "en");
    assert.equal(restored.ludusaviSettings.destination, "C:/LocalBackups");
    assert.equal(target.installedSounds.length, 1);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("snapshot validation rejects checksum tampering and path traversal", async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "hydra-cfg-tamper-test-")
  );
  try {
    const snapDir = path.join(root, "snapshot");
    const source = createMemoryAdapter(root);
    await writeHydraConfigSnapshotToDir(source.adapter, snapDir);

    await fs.writeFile(
      path.join(snapDir, "download-sources.json"),
      JSON.stringify([{ id: "tampered", name: "Evil", url: "https://evil" }])
    );
    await assert.rejects(
      () => readAndValidateHydraConfigSnapshot(snapDir),
      /checksum mismatch|size mismatch/i
    );

    const snapDir2 = path.join(root, "snapshot-traversal");
    await writeHydraConfigSnapshotToDir(source.adapter, snapDir2);
    const manifestPath = path.join(snapDir2, "manifest.json");
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    manifest.files["../outside.txt"] = { sha256: "00", bytes: 0 };
    await fs.writeFile(manifestPath, JSON.stringify(manifest));
    await assert.rejects(
      () => readAndValidateHydraConfigSnapshot(snapDir2),
      /Unsafe snapshot file path/i
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("diff flags missing host paths and restore guards direct torrent permission", async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "hydra-cfg-guard-test-")
  );
  try {
    const snapDir = path.join(root, "snapshot");
    const source = createMemoryAdapter(root, {
      preferences: { allowDirectTorrent: true },
    });
    await writeHydraConfigSnapshotToDir(source.adapter, snapDir);
    const validated = await readAndValidateHydraConfigSnapshot(snapDir);

    const target = createMemoryAdapter(root, {
      preferences: { allowDirectTorrent: false },
      destination: "E:/DifferentDestination",
      existingPaths: new Set(["E:/DifferentDestination"]),
    });

    const diff = await diffHydraConfigSnapshot(target.adapter, validated);
    assert.equal(diff.destinationDiffers, true);
    assert.equal(diff.directTorrentConfirmation, true);
    assert.ok(diff.pathWarnings.some((w) => w.path === "D:/Downloads"));
    assert.ok(
      diff.pathWarnings.some((w) => w.path === "D:/Games/Sample/game.exe")
    );

    await assert.rejects(
      () =>
        applyHydraConfigSnapshot(target.adapter, validated, {
          sections: ["preferences"],
          overwriteDestination: false,
        }),
      /direct peer-to-peer/i
    );

    await applyHydraConfigSnapshot(
      target.adapter,
      validated,
      {
        sections: ["preferences", "ludusavi"],
        overwriteDestination: true,
      },
      DIRECT_TORRENT_CONFIRMATION
    );

    assert.equal(target.getState().preferences?.allowDirectTorrent, true);
    assert.equal(target.getState().ludusaviSettings.destination, "D:/Backups");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
