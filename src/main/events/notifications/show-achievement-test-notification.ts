import { registerEvent } from "../register-event";
import {
  achievementNotificationPresenter,
  WindowManager,
} from "@main/services";
import { db, levelKeys } from "@main/level";
import {
  generateAchievementCustomNotificationTest,
  isHydraAchievementPointsEnabled,
} from "@shared";
import type { UserPreferences } from "@types";
import { t } from "i18next";

const showAchievementTestNotification = async (
  _event: Electron.IpcMainInvokeEvent
) => {
  const userPreferences = await db
    .get<string, UserPreferences | null>(levelKeys.userPreferences, {
      valueEncoding: "json",
    })
    .catch(() => null);
  const language = userPreferences?.language ?? "en";
  const position =
    userPreferences?.achievementCustomNotificationPosition ?? "top-left";
  const showPoints = isHydraAchievementPointsEnabled(userPreferences);
  const testAchievements = [
    generateAchievementCustomNotificationTest(t, language, { showPoints }),
    generateAchievementCustomNotificationTest(t, language, {
      isRare: true,
      isHidden: true,
      showPoints,
    }),
    generateAchievementCustomNotificationTest(t, language, {
      isPlatinum: true,
      showPoints,
    }),
  ];

  if (process.platform === "linux") {
    WindowManager.sendAchievementToFocusedWindow(position, testAchievements);
    return;
  }

  if (process.platform === "win32") {
    achievementNotificationPresenter.enqueueAchievements(
      position,
      testAchievements
    );
  }
};

registerEvent(
  "showAchievementTestNotification",
  showAchievementTestNotification
);
