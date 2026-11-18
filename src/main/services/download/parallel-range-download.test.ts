import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import {
  DEFAULT_MAX_PARALLEL_RANGES,
  downloadParallelRanges,
  getRangeSizeForRequestBudget,
  PARALLEL_RANGE_SIZE,
} from "./parallel-range-download.js";
import {
  configureRangeStateDirectory,
  readRangeState,
} from "./range-download-state.js";

function createTestBuffer(size: number): Buffer {
  const buf = Buffer.allocUnsafe(size);
  for (let i = 0; i < size; i += 4) {
    buf.writeUInt32BE(i >>> 0, i);
  }
  return buf;
}

describe("downloadParallelRanges robustness", () => {
  let tmpDir: string;
  let rangeDir: string;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hydra-parallel-test-"));
    rangeDir = path.join(tmpDir, "ranges");
    fs.mkdirSync(rangeDir, { recursive: true });
    configureRangeStateDirectory(rangeDir);
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("scales range size up for large files within the request budget", () => {
    const small = getRangeSizeForRequestBudget(
      512 * 1024 * 1024,
      DEFAULT_MAX_PARALLEL_RANGES
    );
    assert.equal(small, PARALLEL_RANGE_SIZE);

    const huge = getRangeSizeForRequestBudget(
      148 * 1024 * 1024 * 1024,
      DEFAULT_MAX_PARALLEL_RANGES
    );
    assert.equal(huge, 256 * 1024 * 1024);
  });

  it("recovers from single-range HTTP 429 and mid-stream socket drops without failing healthy ranges", async () => {
    const payload = createTestBuffer(512 * 1024); // 512 KiB
    const etag = '"test-etag-v1"';
    let hitsOnSecondRange = 0;
    let hitsOnThirdRange = 0;
    let hitThirdRemainder = false;
    let maxConcurrent = 0;
    let activeRequests = 0;

    const server = http.createServer((req, res) => {
      activeRequests++;
      maxConcurrent = Math.max(maxConcurrent, activeRequests);
      res.on("close", () => {
        activeRequests--;
      });

      const rangeHeader = req.headers.range ?? "";
      const match = /^bytes=(\d+)-(\d+)$/.exec(rangeHeader);
      if (!match) {
        res.statusCode = 400;
        res.end();
        return;
      }
      const start = Number(match[1]);
      const end = Math.min(Number(match[2]), payload.length - 1);

      // Inject HTTP 429 on the 2nd 128 KiB range first attempt
      if (start === 128 * 1024) {
        hitsOnSecondRange++;
        if (hitsOnSecondRange === 1) {
          res.statusCode = 429;
          res.setHeader("Retry-After", "0");
          res.end();
          return;
        }
      }

      // Inject premature socket drop mid-stream on the 3rd range first attempt
      if (start === 256 * 1024) {
        hitsOnThirdRange++;
        if (hitsOnThirdRange === 1) {
          res.statusCode = 206;
          res.setHeader("ETag", etag);
          res.setHeader(
            "Content-Range",
            `bytes ${start}-${end}/${payload.length}`
          );
          res.setHeader("Content-Length", String(end - start + 1));
          res.write(payload.subarray(start, start + 16 * 1024));
          setTimeout(() => req.socket.destroy(), 10);
          return;
        }
      }
      if (start === 256 * 1024 + 16 * 1024) {
        hitThirdRemainder = true;
      }

      res.statusCode = 206;
      res.setHeader("ETag", etag);
      res.setHeader("Content-Range", `bytes ${start}-${end}/${payload.length}`);
      res.setHeader("Content-Length", String(end - start + 1));
      res.end(payload.subarray(start, end + 1));
    });

    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", () => resolve())
    );
    const { port } = server.address() as { port: number };
    const url = `http://127.0.0.1:${port}/archive.bin`;

    try {
      const filePath = path.join(tmpDir, "recovered.bin");
      fs.writeFileSync(filePath, "");

      const firstResponse = await fetch(url, {
        headers: { Range: `bytes=0-${128 * 1024 - 1}` },
      });

      const controller = new AbortController();
      let receivedBytes = 0;
      const complete = await downloadParallelRanges({
        url,
        headers: {},
        firstResponse,
        filePath,
        startByte: 0,
        total: payload.length,
        rangeSize: 128 * 1024,
        connectionCount: 4,
        checkpointIntervalMs: 250,
        maxRangeRetries: 4,
        signal: controller.signal,
        abort: () => controller.abort(),
        beforeChunk: async () => undefined,
        afterChunk: (length) => {
          receivedBytes += length;
        },
        onReadPending: () => undefined,
      });

      assert.equal(complete, true);
      assert.ok(hitsOnSecondRange >= 2);
      assert.equal(hitsOnThirdRange, 1);
      assert.equal(hitThirdRemainder, true);
      assert.ok(receivedBytes >= payload.length);
      assert.equal(readRangeState(filePath), null);
      assert.deepEqual(fs.readFileSync(filePath), payload);
    } finally {
      server.close();
    }
  });

  it("aborts and retries only a stalled range without killing sibling workers", async () => {
    const payload = createTestBuffer(256 * 1024);
    const etag = '"test-etag-stall"';
    let stalledAttempts = 0;

    const server = http.createServer((req, res) => {
      const match = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range ?? "");
      if (!match) {
        res.statusCode = 400;
        res.end();
        return;
      }
      const start = Number(match[1]);
      const end = Math.min(Number(match[2]), payload.length - 1);

      if (start === 64 * 1024 && stalledAttempts === 0) {
        stalledAttempts++;
        res.statusCode = 206;
        res.setHeader("ETag", etag);
        res.setHeader(
          "Content-Range",
          `bytes ${start}-${end}/${payload.length}`
        );
        res.setHeader("Content-Length", String(end - start + 1));
        res.write(payload.subarray(start, start + 4096));
        // Hold socket open without sending remaining bytes until aborted
        return;
      }

      res.statusCode = 206;
      res.setHeader("ETag", etag);
      res.setHeader("Content-Range", `bytes ${start}-${end}/${payload.length}`);
      res.setHeader("Content-Length", String(end - start + 1));
      res.end(payload.subarray(start, end + 1));
    });

    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", () => resolve())
    );
    const { port } = server.address() as { port: number };
    const url = `http://127.0.0.1:${port}/stall.bin`;

    try {
      const filePath = path.join(tmpDir, "stall-recovered.bin");
      fs.writeFileSync(filePath, "");
      const firstResponse = await fetch(url, {
        headers: { Range: `bytes=0-${64 * 1024 - 1}` },
      });

      const controller = new AbortController();
      const abortMap = new Map<number, () => void>();
      let abortedOtherOffset = false;

      const complete = await downloadParallelRanges({
        url,
        headers: {},
        firstResponse,
        filePath,
        startByte: 0,
        total: payload.length,
        rangeSize: 64 * 1024,
        connectionCount: 4,
        maxRangeRetries: 3,
        signal: controller.signal,
        abort: () => controller.abort(),
        beforeChunk: async () => undefined,
        afterChunk: () => undefined,
        onReadPending: (offset, pending) => {
          if (pending && offset === 64 * 1024 && stalledAttempts === 1) {
            setTimeout(() => {
              const abortRange = abortMap.get(64 * 1024);
              if (abortRange) abortRange();
              else abortedOtherOffset = true;
            }, 40);
          }
        },
        registerRangeAbort: (offset, abortFn) => {
          if (abortFn) abortMap.set(offset, abortFn);
          else abortMap.delete(offset);
        },
      });

      assert.equal(complete, true);
      assert.equal(abortedOtherOffset, false);
      assert.deepEqual(fs.readFileSync(filePath), payload);
    } finally {
      server.close();
    }
  });
});
