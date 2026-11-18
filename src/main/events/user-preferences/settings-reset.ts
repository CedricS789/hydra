import type { UserPreferences, LudusaviLocalSettings } from "@types";
import { db, gamesSublevel, themesSublevel, levelKeys } from "@main/level";
import { WindowManager } from "@main/services/window-manager";
import { achievementNotificationPresenter } from "@main/services";
import { hasTrackedGamesRunning } from "@main/services/game-running-state";
import {
  getLudusaviLocalSettings,
  persistLudusaviLocalSettings,
  localSaveTools,
} from "@main/services/ludusavi-local";
import { NativeAddon } from "@main/services/native-addon";
import { acquireSaveBackupLock } from "@main/services/ludusavi-local-lock";
import {
  SettingsResetEngine,
  type ResetValues,
  type ResetCheckpoint,
} from "@main/services/settings-reset-engine";
import {
  BACKUP_BEHAVIOR_DEFAULTS,
  GAME_RULE_DEFAULTS,
  SETTINGS_RESET_GROUPS,
  resetPreferenceDefaults,
  withResetDefaults,
  type SettingsResetTarget,
  type PreferenceResetGroup,
} from "../../../shared/settings-reset";
import { registerEvent } from "../register-event";
import {
  applyUserPreferences,
  withUserPreferencesLock,
} from "./update-user-preferences";

function validateTarget(input: SettingsResetTarget): SettingsResetTarget {
  if (
    !input ||
    typeof input !== "object" ||
    (!Object.hasOwn(SETTINGS_RESET_GROUPS, input.group) &&
      !["combined", "backups", "gameRules"].includes(input.group))
  )
    throw new Error("Unknown reset group.");
  if (input.group === "gameRules") {
    if (
      typeof input.gameKey !== "string" ||
      !input.gameKey ||
      input.gameKey.length > 1000
    )
      throw new Error("Select a library game.");
    return { group: input.group, gameKey: input.gameKey };
  }
  if (input.gameKey !== undefined)
    throw new Error("A game is only valid for a game-rules reset.");
  return { group: input.group };
}
const backupTarget = (target: SettingsResetTarget) =>
  target.group === "backups" || target.group === "gameRules";
const themeTarget = (target: SettingsResetTarget) =>
  target.group === "appearance" || target.group === "combined";
const checkpointKey = (target: SettingsResetTarget) =>
  `settingsReset:v1:${JSON.stringify([target.group, target.gameKey ?? null])}`;
const select = (source: object, keys: string[]) =>
  Object.fromEntries(keys.map((key) => [key, source[key]]));

export const settingsResetEngine = new SettingsResetEngine({
  defaults(target) {
    if (target.group === "backups") return { ...BACKUP_BEHAVIOR_DEFAULTS };
    if (target.group === "gameRules")
      return {
        ...structuredClone(GAME_RULE_DEFAULTS),
        manifestTitle: null,
        steamId: null,
      };
    return {
      ...resetPreferenceDefaults(target.group),
      ...(themeTarget(target) ? { activeThemes: [] } : {}),
    };
  },
  async title(target) {
    if (target.group === "gameRules") {
      const game = await gamesSublevel.get(target.gameKey!);
      if (!game || game.isDeleted)
        throw new Error("The selected game no longer exists.");
      return game.title;
    }
    return target.group;
  },
  async read(target) {
    if (backupTarget(target)) {
      const settings = await getLudusaviLocalSettings();
      if (target.group === "backups")
        return select(settings, Object.keys(BACKUP_BEHAVIOR_DEFAULTS));
      const game = await gamesSublevel.get(target.gameKey!);
      if (!game || game.isDeleted)
        throw new Error("The selected game no longer exists.");
      const gameSettings = settings.games[target.gameKey!];
      return {
        enabled: gameSettings?.enabled ?? true,
        savePaths: gameSettings?.savePaths ?? [],
        trackingPaths: gameSettings?.trackingPaths ?? [],
        manifestTitle: gameSettings?.manifestTitle ?? null,
        steamId: gameSettings?.steamId ?? null,
      };
    }
    const preferences = withResetDefaults(
      await db.get<string, UserPreferences>(levelKeys.userPreferences, {
        valueEncoding: "json",
      })
    );
    const values = select(
      preferences,
      Object.keys(
        resetPreferenceDefaults(
          target.group as PreferenceResetGroup | "combined"
        )
      )
    );
    if (themeTarget(target))
      values.activeThemes = (await themesSublevel.values().all())
        .filter((theme) => theme.isActive)
        .map((theme) => theme.id)
        .sort();
    return values;
  },
  blocked(target) {
    if (
      backupTarget(target) &&
      (localSaveTools.queue.busy || hasTrackedGamesRunning())
    )
      return "Stop running games and wait for all save operations or the full manager to finish first.";
    return undefined;
  },
  async exclusive(target, task) {
    if (backupTarget(target)) {
      if (localSaveTools.queue.busy || hasTrackedGamesRunning())
        throw new Error(
          "Stop running games and wait for save operations or the full manager to finish."
        );
      return localSaveTools.queue.enqueue("settings:reset", async () => {
        if (hasTrackedGamesRunning())
          throw new Error(
            "Stop running games before changing backup settings."
          );
        const settings = await getLudusaviLocalSettings();
        const lock = await acquireSaveBackupLock(settings.destination);
        try {
          // Check actual native process paths as well as tracked sessions.
          const games = await gamesSublevel.values().all();
          const processes = await NativeAddon.getSystemProcessMap();
          for (const game of games) {
            if (!game.isDeleted)
              await localSaveTools.assertStopped(
                game,
                settings,
                false,
                processes
              );
          }
          return await task();
        } finally {
          await lock.release();
        }
      });
    }
    return withUserPreferencesLock(task);
  },
  async checkpoint(target) {
    return (
      (await db.get<string, ResetCheckpoint>(checkpointKey(target), {
        valueEncoding: "json",
      })) ?? {}
    );
  },
  async saveCheckpoint(target, checkpoint) {
    await db.put(checkpointKey(target), checkpoint, {
      valueEncoding: "json",
      sync: true,
    });
  },
  async write(target, values: ResetValues, torrentConfirmation) {
    if (backupTarget(target)) {
      const settings = await getLudusaviLocalSettings();
      let next: LudusaviLocalSettings;
      if (target.group === "backups")
        next = { ...settings, ...values } as LudusaviLocalSettings;
      else {
        const game = { ...settings.games[target.gameKey!], ...values };
        if (game.manifestTitle === null) delete game.manifestTitle;
        if (game.steamId === null) delete game.steamId;
        next = {
          ...settings,
          games: {
            ...settings.games,
            [target.gameKey!]:
              game as unknown as LudusaviLocalSettings["games"][string],
          },
        };
      }
      if (hasTrackedGamesRunning())
        throw new Error(
          "A game started during this review. Stop it and review the settings again."
        );
      await persistLudusaviLocalSettings(next);
      return;
    }
    const { activeThemes, ...preferences } = values;
    if (themeTarget(target)) {
      const themes = await themesSublevel.values().all();
      const wanted = activeThemes as string[];
      if (wanted.some((id) => !themes.some((theme) => theme.id === id)))
        throw new Error(
          "A previously active theme has been removed. Reinstall it before restoring these settings."
        );
      await themesSublevel.batch(
        themes
          .filter((theme) => theme.isActive !== wanted.includes(theme.id))
          .map((theme) => ({
            type: "put" as const,
            key: theme.id,
            value: { ...theme, isActive: wanted.includes(theme.id) },
          }))
      );
      achievementNotificationPresenter.notifyThemeUpdated();
      WindowManager.sendToAppWindows("on-custom-theme-updated");
    }
    await applyUserPreferences(
      {} as Electron.IpcMainInvokeEvent,
      preferences as Partial<UserPreferences>,
      torrentConfirmation
    );
  },
});

registerEvent("getSettingsResetStatus", (_event, input: SettingsResetTarget) =>
  settingsResetEngine.status(validateTarget(input))
);
registerEvent(
  "previewSettingsReset",
  (event, input: SettingsResetTarget, restoring: boolean) => {
    if (typeof restoring !== "boolean")
      throw new Error("Choose reset or recovery.");
    return settingsResetEngine.preview(
      event.sender.id,
      validateTarget(input),
      restoring
    );
  }
);
registerEvent(
  "applySettingsReset",
  (
    event,
    token: string,
    acknowledged: boolean,
    phrase: string,
    torrentConfirmation?: string
  ) => {
    if (
      typeof token !== "string" ||
      typeof acknowledged !== "boolean" ||
      typeof phrase !== "string" ||
      (torrentConfirmation !== undefined &&
        typeof torrentConfirmation !== "string")
    )
      throw new Error("Invalid settings review.");
    return settingsResetEngine.apply(
      event.sender.id,
      token,
      acknowledged,
      phrase,
      torrentConfirmation
    );
  }
);
