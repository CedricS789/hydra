import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { describe, it, type TestContext } from "node:test";
import { build } from "esbuild";
import type { Game, SteamAchievement } from "@types";

async function loadUnlockNotificationsModule(t: TestContext) {
  const key = `__unlockNotif${randomUUID().replaceAll("-", "")}`;
  const state = {
    enqueued: [] as Array<{
      position: string;
      achievements: Array<{
        title: string;
        points?: number;
        isRare: boolean;
        isPlatinum: boolean;
      }>;
    }>,
    sentInApp: [] as Array<{
      position: string;
      achievements: Array<{
        title: string;
        points?: number;
        isRare: boolean;
        isPlatinum: boolean;
      }>;
    }>,
    osPublished: [] as unknown[],
  };
  (globalThis as unknown as Record<string, unknown>)[key] = state;
  t.after(() => {
    delete (globalThis as unknown as Record<string, unknown>)[key];
  });

  const root = path.resolve("node_modules/.cache/lbx-1154-tests");
  await fs.mkdir(root, { recursive: true });
  const outfile = path.join(root, `${key}.mjs`);

  const stub = `const state = globalThis[${JSON.stringify(key)}];
    export const WindowManager = {
      sendAchievementToFocusedWindow: (position, achievements) => {
        state.sentInApp.push({ position, achievements });
        return true;
      },
    };
    export const publishNewAchievementNotification = async (info) => {
      state.osPublished.push(info);
    };
    export const achievementsLogger = { log: () => {}, error: () => {}, warn: () => {} };
    export const achievementNotificationPresenter = {
      enqueueAchievements: (position, achievements) => {
        state.enqueued.push({ position, achievements });
      },
    };
  `;

  await build({
    stdin: {
      contents: `export { buildAchievementNotificationInfo, publishAchievementUnlockNotifications } from './src/main/services/achievements/achievement-unlock-notifications.ts';`,
      resolveDir: process.cwd(),
      sourcefile: "unlock-notifications-fixture.ts",
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    plugins: [
      {
        name: "stub-electron-deps",
        setup(plugin) {
          plugin.onResolve({ filter: /.*/ }, (args) => {
            if (args.path.startsWith("node:")) {
              return { path: args.path, external: true };
            }
            if (args.path === "@shared") {
              return {
                path: path.resolve("src/shared/feature-preferences.ts"),
              };
            }
            if (
              args.path.endsWith("window-manager") ||
              args.path.endsWith("notifications") ||
              args.path.endsWith("logger") ||
              args.path.endsWith("achievement-notification-presenter-electron")
            ) {
              return { path: args.path, namespace: "stub" };
            }
            return null;
          });
          plugin.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
            contents: stub,
            loader: "js",
          }));
        },
      },
    ],
  });

  const mod = await import(pathToFileURL(outfile).href);
  return { mod, state };
}

const sampleAchievements: SteamAchievement[] = [
  {
    name: "ACH_RARE",
    displayName: "Rare Trophy",
    description: "Earned by few",
    icon: "https://example.com/icon.png",
    icongray: "https://example.com/gray.png",
    hidden: false,
    points: 2440,
  },
];

const sampleGame = {
  id: "steam:1",
  objectId: "1",
  shop: "steam",
  title: "Sample Game",
  iconUrl: null,
} as unknown as Game;

describe("achievement unlock notification Hydra points", () => {
  it("hides Hydra points on notifications by default while preserving rare status", async (t) => {
    const { mod, state } = await loadUnlockNotificationsModule(t);

    assert.equal(
      mod.buildAchievementNotificationInfo(sampleAchievements, false)[0].points,
      undefined
    );

    mod.publishAchievementUnlockNotifications({
      game: sampleGame,
      achievements: sampleAchievements,
      completesGame: false,
      unlockedAchievementCount: 1,
      totalAchievementCount: 10,
      userPreferences: null,
    });

    const delivered =
      process.platform === "linux"
        ? state.sentInApp[0]?.achievements
        : state.enqueued[0]?.achievements;
    assert.equal(delivered?.length, 1);
    assert.equal(delivered?.[0].title, "Rare Trophy");
    assert.equal(delivered?.[0].points, undefined);
    assert.equal(delivered?.[0].isRare, true);
  });

  it("includes Hydra points when showHydraAchievementPoints is enabled", async (t) => {
    const { mod, state } = await loadUnlockNotificationsModule(t);

    mod.publishAchievementUnlockNotifications({
      game: sampleGame,
      achievements: sampleAchievements,
      completesGame: false,
      unlockedAchievementCount: 1,
      totalAchievementCount: 10,
      userPreferences: { showHydraAchievementPoints: true },
    });

    const delivered =
      process.platform === "linux"
        ? state.sentInApp[0]?.achievements
        : state.enqueued[0]?.achievements;
    assert.equal(delivered?.length, 1);
    assert.equal(delivered?.[0].points, 2440);
    assert.equal(delivered?.[0].isRare, true);
  });
});
