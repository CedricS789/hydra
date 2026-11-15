import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  TorrentClient,
  TorrentError,
  type TorrentBackend,
} from "./torrent-client.ts";

const backend = (overrides: Partial<TorrentBackend> = {}): TorrentBackend => ({
  initialize: async () => {},
  request: async () => '{"result":null}',
  shutdown: async () => {},
  ...overrides,
});

describe("native torrent client", () => {
  it("never initializes or dispatches any request when direct access is blocked", async () => {
    let nativeCalls = 0;
    const client = new TorrentClient(
      backend({
        initialize: async () => {
          nativeCalls++;
        },
        request: async () => {
          nativeCalls++;
          return '{"result":null}';
        },
        shutdown: async () => {
          nativeCalls++;
        },
      }),
      () => {
        throw new TorrentError("download_error_direct_torrent_disabled");
      }
    );
    await assert.rejects(client.initialize(), {
      code: "download_error_direct_torrent_disabled",
    });
    for (const method of [
      "status",
      "seed_status",
      "torrent_files",
      "action",
    ] as const)
      await assert.rejects(
        client.call(method, {
          action: "start",
          url: "magnet:?xt=urn:btih:example",
        }),
        { code: "download_error_direct_torrent_disabled" }
      );
    await client.shutdown();
    assert.equal(nativeCalls, 0);
  });

  it("revocation during initialization prevents a pending download from dispatching", async () => {
    let enabled = true;
    let finish!: () => void;
    let requests = 0;
    let stops = 0;
    const client = new TorrentClient(
      backend({
        initialize: () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
        request: async () => {
          requests++;
          return '{"result":null}';
        },
        shutdown: async () => {
          stops++;
        },
      }),
      () => {
        if (!enabled)
          throw new TorrentError("download_error_direct_torrent_disabled");
      }
    );
    const starting = client.call("action", { action: "start" });
    const rejected = assert.rejects(starting, {
      code: "download_error_direct_torrent_disabled",
    });
    enabled = false;
    const stopping = client.shutdown();
    finish();
    await Promise.all([rejected, stopping]);
    assert.equal(requests, 0);
    assert.equal(stops, 1);
  });

  it("can be explicitly re-enabled after shutdown, and re-blocked without reviving the engine", async () => {
    let enabled = false;
    let requests = 0;
    let starts = 0;
    const client = new TorrentClient(
      backend({
        initialize: async () => {
          starts++;
        },
        request: async () => {
          requests++;
          return '{"result":null}';
        },
      }),
      () => {
        if (!enabled)
          throw new TorrentError("download_error_direct_torrent_disabled");
      }
    );
    await client.shutdown();
    enabled = true;
    await client.initialize();
    await client.call("torrent_files");
    enabled = false;
    await client.shutdown();
    await assert.rejects(client.call("seed_status"), {
      code: "download_error_direct_torrent_disabled",
    });
    assert.equal(starts, 1);
    assert.equal(requests, 1);
  });

  it("shares initialization and preserves null results", async () => {
    let starts = 0;
    const client = new TorrentClient(
      backend({
        initialize: async () => {
          starts++;
        },
      })
    );
    assert.deepEqual(
      await Promise.all([client.call("status"), client.call("status")]),
      [{ data: null }, { data: null }]
    );
    assert.equal(starts, 1);
    await client.shutdown();
  });

  it("preserves application error fields", async () => {
    const client = new TorrentClient(
      backend({
        request: async () =>
          '{"error":{"code":"metadata_timeout","message":"metadata_timeout"}}',
      })
    );
    await assert.rejects(client.call("torrent_files"), (e: TorrentError) => {
      assert.equal(e.code, "metadata_timeout");
      assert.equal(e.response.data.error, "metadata_timeout");
      return true;
    });
    await client.shutdown();
  });

  it("rejects pending calls on shutdown and ignores late results", async () => {
    let finish!: (value: string) => void;
    const client = new TorrentClient(
      backend({
        request: () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      })
    );
    const pending = client.call("torrent_files");
    const rejected = assert.rejects(pending, { code: "torrent_shutdown" });
    await new Promise((resolve) => setImmediate(resolve));
    await client.shutdown();
    finish('{"result":{}}');
    await rejected;
    await assert.rejects(client.call("status"), { code: "torrent_shutdown" });
  });

  it("waits for shutdown before explicit reinitialization", async () => {
    let stop!: () => void;
    let starts = 0;
    const client = new TorrentClient(
      backend({
        initialize: async () => {
          starts++;
        },
        shutdown: () =>
          new Promise<void>((resolve) => {
            stop = resolve;
          }),
      })
    );
    await client.initialize();
    const stopping = client.shutdown();
    const restarting = client.initialize();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(starts, 1);
    stop();
    await stopping;
    await restarting;
    assert.equal(starts, 2);
  });
});
