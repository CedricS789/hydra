import { isArchiveOrgFileUri } from "./archive-org.js";
import { Downloader } from "./constants.js";

// Shared by the ordinary download picker and the isolated source browser.
const HOSTER_DOWNLOADERS: Readonly<Record<string, Downloader>> = {
  "gofile.io": Downloader.Gofile,
  "pixeldrain.com": Downloader.PixelDrain,
  "datanodes.to": Downloader.Datanodes,
  "www.mediafire.com": Downloader.Mediafire,
  "mediafire.com": Downloader.RealDebrid,
  "fuckingfast.co": Downloader.FuckingFast,
  "fuckingfast.net": Downloader.FuckingFast,
  "vikingfile.com": Downloader.VikingFile,
  "vik1ngfile.site": Downloader.VikingFile,
  "www.rootz.so": Downloader.Rootz,
  "filekeeper.net": Downloader.FileKeeper,
  "1fichier.com": Downloader.RealDebrid,
  "archive.org": Downloader.ArchiveOrg,
  "www.archive.org": Downloader.ArchiveOrg,
};

export const getDownloadersForUri = (uri: string): Downloader[] => {
  if (uri.startsWith("magnet:"))
    return [
      Downloader.Torrent,
      Downloader.Hydra,
      Downloader.TorBox,
      Downloader.RealDebrid,
      Downloader.Premiumize,
      Downloader.AllDebrid,
    ];
  try {
    const url = new URL(uri);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      (url.port && url.port !== "443")
    )
      return [];
    if (!Object.hasOwn(HOSTER_DOWNLOADERS, url.hostname)) return [];
    const downloader = HOSTER_DOWNLOADERS[url.hostname];
    if (downloader === Downloader.ArchiveOrg && !isArchiveOrgFileUri(url.href))
      return [];
    return [downloader];
  } catch {
    return [];
  }
};
