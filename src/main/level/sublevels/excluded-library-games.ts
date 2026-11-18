import type { ExcludedLibraryGame } from "@types";

import { db } from "../level";
import { levelKeys } from "./keys";

export const excludedLibraryGamesSublevel = db.sublevel<
  string,
  ExcludedLibraryGame
>(levelKeys.excludedLibraryGames, {
  valueEncoding: "json",
});
