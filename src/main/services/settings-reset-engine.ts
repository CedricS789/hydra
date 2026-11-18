import { randomUUID } from "node:crypto";
import {
  resetValuesEqual,
  resetFieldLabel,
  resetDisplayValue,
  type SettingsResetTarget,
  type SettingsResetPreview,
  type SettingsResetStatus,
} from "../../shared/settings-reset.js";

export type ResetValues = Record<string, unknown>;
export interface ResetSnapshot {
  version: 1;
  savedAt: string;
  values: ResetValues;
}
export interface ResetCheckpoint {
  previous?: ResetSnapshot;
  pending?: ResetSnapshot;
}
export interface ResetAdapter {
  read(target: SettingsResetTarget): Promise<ResetValues>;
  defaults(target: SettingsResetTarget): ResetValues;
  write(
    target: SettingsResetTarget,
    values: ResetValues,
    torrentConfirmation?: string
  ): Promise<void>;
  checkpoint(target: SettingsResetTarget): Promise<ResetCheckpoint>;
  saveCheckpoint(
    target: SettingsResetTarget,
    checkpoint: ResetCheckpoint
  ): Promise<void>;
  exclusive<T>(target: SettingsResetTarget, task: () => Promise<T>): Promise<T>;
  blocked(target: SettingsResetTarget): string | undefined;
  title(target: SettingsResetTarget): Promise<string>;
}

const targetKey = (target: SettingsResetTarget) =>
  JSON.stringify([target.group, target.gameKey ?? null]);
const sensitive = (target: SettingsResetTarget) =>
  ["combined", "backups", "gameRules"].includes(target.group);

/** Backend-owned, sender-bound approvals; snapshots contain allowlisted configuration only. */
export class SettingsResetEngine {
  private previews = new Map<
    string,
    {
      owner: number;
      preview: SettingsResetPreview;
      before: ResetValues;
      after: ResetValues;
      snapshot?: ResetSnapshot;
    }
  >();
  constructor(
    private adapter: ResetAdapter,
    private now = () => Date.now()
  ) {}

  async status(target: SettingsResetTarget): Promise<SettingsResetStatus> {
    const current = await this.adapter.read(target);
    const checkpoint = await this.adapter.checkpoint(target);
    const snapshot = checkpoint.pending ?? checkpoint.previous;
    return {
      target,
      isDefault: resetValuesEqual(current, this.adapter.defaults(target)),
      blockedReason: this.adapter.blocked(target),
      recovery: snapshot
        ? {
            target,
            savedAt: snapshot.savedAt,
            interrupted: Boolean(checkpoint.pending),
          }
        : null,
    };
  }

  async preview(
    owner: number,
    target: SettingsResetTarget,
    restoring = false
  ): Promise<SettingsResetPreview> {
    for (const [token, entry] of this.previews) {
      if (
        entry.preview.expiresAt <= this.now() ||
        (entry.owner === owner &&
          targetKey(entry.preview.target) === targetKey(target))
      )
        this.previews.delete(token);
    }
    if (this.previews.size >= 100)
      throw new Error(
        "Too many open reset reviews. Close a review and try again."
      );
    const blocked = this.adapter.blocked(target);
    if (blocked) throw new Error(blocked);
    const before = await this.adapter.read(target);
    const checkpoint = await this.adapter.checkpoint(target);
    if (!restoring && checkpoint.pending)
      throw new Error(
        "An interrupted reset has a recovery copy. Use Restore previous settings before starting another reset in this group."
      );
    const snapshot = restoring
      ? (checkpoint.pending ?? checkpoint.previous)
      : undefined;
    if (restoring && (!snapshot || snapshot.version !== 1))
      throw new Error("No compatible recovery snapshot is available.");
    const after = snapshot
      ? structuredClone(snapshot.values)
      : this.adapter.defaults(target);
    // Older snapshots cannot introduce newly added fields or arbitrary keys.
    if (
      !resetValuesEqual(Object.keys(after).sort(), Object.keys(before).sort())
    )
      throw new Error(
        "This snapshot is incompatible with the current settings. Your settings were not changed."
      );
    const title = await this.adapter.title(target);
    const changes = Object.keys(after)
      .filter((key) => !resetValuesEqual(before[key], after[key]))
      .map((key) => ({
        key,
        label:
          key === "activeThemes" ? "Active theme IDs" : resetFieldLabel(key),
        before: resetDisplayValue(before[key]),
        after: resetDisplayValue(after[key]),
      }));
    const warnings = [
      "This changes settings only. Game saves, backups, library entries, account connections and download folders are preserved.",
    ];
    if (target.group === "combined" || target.group === "general")
      warnings.push(
        "Startup registration may change. Window decoration changes take effect after restarting the app."
      );
    if (target.group === "backups")
      warnings.push(
        "Retention changes apply to future backups. Lower limits can remove older backup versions on subsequent runs. The destination and game rules are kept."
      );
    if (target.group === "gameRules")
      warnings.push(
        `Selected game: ${title}. Changing matching or custom paths affects future save detection and restore targets. Review detection before any later restore.`
      );
    const directTorrentConfirmation =
      after.allowDirectTorrent === true && before.allowDirectTorrent !== true;
    const retryingInterrupted = restoring && Boolean(checkpoint.pending);
    if (retryingInterrupted && !changes.length)
      warnings.push(
        "Stored values already match this recovery copy. Reapply it to retry system integration after the interrupted operation."
      );
    if (directTorrentConfirmation)
      warnings.push(
        "This restores direct peer-to-peer torrent permission. Peers can see your public IP. The existing direct-torrent confirmation is required."
      );
    const preview: SettingsResetPreview = {
      token: randomUUID(),
      target,
      restoring,
      expiresAt: this.now() + 5 * 60_000,
      changes,
      warnings,
      confirmationPhrase: sensitive(target)
        ? restoring
          ? "RESTORE SETTINGS"
          : "RESET SETTINGS"
        : null,
      directTorrentConfirmation,
      retryingInterrupted,
    };
    this.previews.set(preview.token, {
      owner,
      preview,
      before,
      after,
      snapshot,
    });
    return preview;
  }

  async apply(
    owner: number,
    token: string,
    acknowledgement: boolean,
    phrase: string,
    torrentConfirmation?: string
  ) {
    const entry = this.previews.get(token);
    if (
      !entry ||
      entry.owner !== owner ||
      entry.preview.expiresAt <= this.now()
    )
      throw new Error("This review expired. Review the changes again.");
    const { preview, before, after } = entry;
    if (!preview.changes.length && !preview.retryingInterrupted)
      throw new Error("These settings already match. Nothing was changed.");
    if (
      (preview.confirmationPhrase &&
        (!acknowledgement || phrase !== preview.confirmationPhrase)) ||
      (preview.directTorrentConfirmation &&
        (!acknowledgement || torrentConfirmation !== "ENABLE DIRECT TORRENTS"))
    )
      throw new Error(
        "Complete the acknowledgement and confirmation phrase first."
      );
    const blocked = this.adapter.blocked(preview.target);
    if (blocked) throw new Error(blocked);
    // Consume synchronously, before awaiting locks, so double submissions cannot run.
    this.previews.delete(token);
    return this.adapter.exclusive(preview.target, async () => {
      if (!resetValuesEqual(await this.adapter.read(preview.target), before))
        throw new Error(
          "Settings changed since this review. Review the latest changes again."
        );
      const checkpoint = await this.adapter.checkpoint(preview.target);
      if (preview.restoring) {
        if (
          !resetValuesEqual(
            checkpoint.pending ?? checkpoint.previous,
            entry.snapshot
          )
        )
          throw new Error("The recovery snapshot changed. Review it again.");
        await this.adapter.saveCheckpoint(preview.target, {
          ...checkpoint,
          pending: entry.snapshot,
        });
        try {
          await this.adapter.write(preview.target, after, torrentConfirmation);
          await this.adapter.saveCheckpoint(preview.target, {
            previous: entry.snapshot,
          });
        } catch (error) {
          throw new Error(
            "Settings recovery did not finish. Some settings may have changed. The recovery snapshot is retained; reload and review it again.",
            { cause: error }
          );
        }
      } else {
        const snapshot: ResetSnapshot = {
          version: 1,
          savedAt: new Date(this.now()).toISOString(),
          values: structuredClone(before),
        };
        // Persist recovery before touching live settings. Keep the previous usable snapshot until completion.
        await this.adapter.saveCheckpoint(preview.target, {
          ...checkpoint,
          pending: snapshot,
        });
        if (
          !resetValuesEqual(await this.adapter.read(preview.target), before)
        ) {
          await this.adapter.saveCheckpoint(preview.target, checkpoint);
          throw new Error(
            "Settings changed while preparing recovery. Nothing was reset; review again."
          );
        }
        try {
          await this.adapter.write(preview.target, after, torrentConfirmation);
          await this.adapter.saveCheckpoint(preview.target, {
            previous: snapshot,
          });
        } catch (error) {
          throw new Error(
            "The reset did not finish. Some settings may have changed. A recovery snapshot was saved; reload and use Restore previous settings.",
            { cause: error }
          );
        }
      }
      return this.status(preview.target);
    });
  }
}
