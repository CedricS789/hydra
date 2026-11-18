import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import YAML from "yaml";
import type { LudusaviLocalSettings, UserPreferences } from "@types";
import { HYDRA_CONFIG_BACKUP_ENTRY } from "../../shared/hydra-config-backup.js";
import { DIRECT_TORRENT_CONFIRMATION } from "../../shared/direct-torrent-policy.js";
import { HydraConfigBackupController } from "./hydra-config-backup-controller.js";
import type { SaveApiResponse } from "./ludusavi-local-api.js";
import {
  writeHydraConfigSnapshotToDir,
  type HydraConfigStoreAdapter,
} from "./hydra-config-snapshot.js";
import { LudusaviBackupQueue } from "./ludusavi-local-queue.js";

function createControllerFixture(root: string, initialNow = 1_700_000_000_000) {
  let clock = initialNow;
  let runningGuard = false;
  let preferences: UserPreferences | null = {
    language: "en",
    downloadsPath: "D:/Downloads",
    allowDirectTorrent: false,
    realDebridApiToken: "keep-rd",
  };
  let language: string | null = "en";
  let ludusaviSettings: LudusaviLocalSettings = {
    enabled: true,
    destination: path.join(root, "dest"),
    fullRetention: 10,
    exitDelaySeconds: 10,
    games: {},
  };
  const snapshotArchiveDir = path.join(root, "archive-src");
  const snapshotDir = path.join(root, "live-snapshot");
  const scratchRoot = path.join(root, ".tmp");
  const sideEffects: string[] = [];
  let record = {
    lastBackupAt: null as string | null,
    lastBackupStatus: null as "success" | "failed" | null,
    lastBackupMessage: null as string | null,
  };

  const adapter: HydraConfigStoreAdapter = {
    appVersion: "4.4.1-remix.4",
    hostname: "host-a",
    platform: "win32",
    now: () => clock,
    pathExists: async () => true,
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
    readAdvancedYaml: async () => null,
    writeAdvancedYaml: async () => undefined,
    getDownloadSources: async () => [],
    replaceDownloadSources: async () => undefined,
    getEmulators: async () => [],
    replaceEmulators: async () => undefined,
    getRetroArch: async () => [],
    replaceRetroArch: async () => undefined,
    getEmulatorDestinations: async () => [],
    replaceEmulatorDestinations: async () => undefined,
    getThemes: async () => [],
    replaceThemes: async () => undefined,
    resolveThemeSoundPath: () => null,
    installThemeSoundAsset: async () => undefined,
    getSourceProfiles: async () => ({}),
    putSourceProfiles: async () => undefined,
    getGames: async () => [],
    replaceGames: async () => undefined,
    getExcludedGames: async () => [],
    replaceExcludedGames: async () => undefined,
    getCloudSaveCustomPaths: async () => [],
    replaceCloudSaveCustomPaths: async () => undefined,
    getCloudSaveAutomaticSync: async () => [],
    replaceCloudSaveAutomaticSync: async () => undefined,
  };

  const queue = new LudusaviBackupQueue();

  const controller = new HydraConfigBackupController({
    adapter,
    engine: {
      runJson: async (ctx, args): Promise<SaveApiResponse> => {
        if (args[0] === "restore") {
          const parsed = YAML.parse(
            await fs.readFile(path.join(ctx.configDir, "config.yaml"), "utf8")
          ) as { redirects?: { target: string }[] };
          const targetDir = parsed.redirects?.[0]?.target;
          assert.ok(targetDir);
          await fs.cp(snapshotArchiveDir, targetDir, { recursive: true });
          return {
            games: {
              [HYDRA_CONFIG_BACKUP_ENTRY]: { decision: "Processed", files: {} },
            },
          };
        }
        return {
          overall: { processedBytes: 123 },
          games: {
            [HYDRA_CONFIG_BACKUP_ENTRY]: {
              decision: "Processed",
              files: { "manifest.json": { bytes: 123 } },
            },
          },
        };
      },
      backupsForCanonical: async () => ({
        backups: [{ name: "backup-1.zip", when: "2026-01-01", locked: false }],
        backupPath: HYDRA_CONFIG_BACKUP_ENTRY,
      }),
      restoreDataForCanonical: async () => ({
        data: {
          games: {
            [HYDRA_CONFIG_BACKUP_ENTRY]: {
              decision: "Processed",
              files: {
                [path.join(snapshotArchiveDir, "manifest.json")]: { bytes: 10 },
              },
            },
          },
        },
        versions: { backupPath: HYDRA_CONFIG_BACKUP_ENTRY },
      }),
      validateArchive: async () => ({ files: 8, archives: 1 }),
      listSafetySnapshots: async () => [],
      cloudDataForCanonical: async () => ({}),
    },
    snapshotDir: () => snapshotDir,
    scratchRoot: () => scratchRoot,
    binaryPath: () => "ludusavi.exe",
    readBaseSaveConfig: async () => ({}),
    getSettings: async () => structuredClone(ludusaviSettings),
    acquireLock: async () => ({
      child: async () => undefined,
      release: async () => undefined,
    }),
    enqueue: (k, task) => queue.enqueue(k, task),
    withPreferencesLock: (task) => task(),
    assertSafeForRestore: async () => {
      if (runningGuard) throw new Error("Game is running");
    },
    applySideEffects: async ({ appliedSections }) => {
      sideEffects.push(...appliedSections);
    },
    getRecord: async () => record,
    saveRecord: async (next) => {
      record = next;
    },
    now: () => clock,
  });

  return {
    controller,
    adapter,
    snapshotArchiveDir,
    sideEffects,
    setClock: (v: number) => {
      clock = v;
    },
    setRunningGuard: (v: boolean) => {
      runningGuard = v;
    },
    getPreferences: () => preferences,
    setPreferences: (v: UserPreferences) => {
      preferences = v;
    },
  };
}

test("controller enforces sender binding, expiry, confirmation phrases, and single-use tokens", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hydra-cfg-ctrl-"));
  try {
    const f = createControllerFixture(root);
    // Write an archive snapshot with allowDirectTorrent: true
    f.setPreferences({
      language: "de",
      downloadsPath: "D:/Downloads",
      allowDirectTorrent: true,
    });
    await writeHydraConfigSnapshotToDir(f.adapter, f.snapshotArchiveDir);

    // Live system has allowDirectTorrent: false
    f.setPreferences({
      language: "en",
      downloadsPath: "D:/Downloads",
      allowDirectTorrent: false,
      realDebridApiToken: "keep-rd",
    });

    const preview = await f.controller.previewRestore(10, "backup-1.zip");
    assert.equal(preview.directTorrentConfirmation, true);

    // Wrong sender cannot use the token (and consumes/invalidates or fails)
    await assert.rejects(
      () =>
        f.controller.confirmRestore(99, {
          token: preview.token,
          acknowledged: true,
          phrase: "RESTORE CONFIG",
          selection: { sections: ["preferences"], overwriteDestination: false },
          torrentConfirmation: DIRECT_TORRENT_CONFIRMATION,
        }),
      /expired/i
    );

    // Re-preview for sender 10, test expiry
    const preview2 = await f.controller.previewRestore(10, "backup-1.zip");
    f.setClock(preview2.expiresAt + 1);
    await assert.rejects(
      () =>
        f.controller.confirmRestore(10, {
          token: preview2.token,
          acknowledged: true,
          phrase: "RESTORE CONFIG",
          selection: { sections: ["preferences"], overwriteDestination: false },
          torrentConfirmation: DIRECT_TORRENT_CONFIRMATION,
        }),
      /expired/i
    );

    // Re-preview and verify missing DIRECT_TORRENT_CONFIRMATION is rejected
    const preview3 = await f.controller.previewRestore(10, "backup-1.zip");
    await assert.rejects(
      () =>
        f.controller.confirmRestore(10, {
          token: preview3.token,
          acknowledged: true,
          phrase: "RESTORE CONFIG",
          selection: { sections: ["preferences"], overwriteDestination: false },
        }),
      /ENABLE DIRECT TORRENTS/
    );

    // Re-preview and succeed with full confirmations
    const preview4 = await f.controller.previewRestore(10, "backup-1.zip");
    const res = await f.controller.confirmRestore(10, {
      token: preview4.token,
      acknowledged: true,
      phrase: "RESTORE CONFIG",
      selection: { sections: ["preferences"], overwriteDestination: false },
      torrentConfirmation: DIRECT_TORRENT_CONFIRMATION,
    });
    assert.deepEqual(res.appliedSections, ["preferences"]);
    assert.equal(f.getPreferences()?.allowDirectTorrent, true);
    assert.equal(f.getPreferences()?.realDebridApiToken, "keep-rd");

    // Token is single-use
    await assert.rejects(
      () =>
        f.controller.confirmRestore(10, {
          token: preview4.token,
          acknowledged: true,
          phrase: "RESTORE CONFIG",
          selection: { sections: ["preferences"], overwriteDestination: false },
          torrentConfirmation: DIRECT_TORRENT_CONFIRMATION,
        }),
      /expired/i
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("controller aborts restore on live-state drift or running-game guard", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hydra-cfg-drift-"));
  try {
    const f = createControllerFixture(root);
    await writeHydraConfigSnapshotToDir(f.adapter, f.snapshotArchiveDir);

    const preview = await f.controller.previewRestore(1, "backup-1.zip");
    // Mutate live preferences after preview
    f.setPreferences({
      ...f.getPreferences(),
      downloadsPath: "E:/ChangedAfterPreview",
    });

    await assert.rejects(
      () =>
        f.controller.confirmRestore(1, {
          token: preview.token,
          acknowledged: true,
          phrase: "RESTORE CONFIG",
          selection: { sections: ["preferences"], overwriteDestination: false },
        }),
      /changed since this review/i
    );

    // Running game blocks preview
    f.setRunningGuard(true);
    await assert.rejects(
      () => f.controller.previewRestore(1, "backup-1.zip"),
      /Game is running/
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
