import assert from "node:assert/strict";
import test from "node:test";
import { getDownloadersForUri } from "./download-uri.js";
import { Downloader } from "./constants.js";

test("shared hoster recognition uses exact URL hosts and preserves supported methods", () => {
  const hosts: [string, Downloader][] = [
    ["gofile.io", Downloader.Gofile],
    ["pixeldrain.com", Downloader.PixelDrain],
    ["datanodes.to", Downloader.Datanodes],
    ["www.mediafire.com", Downloader.Mediafire],
    ["mediafire.com", Downloader.RealDebrid],
    ["fuckingfast.co", Downloader.FuckingFast],
    ["fuckingfast.net", Downloader.FuckingFast],
    ["vikingfile.com", Downloader.VikingFile],
    ["vik1ngfile.site", Downloader.VikingFile],
    ["www.rootz.so", Downloader.Rootz],
    ["filekeeper.net", Downloader.FileKeeper],
    ["1fichier.com", Downloader.RealDebrid],
  ];
  for (const [host, method] of hosts) {
    assert.deepEqual(getDownloadersForUri(`https://${host}/file`), [method]);
    for (const url of [
      `https://${host}.evil.example/file`,
      `https://${host}@evil.example/file`,
      `https://${host}:8443/file`,
      `http://${host}/file`,
    ])
      assert.deepEqual(getDownloadersForUri(url), []);
  }
  assert.deepEqual(getDownloadersForUri("not a URL"), []);
  assert.deepEqual(getDownloadersForUri("https://archive.org/"), []);
  assert.ok(
    getDownloadersForUri(`magnet:?xt=urn:btih:${"a".repeat(40)}`).includes(
      Downloader.RealDebrid
    )
  );
});
