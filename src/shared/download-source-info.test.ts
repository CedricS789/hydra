import test from "node:test";
import assert from "node:assert/strict";
import type { GameRepack } from "@types";
import {
  findMatchingRepackForUri,
  formatDownloadSourceSummary,
  hasDownloadSourceMetadata,
  pickDownloadSourceMetadata,
  pickDownloadSourceMetadataFromRepack,
} from "./download-source-info";

const makeRepack = (overrides: Partial<GameRepack> = {}): GameRepack => ({
  id: overrides.id ?? "repack-1",
  title: overrides.title ?? "DRAGON BALL Z: KAKAROT Free Download (v2.30)",
  fileSize:
    overrides.fileSize === undefined ? "111.7 GB" : overrides.fileSize,
  uris: overrides.uris ?? ["https://example.com/archive.rar"],
  uriGroups: overrides.uriGroups,
  unavailableUris: overrides.unavailableUris ?? [],
  uploadDate:
    overrides.uploadDate === undefined
      ? "2026-02-22T00:00:00.000Z"
      : overrides.uploadDate,
  downloadSourceId: overrides.downloadSourceId ?? "src-1",
  downloadSourceName: overrides.downloadSourceName ?? "SteamRip",
  createdAt: overrides.createdAt ?? "2026-02-22T00:00:00.000Z",
});

test("pickDownloadSourceMetadataFromRepack maps repack fields and trims blanks", () => {
  const result = pickDownloadSourceMetadataFromRepack(
    makeRepack({
      title: "  DRAGON BALL Z: KAKAROT Free Download (v2.30)  ",
      downloadSourceName: "SteamRip",
      fileSize: "111.7 GB",
      uploadDate: "2026-02-22T00:00:00.000Z",
    })
  );

  assert.deepEqual(result, {
    repackTitle: "DRAGON BALL Z: KAKAROT Free Download (v2.30)",
    downloadSourceName: "SteamRip",
    repackFileSize: "111.7 GB",
    uploadDate: "2026-02-22T00:00:00.000Z",
  });
});

test("pickDownloadSourceMetadata omits nullish and empty fields", () => {
  const result = pickDownloadSourceMetadata({
    repackTitle: "  ",
    downloadSourceName: "FitGirl",
    repackFileSize: null,
    uploadDate: undefined,
  });

  assert.deepEqual(result, {
    downloadSourceName: "FitGirl",
  });
});

test("hasDownloadSourceMetadata requires title or source name", () => {
  assert.equal(hasDownloadSourceMetadata(null), false);
  assert.equal(hasDownloadSourceMetadata({ repackFileSize: "40 GB" }), false);
  assert.equal(
    hasDownloadSourceMetadata({ downloadSourceName: "DODI" }),
    true
  );
  assert.equal(
    hasDownloadSourceMetadata({ repackTitle: "Game Repack v1.0" }),
    true
  );
});

test("findMatchingRepackForUri prefers exact match then substring match", () => {
  const substringRepack = makeRepack({
    id: "repack-sub",
    downloadSourceName: "MirrorB",
    uris: ["https://cdn.example.com/file.zip?mirror=1"],
  });
  const exactRepack = makeRepack({
    id: "repack-exact",
    downloadSourceName: "SteamRip",
    uris: ["https://cdn.example.com/file.zip"],
  });

  assert.equal(
    findMatchingRepackForUri(
      [substringRepack, exactRepack],
      "https://cdn.example.com/file.zip"
    )?.id,
    "repack-exact"
  );

  assert.equal(
    findMatchingRepackForUri([substringRepack], "file.zip")?.id,
    "repack-sub"
  );

  assert.equal(
    findMatchingRepackForUri([substringRepack], "https://other.invalid/none"),
    null
  );
});

test("formatDownloadSourceSummary matches download options format and tolerates missing/invalid dates", () => {
  const formatted = formatDownloadSourceSummary(
    {
      repackFileSize: "111.7 GB",
      downloadSourceName: "SteamRip",
      uploadDate: "2026-02-22T00:00:00.000Z",
    },
    () => "22/02/2026"
  );
  assert.equal(formatted, "111.7 GB - SteamRip - 22/02/2026");

  const withoutDate = formatDownloadSourceSummary(
    {
      repackFileSize: "41.2 GB",
      downloadSourceName: "FitGirl",
      uploadDate: "not-a-date",
    },
    () => {
      throw new Error("should not format invalid date");
    }
  );
  assert.equal(withoutDate, "41.2 GB - FitGirl");

  const withoutSize = formatDownloadSourceSummary(
    {
      downloadSourceName: "DODI",
      uploadDate: "2023-08-19T00:00:00.000Z",
    },
    () => "19/08/2023"
  );
  assert.equal(withoutSize, "DODI - 19/08/2023");
});
