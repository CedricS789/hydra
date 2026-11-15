export const DIRECT_TORRENT_CONFIRMATION = "ENABLE DIRECT TORRENTS";
export const DIRECT_TORRENT_DISABLED = "download_error_direct_torrent_disabled";

// Missing preferences (including installations upgrading from earlier builds)
// never grant access to the peer-to-peer engine.
export const allowsDirectTorrent = (
  preferences?: { allowDirectTorrent?: unknown } | null
) => preferences?.allowDirectTorrent === true;

export function validateDirectTorrentChange(
  current: { allowDirectTorrent?: unknown } | null,
  requested: { allowDirectTorrent?: unknown },
  confirmation?: string
) {
  if (!Object.hasOwn(requested, "allowDirectTorrent")) return;
  if (typeof requested.allowDirectTorrent !== "boolean") {
    throw new Error("Direct torrent permission must be true or false.");
  }
  if (
    requested.allowDirectTorrent &&
    !allowsDirectTorrent(current) &&
    confirmation !== DIRECT_TORRENT_CONFIRMATION
  ) {
    throw new Error(
      "Confirm direct peer-to-peer access in Downloads settings."
    );
  }
}
