import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SettingsResetEngine,
  type ResetAdapter,
  type ResetCheckpoint,
  type ResetValues,
} from "./settings-reset-engine.ts";
import {
  BACKUP_BEHAVIOR_DEFAULTS,
  GAME_RULE_DEFAULTS,
  resetPreferenceDefaults,
  withResetDefaults,
  type SettingsResetTarget,
} from "../../shared/settings-reset.ts";

function fixture() {
  const values: ResetValues = {
    ...withResetDefaults(null),
    runAtStartup: true,
    achievementSoundVolume: 0.9,
    allowDirectTorrent: true,
    language: "fr",
    realDebridApiToken: "secret",
    downloadsPath: "C:/downloads",
    firstRunGuideCompleted: true,
  };
  const checkpoints = new Map<string, ResetCheckpoint>();
  let writes = 0,
    blocked = false,
    failCheckpoint = false,
    failWrite = false;
  let time = 1000;
  const adapter: ResetAdapter = {
    defaults: (target) =>
      target.group === "backups"
        ? { ...BACKUP_BEHAVIOR_DEFAULTS }
        : target.group === "gameRules"
          ? { ...GAME_RULE_DEFAULTS }
          : resetPreferenceDefaults(target.group),
    read: async (target) =>
      Object.fromEntries(
        Object.keys(adapter.defaults(target)).map((key) => [
          key,
          structuredClone(values[key]),
        ])
      ),
    write: async (_target, next, confirmation) => {
      if (
        next.allowDirectTorrent === true &&
        values.allowDirectTorrent !== true
      )
        assert.equal(confirmation, "ENABLE DIRECT TORRENTS");
      writes++;
      Object.assign(values, next);
      if (failWrite) throw new Error("side effect failed after persistence");
    },
    checkpoint: async (target) =>
      structuredClone(checkpoints.get(JSON.stringify(target)) ?? {}),
    saveCheckpoint: async (target, checkpoint) => {
      if (failCheckpoint) throw new Error("disk full");
      checkpoints.set(JSON.stringify(target), structuredClone(checkpoint));
    },
    exclusive: async (_target, task) => task(),
    blocked: () => (blocked ? "Save manager is open" : undefined),
    title: async (target) => target.gameKey ?? target.group,
  };
  const engine = () => new SettingsResetEngine(adapter, () => time);
  return {
    values,
    checkpoints,
    adapter,
    engine: engine(),
    restart: engine,
    writes: () => writes,
    block: () => {
      blocked = true;
    },
    failCheckpoint: () => {
      failCheckpoint = true;
    },
    failWrite: (value = true) => {
      failWrite = value;
    },
    expire: () => {
      time += 6 * 60_000;
    },
  };
}
const general: SettingsResetTarget = { group: "general" };

describe("reviewed settings reset and recovery", () => {
  it("previews without mutation, applies only allowlisted fields, and persists recovery across restart", async () => {
    const f = fixture();
    const preview = await f.engine.preview(1, general);
    assert.equal(f.writes(), 0);
    assert.equal(f.checkpoints.size, 0);
    assert.ok(
      preview.changes.some(
        (change) =>
          change.key === "runAtStartup" &&
          change.before === "On" &&
          change.after === "Off"
      )
    );
    assert.ok(!JSON.stringify(preview).includes("secret"));
    await f.engine.apply(1, preview.token, false, "");
    assert.equal(f.values.runAtStartup, false);
    assert.equal(f.values.language, "fr");
    assert.equal(f.values.realDebridApiToken, "secret");
    assert.equal(f.values.downloadsPath, "C:/downloads");
    assert.equal(
      (await f.restart().status(general)).recovery?.interrupted,
      false
    );
    f.values.achievementSoundVolume = 0.3;
    const recovery = await f.restart().preview(1, general, true);
    await f
      .restart()
      .apply(1, recovery.token, false, "")
      .then(
        () => assert.fail("approval tokens must not survive process restart"),
        () => undefined
      );
    const restarted = f.restart();
    const review = await restarted.preview(1, general, true);
    await restarted.apply(1, review.token, false, "");
    assert.equal(f.values.runAtStartup, true);
    assert.equal(f.values.achievementSoundVolume, 0.3);
  });
  it("does not write or snapshot no-op settings", async () => {
    const f = fixture();
    f.values.runAtStartup = false;
    assert.equal((await f.engine.status(general)).isDefault, true);
    const preview = await f.engine.preview(1, general);
    assert.equal(preview.changes.length, 0);
    await assert.rejects(
      f.engine.apply(1, preview.token, false, ""),
      /already match/
    );
    assert.equal(f.writes(), 0);
    assert.equal(f.checkpoints.size, 0);
  });
  it("requires typed confirmation for a combined reset and preserves privacy and permissions", async () => {
    const f = fixture();
    f.values.hideCommunityScreenshots = true;
    f.values.deleteArchiveFilesAfterExtractionByDefault = false;
    f.values.enableAutoInstall = true;
    const preview = await f.engine.preview(1, { group: "combined" });
    await assert.rejects(
      f.engine.apply(1, preview.token, true, "wrong"),
      /confirmation/
    );
    await assert.rejects(
      f.engine.apply(1, preview.token, false, "RESET SETTINGS"),
      /confirmation/
    );
    await f.engine.apply(1, preview.token, true, "RESET SETTINGS");
    assert.equal(f.values.allowDirectTorrent, false);
    assert.equal(f.values.hideCommunityScreenshots, true);
    assert.equal(f.values.enableAutoInstall, true);
    assert.equal(f.values.deleteArchiveFilesAfterExtractionByDefault, false);
  });
  it("rejects another sender, expired, stale and reused reviews", async () => {
    const f = fixture();
    let review = await f.engine.preview(1, general);
    await assert.rejects(f.engine.apply(2, review.token, false, ""), /expired/);
    f.values.runAtStartup = false;
    await assert.rejects(
      f.engine.apply(1, review.token, false, ""),
      /changed since/
    );
    f.values.runAtStartup = true;
    review = await f.engine.preview(1, general);
    f.expire();
    await assert.rejects(f.engine.apply(1, review.token, false, ""), /expired/);
    review = await f.engine.preview(1, general);
    const first = f.engine.apply(1, review.token, false, "");
    await assert.rejects(f.engine.apply(1, review.token, false, ""), /expired/);
    await first;
    assert.equal(f.writes(), 1);
  });
  it("blocks conflicting save operations again at application time", async () => {
    const f = fixture();
    const review = await f.engine.preview(1, general);
    f.block();
    await assert.rejects(
      f.engine.apply(1, review.token, false, ""),
      /manager is open/
    );
    await assert.rejects(f.engine.preview(1, general), /manager is open/);
    assert.equal(f.writes(), 0);
  });
  it("aborts before changing settings if the recovery snapshot cannot be saved", async () => {
    const f = fixture();
    const review = await f.engine.preview(1, general);
    f.failCheckpoint();
    await assert.rejects(
      f.engine.apply(1, review.token, false, ""),
      /disk full/
    );
    assert.equal(f.writes(), 0);
    assert.equal(f.values.runAtStartup, true);
  });
  it("retains previous and interrupted recovery if a side effect fails after a partial change", async () => {
    const f = fixture();
    let review = await f.engine.preview(1, general);
    await f.engine.apply(1, review.token, false, "");
    const previous = structuredClone(
      f.checkpoints.get(JSON.stringify(general))?.previous
    );
    f.values.runAtStartup = true;
    f.values.startMinimized = true;
    review = await f.engine.preview(1, general);
    f.failWrite();
    await assert.rejects(
      f.engine.apply(1, review.token, false, ""),
      /Some settings may have changed/
    );
    const stored = f.checkpoints.get(JSON.stringify(general))!;
    assert.deepEqual(stored.previous, previous);
    assert.equal(stored.pending?.values.startMinimized, true);
    assert.equal(
      (await f.restart().status(general)).recovery?.interrupted,
      true
    );
    await assert.rejects(f.engine.preview(1, general), /interrupted reset/);
    f.failWrite(false);
    const restarted = f.restart();
    review = await restarted.preview(1, general, true);
    await restarted.apply(1, review.token, false, "");
    assert.equal(f.values.startMinimized, true);
    assert.equal(
      (await restarted.status(general)).recovery?.interrupted,
      false
    );
  });
  it("does not restore direct torrent permission without its existing confirmation phrase", async () => {
    const f = fixture();
    const target: SettingsResetTarget = { group: "protection" };
    let review = await f.engine.preview(1, target);
    await f.engine.apply(1, review.token, false, "");
    review = await f.engine.preview(1, target, true);
    assert.equal(review.directTorrentConfirmation, true);
    await assert.rejects(
      f.engine.apply(1, review.token, true, ""),
      /confirmation/
    );
    await f.engine.apply(1, review.token, true, "", "ENABLE DIRECT TORRENTS");
    assert.equal(f.values.allowDirectTorrent, true);
  });
  it("can retry interrupted side effects even when persisted values already match recovery", async () => {
    const f = fixture();
    const write = f.adapter.write;
    f.adapter.write = async () => {
      throw new Error("failed before persistence");
    };
    const reset = await f.engine.preview(1, general);
    await assert.rejects(
      f.engine.apply(1, reset.token, false, ""),
      /did not finish/
    );
    const recovery = await f.engine.preview(1, general, true);
    assert.equal(recovery.changes.length, 0);
    assert.equal(recovery.retryingInterrupted, true);
    f.adapter.write = write;
    await f.engine.apply(1, recovery.token, false, "");
    assert.equal(f.writes(), 1);
    assert.equal((await f.engine.status(general)).recovery?.interrupted, false);
  });
  it("retains a retryable recovery marker when restoration itself fails after persistence", async () => {
    const f = fixture();
    let review = await f.engine.preview(1, general);
    await f.engine.apply(1, review.token, false, "");
    review = await f.engine.preview(1, general, true);
    f.failWrite();
    await assert.rejects(
      f.engine.apply(1, review.token, false, ""),
      /recovery did not finish/
    );
    assert.equal(f.values.runAtStartup, true);
    const restarted = f.restart();
    const retry = await restarted.preview(1, general, true);
    assert.equal(retry.changes.length, 0);
    assert.equal(retry.retryingInterrupted, true);
    f.failWrite(false);
    await restarted.apply(1, retry.token, false, "");
    assert.equal(
      (await restarted.status(general)).recovery?.interrupted,
      false
    );
  });
  it("rejects recovery data with unknown fields", async () => {
    const f = fixture();
    const review = await f.engine.preview(1, general);
    await f.engine.apply(1, review.token, false, "");
    f.checkpoints.get(
      JSON.stringify(general)
    )!.previous!.values.realDebridApiToken = "unexpected";
    await assert.rejects(f.engine.preview(1, general, true), /incompatible/);
  });
  it("invalidates review when its recovery snapshot changes", async () => {
    const f = fixture();
    let review = await f.engine.preview(1, general);
    await f.engine.apply(1, review.token, false, "");
    review = await f.engine.preview(1, general, true);
    f.checkpoints.get(JSON.stringify(general))!.previous!.savedAt = "different";
    await assert.rejects(
      f.engine.apply(1, review.token, false, ""),
      /snapshot changed/
    );
  });
  for (const target of [
    { group: "backups" },
    { group: "gameRules", gameKey: "steam:1" },
  ] as SettingsResetTarget[]) {
    it(`requires acknowledgement and names consequences for ${target.group}`, async () => {
      const f = fixture();
      Object.assign(f.values, f.adapter.defaults(target));
      f.values.enabled = false;
      const review = await f.engine.preview(1, target);
      assert.equal(review.confirmationPhrase, "RESET SETTINGS");
      assert.ok(
        review.warnings.some((warning) =>
          target.group === "backups"
            ? warning.includes("retention") || warning.includes("Retention")
            : warning.includes("steam:1")
        )
      );
      await f.engine.apply(1, review.token, true, "RESET SETTINGS");
      assert.equal(f.values.enabled, true);
    });
  }
});
