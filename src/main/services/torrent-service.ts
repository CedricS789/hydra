import { NativeAddon } from "./native-addon";
import { TorrentClient, TorrentError } from "./torrent-client";
import { DIRECT_TORRENT_DISABLED } from "../../shared/direct-torrent-policy";

let directTorrentAllowed = false;
export const isDirectTorrentAllowed = () => directTorrentAllowed;
export const assertDirectTorrentAllowed = () => {
  if (!directTorrentAllowed) throw new TorrentError(DIRECT_TORRENT_DISABLED);
};

export const TorrentService = new TorrentClient(
  {
    initialize: (port) => NativeAddon.torrentInitialize(port),
    request: (method, params) => NativeAddon.torrentRequest(method, params),
    shutdown: () => NativeAddon.torrentShutdown(),
  },
  assertDirectTorrentAllowed
);

export async function setDirectTorrentAccess(enabled: boolean) {
  directTorrentAllowed = enabled === true;
  // Revoke before awaiting shutdown: no concurrent metadata/start/poll request
  // may revive the engine while its sessions are being closed.
  if (!directTorrentAllowed) await TorrentService.shutdown();
  else await TorrentService.initialize();
}
