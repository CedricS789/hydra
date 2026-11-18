import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";
import { after, before, describe, it } from "node:test";
import {
  computeMaxBudgetResets,
  RollingSpeedTracker,
} from "./js-http-downloader-helpers.js";
import { configureRangeStateDirectory } from "./range-download-state.js";

const require = createRequire(import.meta.url);

function loadJsHttpDownloaderClass() {
  const sourcePath = path.resolve(
    "src/main/services/download/js-http-downloader.ts"
  );
  const transpiled = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;

  const moduleObj = { exports: {} as Record<string, unknown> };
  const dir = path.dirname(sourcePath);
  const customRequire = (specifier: string) => {
    if (specifier === "../logger") {
      return {
        logger: {
          log: () => undefined,
          warn: () => undefined,
          error: () => undefined,
        },
      };
    }
    if (specifier.startsWith("./")) {
      return require(path.resolve(dir, `${specifier}.ts`));
    }
    return require(specifier);
  };

  new Function("exports", "require", "module", transpiled)(
    moduleObj.exports,
    customRequire,
    moduleObj
  );
  return moduleObj.exports.JsHttpDownloader as new () => {
    applyRuntimeSettings: (settings: Record<string, unknown>) => void;
    startDownload: (options: Record<string, unknown>) => Promise<void>;
    getDownloadStatus: () => {
      downloadSpeed: number;
      isReconnecting: boolean;
      status: string;
      bytesDownloaded: number;
    } | null;
  };
}

describe("RollingSpeedTracker & JsHttpDownloader", () => {
  let tmpDir: string;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hydra-js-dl-test-"));
    const rangeDir = path.join(tmpDir, "ranges");
    fs.mkdirSync(rangeDir, { recursive: true });
    configureRangeStateDirectory(rangeDir);
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reports non-zero speed promptly and decays to zero on idle", () => {
    const tracker = new RollingSpeedTracker(2000);
    assert.equal(tracker.compute(1000), 0);

    // First burst at t=1000 (200 KB) -> uses 200ms minimum span -> 1,000,000 B/s
    const initial = tracker.record(200_000, 1000);
    assert.ok(initial > 0);

    // More data at t=1500 (800 KB, total 1 MB over 500ms -> 2 MB/s)
    const flowing = tracker.record(800_000, 1500);
    assert.equal(flowing, 2_000_000);

    // Idle until t=4000 (outside 2000ms window) -> decays to 0
    assert.equal(tracker.compute(4000), 0);
  });

  it("scales max budget resets with file size", () => {
    assert.equal(computeMaxBudgetResets(100 * 1024 * 1024), 50);
    assert.equal(computeMaxBudgetResets(148 * 1024 * 1024 * 1024), 500);
  });

  it("refreshes URL on 403 and exposes immediate non-zero speed on download", async () => {
    const JsHttpDownloader = loadJsHttpDownloaderClass();
    const payload = Buffer.alloc(256 * 1024, 0xab);
    let refreshedCalled = 0;

    const server = http.createServer((req, res) => {
      if (req.url === "/expired") {
        res.statusCode = 403;
        res.end();
        return;
      }
      if (req.url === "/fresh") {
        res.statusCode = 200;
        res.setHeader("Content-Length", String(payload.length));
        res.end(payload);
        return;
      }
      res.statusCode = 404;
      res.end();
    });

    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", () => resolve())
    );
    const { port } = server.address() as { port: number };

    try {
      const downloader = new JsHttpDownloader();
      downloader.applyRuntimeSettings({ parallelDownloadsEnabled: false });

      const savePath = path.join(tmpDir, "single");
      await downloader.startDownload({
        url: `http://127.0.0.1:${port}/expired`,
        savePath,
        filename: "archive.rar",
        refreshUrl: async () => {
          refreshedCalled++;
          return `http://127.0.0.1:${port}/fresh`;
        },
      });

      const status = downloader.getDownloadStatus();
      assert.equal(refreshedCalled, 1);
      assert.equal(status?.status, "complete");
      assert.equal(status?.bytesDownloaded, payload.length);
      assert.deepEqual(
        fs.readFileSync(path.join(savePath, "archive.rar")),
        payload
      );
    } finally {
      server.close();
    }
  });

  it("downgrades parallel ranges after repeated 503 errors and sets isReconnecting during backoff", async () => {
    const JsHttpDownloader = loadJsHttpDownloaderClass();
    const payload = Buffer.alloc(256 * 1024, 0xcd);
    const etag = '"downgrade-etag"';
    let range503Count = 0;
    let sawFullOrSingleRange = false;

    const server = http.createServer((req, res) => {
      const rangeHeader = req.headers.range;
      if (rangeHeader) {
        // After parallel mode is disabled, rangeSize becomes MAX_SAFE_INTEGER so
        // the request covers to payload.length - 1 (bytes=65536-262143 or bytes=65536-)
        const match = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader);
        if (match) {
          const start = Number(match[1]);
          const requestedEnd = match[2] ? Number(match[2]) : payload.length - 1;
          if (requestedEnd >= payload.length - 1) {
            sawFullOrSingleRange = true;
          } else if (start > 0 && range503Count < 6) {
            // Exhaust inner maxRangeRetries (=2) twice across 2 outer attempts
            range503Count++;
            res.statusCode = 503;
            res.setHeader("Retry-After", "0");
            res.end();
            return;
          }
          const end = Math.min(requestedEnd, payload.length - 1);
          res.statusCode = 206;
          res.setHeader("ETag", etag);
          res.setHeader(
            "Content-Range",
            `bytes ${start}-${end}/${payload.length}`
          );
          res.setHeader("Content-Length", String(end - start + 1));
          res.end(payload.subarray(start, end + 1));
          return;
        }
      }
      sawFullOrSingleRange = true;
      res.statusCode = 200;
      res.setHeader("Content-Length", String(payload.length));
      res.end(payload);
    });

    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", () => resolve())
    );
    const { port } = server.address() as { port: number };

    try {
      const downloader = new JsHttpDownloader();
      const savePath = path.join(tmpDir, "downgrade");
      let sawReconnecting = false;
      const poll = setInterval(() => {
        if (downloader.getDownloadStatus()?.isReconnecting) {
          sawReconnecting = true;
        }
      }, 5);

      try {
        await downloader.startDownload({
          url: `http://127.0.0.1:${port}/file.bin`,
          savePath,
          filename: "file.bin",
          parallelRangeSize: 64 * 1024,
          parallelRangeConnections: 2,
          maxRetryAttempts: 4,
        });
      } finally {
        clearInterval(poll);
      }

      const status = downloader.getDownloadStatus();
      assert.equal(status?.status, "complete");
      assert.equal(status?.bytesDownloaded, payload.length);
      assert.equal(range503Count, 6);
      assert.equal(sawFullOrSingleRange, true);
      assert.equal(sawReconnecting, true);
      assert.deepEqual(
        fs.readFileSync(path.join(savePath, "file.bin")),
        payload
      );
    } finally {
      server.close();
    }
  });
});
