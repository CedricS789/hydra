import { registerEvent } from "../register-event";
import { gamesSublevel, gamesShopAssetsSublevel, levelKeys } from "@main/level";
import { randomUUID } from "node:crypto";
import type { GameShop } from "@types";

export const addCustomGameToLibrary = async (
  _event: Electron.IpcMainInvokeEvent,
  title: string,
  executablePath?: string | null,
  iconUrl?: string | null,
  logoImageUrl?: string | null,
  libraryHeroImageUrl?: string | null,
  coverImageUrl?: string | null
) => {
  const objectId = randomUUID();
  const shop: GameShop = "custom";
  const gameKey = levelKeys.game(shop, objectId);
  const normalizedExecutable = executablePath?.trim() || null;

  if (normalizedExecutable) {
    const existingGames = await gamesSublevel.iterator().all();
    const existingGame = existingGames.find(
      ([_key, game]) =>
        game.executablePath === normalizedExecutable && !game.isDeleted
    );

    if (existingGame) {
      throw new Error(
        "A game with this executable path already exists in your library"
      );
    }
  }

  const assets = {
    updatedAt: Date.now(),
    objectId,
    shop,
    title,
    iconUrl: iconUrl || null,
    libraryHeroImageUrl: libraryHeroImageUrl || "",
    libraryImageUrl: libraryHeroImageUrl || iconUrl || "",
    logoImageUrl: logoImageUrl || "",
    logoPosition: null,
    coverImageUrl: coverImageUrl || iconUrl || "",
    downloadSources: [],
  };
  await gamesShopAssetsSublevel.put(gameKey, assets);

  const game = {
    title,
    iconUrl: iconUrl || null,
    logoImageUrl: logoImageUrl || null,
    libraryHeroImageUrl: libraryHeroImageUrl || null,
    objectId,
    shop,
    remoteId: null,
    isDeleted: false,
    playTimeInMilliseconds: 0,
    lastTimePlayed: null,
    addedToLibraryAt: new Date(),
    executablePath: normalizedExecutable,
    executablePathUpdatedAt: normalizedExecutable ? new Date() : null,
    launchOptions: null,
    favorite: false,
    automaticCloudSync: false,
    hasManuallyUpdatedPlaytime: false,
  };

  await gamesSublevel.put(gameKey, game);

  return game;
};

registerEvent("addCustomGameToLibrary", addCustomGameToLibrary);
