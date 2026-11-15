import type { GameRepack } from "@types";

export interface DownloadSourceMetadata {
  repackTitle?: string | null;
  downloadSourceName?: string | null;
  repackFileSize?: string | null;
  uploadDate?: string | null;
}

const normalizeOptionalString = (
  value?: string | null
): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export const pickDownloadSourceMetadata = (
  metadata?: DownloadSourceMetadata | null
): DownloadSourceMetadata => {
  const repackTitle = normalizeOptionalString(metadata?.repackTitle);
  const downloadSourceName = normalizeOptionalString(
    metadata?.downloadSourceName
  );
  const repackFileSize = normalizeOptionalString(metadata?.repackFileSize);
  const uploadDate = normalizeOptionalString(metadata?.uploadDate);

  return {
    ...(repackTitle ? { repackTitle } : {}),
    ...(downloadSourceName ? { downloadSourceName } : {}),
    ...(repackFileSize ? { repackFileSize } : {}),
    ...(uploadDate ? { uploadDate } : {}),
  };
};

export const pickDownloadSourceMetadataFromRepack = (
  repack?: Pick<
    GameRepack,
    "title" | "downloadSourceName" | "fileSize" | "uploadDate"
  > | null
): DownloadSourceMetadata =>
  pickDownloadSourceMetadata({
    repackTitle: repack?.title,
    downloadSourceName: repack?.downloadSourceName,
    repackFileSize: repack?.fileSize,
    uploadDate: repack?.uploadDate,
  });

export const hasDownloadSourceMetadata = (
  metadata?: DownloadSourceMetadata | null
): boolean =>
  Boolean(
    normalizeOptionalString(metadata?.repackTitle) ||
      normalizeOptionalString(metadata?.downloadSourceName)
  );

export const findMatchingRepackForUri = (
  repacks: readonly GameRepack[],
  uri?: string | null
): GameRepack | null => {
  const targetUri = normalizeOptionalString(uri);
  if (!targetUri || repacks.length === 0) return null;

  const exactMatch = repacks.find((repack) =>
    repack.uris?.some((repackUri) => normalizeOptionalString(repackUri) === targetUri)
  );
  if (exactMatch) return exactMatch;

  return (
    repacks.find((repack) =>
      repack.uris?.some((repackUri) => {
        const normalized = normalizeOptionalString(repackUri);
        return Boolean(normalized && normalized.includes(targetUri));
      })
    ) ?? null
  );
};

export const formatDownloadSourceSummary = (
  metadata: Pick<
    DownloadSourceMetadata,
    "repackFileSize" | "downloadSourceName" | "uploadDate"
  > | null | undefined,
  formatDate: (date: string) => string
): string => {
  if (!metadata) return "";

  const uploadDate = normalizeOptionalString(metadata.uploadDate);
  let formattedUploadDate: string | undefined;

  if (uploadDate && !Number.isNaN(Date.parse(uploadDate))) {
    try {
      formattedUploadDate = normalizeOptionalString(formatDate(uploadDate));
    } catch {
      formattedUploadDate = undefined;
    }
  }

  return [
    normalizeOptionalString(metadata.repackFileSize),
    normalizeOptionalString(metadata.downloadSourceName),
    formattedUploadDate,
  ]
    .filter((part): part is string => Boolean(part))
    .join(" - ");
};
