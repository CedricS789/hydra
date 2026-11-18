import fs from "node:fs";
import {
  isRetryableDownloadError,
  isRetryableHttpStatus,
  parseRetryAfterMs,
} from "./js-http-downloader-helpers.js";
import {
  markSavedRange,
  missingRanges,
  rangeResourceId,
  readRangeState,
  removeRangeState,
  saveRangeState,
  type RangeDownloadState,
} from "./range-download-state.js";

const PARALLEL_RANGE_FAILURE_LIMIT = 2;
const MAX_PARALLEL_CONNECTIONS = 16;
const RANGE_CHECKPOINT_INTERVAL_MS = 5000;
const STRONG_LAST_MODIFIED_AGE_MS = 60_000;
const MAX_RETRY_AFTER_MS = 20_000;
const DEFAULT_PER_RANGE_RETRIES = 4;
const CLEAN_RANGES_BEFORE_SCALE_UP = 8;

export const PARALLEL_RANGE_SIZE = 8 * 1024 * 1024;
export const PARALLEL_RANGE_COUNT = 4;
export const MAX_PARALLEL_RANGE_SIZE = 256 * 1024 * 1024;
export const DEFAULT_MAX_PARALLEL_RANGES = 256;

export function getRangeSizeForRequestBudget(
  totalBytes: number,
  maxRanges: number
): number {
  if (!Number.isSafeInteger(totalBytes) || totalBytes <= 0) {
    return PARALLEL_RANGE_SIZE;
  }
  const units = Math.ceil(totalBytes / (maxRanges * PARALLEL_RANGE_SIZE));
  return Math.min(
    MAX_PARALLEL_RANGE_SIZE,
    Math.max(PARALLEL_RANGE_SIZE, units * PARALLEL_RANGE_SIZE)
  );
}

export class ParallelRangeUnsupportedError extends Error {
  readonly retryable = true;
}

export class ParallelRangeHttpStatusError extends Error {
  readonly statusCode: number;
  readonly retryAfter: string | null;

  constructor(statusCode: number, retryAfter: string | null) {
    super(`Byte range server returned HTTP ${statusCode}`);
    this.statusCode = statusCode;
    this.retryAfter = retryAfter;
  }
}

class RangeStallError extends Error {
  readonly retryable = true;

  constructor() {
    super("Byte range stalled with no data");
    this.name = "RangeStallError";
  }
}

export function shouldDowngradeParallelRanges(
  error: unknown,
  failureCount: number
): boolean {
  return (
    error instanceof ParallelRangeUnsupportedError ||
    failureCount >= PARALLEL_RANGE_FAILURE_LIMIT
  );
}

export function getRangeTotal(
  response: Response,
  start: number,
  end: number
): number | null {
  if (response.status !== 206) return null;
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/i.exec(
    response.headers.get("content-range") ?? ""
  );
  if (!match) return null;

  const [, actualStart, actualEnd, totalValue] = match;
  const total = Number(totalValue);
  const encoding = response.headers.get("content-encoding")?.toLowerCase();
  if (
    Number(actualStart) !== start ||
    Number(actualEnd) !== Math.min(end, total - 1) ||
    !Number.isSafeInteger(total) ||
    total <= start ||
    (encoding && encoding !== "identity")
  ) {
    return null;
  }

  const length = response.headers.get("content-length");
  if (length && Number(length) !== Number(actualEnd) - start + 1) {
    return null;
  }
  return total;
}

function parseContentRangeSpan(
  response: Response
): { start: number; end: number; total: number } | null {
  if (response.status !== 206) return null;
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/i.exec(
    response.headers.get("content-range") ?? ""
  );
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = Number(match[3]);
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    !Number.isSafeInteger(total) ||
    start < 0 ||
    end < start ||
    total <= end
  ) {
    return null;
  }
  return { start, end, total };
}

export function getStrongRangeValidator(response: Response): string | null {
  const etag = response.headers.get("etag");
  if (etag !== null) {
    return /^"[\x21\x23-\x7e\x80-\xff]*"$/.test(etag) ? etag : null;
  }
  const modified = response.headers.get("last-modified");
  const date = response.headers.get("date");
  // RFC 9110 8.8.2.2 permits a date validator when the clocks are far enough
  // apart. Keep the conservative 60-second margin used by older HTTP specs.
  return modified &&
    date &&
    Number.isFinite(Date.parse(modified)) &&
    Number.isFinite(Date.parse(date)) &&
    Date.parse(date) - Date.parse(modified) >= STRONG_LAST_MODIFIED_AGE_MS
    ? modified
    : null;
}

export function getRangeResumeCapability(
  response: Response,
  requestedRange: string | undefined,
  ifRange?: string
): "unknown" | "supported" | "unsupported" {
  const range = /^bytes=(\d+)-(\d*)$/.exec(requestedRange ?? "");
  if (!range) return "unknown";
  if (
    /^(text\/html|application\/xhtml)/i.test(
      response.headers.get("content-type") ?? ""
    )
  ) {
    return "unknown";
  }
  // A changed If-Range validator legitimately returns the entire resource.
  if (response.status === 200) return ifRange ? "unknown" : "unsupported";
  const start = Number(range[1]);
  const end = range[2] ? Number(range[2]) : Number.MAX_SAFE_INTEGER;
  return getRangeTotal(response, start, end) !== null ? "supported" : "unknown";
}

function sleepWithSignal(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) {
    signal.throwIfAborted();
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export interface ParallelRangeDownloadOptions {
  url: string;
  headers: Record<string, string>;
  firstResponse: Response;
  filePath: string;
  startByte: number;
  total: number;
  rangeSize?: number;
  connectionCount?: number;
  maxRanges?: number;
  checkpointIntervalMs?: number;
  maxRangeRetries?: number;
  resourceId?: string;
  signal: AbortSignal;
  abort: () => void;
  beforeChunk: (length: number) => Promise<void>;
  beforeComplete?: () => Promise<void>;
  afterChunk: (length: number) => void;
  onReadPending: (offset: number, pending: boolean) => void;
  registerRangeAbort?: (offset: number, abort: (() => void) | null) => void;
  refreshUrl?: () => Promise<string>;
  onUrlRefreshed?: (url: string) => void;
  getHeaders?: () => Record<string, string>;
}

interface ByteRangeJob {
  start: number;
  end: number;
  attempts: number;
}

export async function downloadParallelRanges({
  url,
  headers,
  firstResponse,
  filePath,
  startByte,
  total,
  rangeSize,
  connectionCount = PARALLEL_RANGE_COUNT,
  maxRanges = Infinity,
  checkpointIntervalMs = RANGE_CHECKPOINT_INTERVAL_MS,
  maxRangeRetries = DEFAULT_PER_RANGE_RETRIES,
  resourceId,
  signal,
  abort,
  beforeChunk,
  beforeComplete,
  afterChunk,
  onReadPending,
  registerRangeAbort,
  refreshUrl,
  onUrlRefreshed,
  getHeaders,
}: ParallelRangeDownloadOptions): Promise<boolean> {
  const validator = getStrongRangeValidator(firstResponse);
  if (!validator) {
    await firstResponse.body?.cancel();
    throw new ParallelRangeUnsupportedError(
      "The download server did not provide a byte-range validator"
    );
  }
  const saved = readRangeState(filePath);
  if (
    saved &&
    (saved.total !== total ||
      saved.validator !== validator ||
      saved.resourceId !== rangeResourceId(resourceId))
  ) {
    await firstResponse.body?.cancel();
    throw new Error(
      "The download resource changed. Keeping the saved partial file."
    );
  }
  const remainingBytes = Math.max(1, total - startByte);
  const effectiveRangeSize =
    rangeSize ??
    getRangeSizeForRequestBudget(remainingBytes, DEFAULT_MAX_PARALLEL_RANGES);
  const effectiveCheckpointIntervalMs = Math.max(250, checkpointIntervalMs);
  if (
    !Number.isSafeInteger(effectiveRangeSize) ||
    effectiveRangeSize <= 0 ||
    !Number.isSafeInteger(connectionCount) ||
    connectionCount < 1 ||
    connectionCount > MAX_PARALLEL_CONNECTIONS ||
    !(
      maxRanges === Infinity ||
      (Number.isSafeInteger(maxRanges) && maxRanges > 0)
    )
  ) {
    await firstResponse.body?.cancel();
    throw new Error("Invalid parallel download limits");
  }

  const state: RangeDownloadState = saved ?? {
    version: 1,
    total,
    validator,
    resourceId: rangeResourceId(resourceId),
    ranges: startByte > 0 ? [[0, startByte]] : [],
  };

  const firstSpan = parseContentRangeSpan(firstResponse);
  const jobs: ByteRangeJob[] = [];
  for (const [gapStart, gapEnd] of missingRanges(state)) {
    let offset = gapStart;
    // Reuse the already-open firstResponse span as job 0 when it aligns with
    // the first missing gap, even if remaining ranges scale larger.
    if (
      jobs.length === 0 &&
      firstSpan &&
      firstSpan.total === total &&
      firstSpan.start === gapStart &&
      firstSpan.end < gapEnd
    ) {
      jobs.push({ start: gapStart, end: firstSpan.end, attempts: 0 });
      offset = firstSpan.end + 1;
    }
    while (offset < gapEnd && jobs.length < maxRanges) {
      const next = Math.min(offset + effectiveRangeSize, gapEnd);
      jobs.push({ start: offset, end: next - 1, attempts: 0 });
      offset = next;
    }
    if (jobs.length >= maxRanges) break;
  }

  const willUseFirstResponse =
    jobs.length > 0 &&
    getRangeTotal(firstResponse, jobs[0].start, jobs[0].end) === total;
  if (!willUseFirstResponse) {
    await firstResponse.body?.cancel().catch(() => undefined);
  }

  const file = await fs.promises.open(filePath, "r+");
  let lastCheckpoint = Date.now();
  let dirtySincePersist = true;
  let closed = false;
  let inFlightPersist: Promise<void> | null = null;
  let persistChain: Promise<void> = Promise.resolve();

  const runPersist = (): Promise<void> => {
    if (inFlightPersist) return inFlightPersist;
    dirtySincePersist = false;
    // Snapshot before sync so the map never claims bytes that sync did not see.
    const snapshot: RangeDownloadState = {
      ...state,
      ranges: state.ranges.map(([start, end]): [number, number] => [
        start,
        end,
      ]),
    };
    const nextPersist = persistChain.then(async () => {
      await file.sync();
      await saveRangeState(filePath, snapshot);
      lastCheckpoint = Date.now();
    });
    persistChain = nextPersist.catch(() => undefined);
    const trackedPersist = nextPersist.finally(() => {
      if (inFlightPersist === trackedPersist) {
        inFlightPersist = null;
      }
    });
    inFlightPersist = trackedPersist;
    return trackedPersist;
  };

  const maybeSchedulePersist = (): void => {
    if (
      closed ||
      !dirtySincePersist ||
      inFlightPersist !== null ||
      Date.now() - lastCheckpoint < effectiveCheckpointIntervalMs
    ) {
      return;
    }
    void runPersist().catch(() => undefined);
  };

  const checkpointTimer = setInterval(
    maybeSchedulePersist,
    Math.min(1000, effectiveCheckpointIntervalMs)
  );

  let currentUrl = url;
  let refreshPromise: Promise<string> | null = null;
  let refreshSucceeded = false;
  const refreshUrlOnce = async (): Promise<string | null> => {
    if (!refreshUrl) return null;
    if (!refreshPromise) {
      refreshPromise = refreshUrl()
        .then((nextUrl) => {
          if (nextUrl) {
            currentUrl = nextUrl;
            refreshSucceeded = true;
            onUrlRefreshed?.(nextUrl);
          }
          return nextUrl;
        })
        .finally(() => {
          refreshPromise = null;
        });
    }
    const nextUrl = await refreshPromise;
    return nextUrl || null;
  };

  let firstUsed = false;
  let inFlightJobs = 0;
  const maxConcurrency = Math.min(connectionCount, Math.max(1, jobs.length));
  let activeLimit = maxConcurrency;
  let cooldownUntil = 0;
  let cleanCompletions = 0;
  let fatalError: unknown = null;
  const waiters = new Set<() => void>();

  const wakeWaiters = () => {
    for (const notify of waiters) notify();
    waiters.clear();
  };

  const waitForChange = (timeoutMs?: number): Promise<void> =>
    new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(signal.reason);
        return;
      }
      let timer: NodeJS.Timeout | undefined;
      const done = () => {
        if (timer) clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        waiters.delete(done);
        resolve();
      };
      const onAbort = () => {
        if (timer) clearTimeout(timer);
        waiters.delete(done);
        reject(signal.reason);
      };
      waiters.add(done);
      signal.addEventListener("abort", onAbort, { once: true });
      if (timeoutMs !== undefined && timeoutMs > 0) {
        timer = setTimeout(done, timeoutMs);
      }
    });

  const runRange = async (job: ByteRangeJob): Promise<void> => {
    signal.throwIfAborted();
    const rangeController = new AbortController();
    const rangeSignal = AbortSignal.any([signal, rangeController.signal]);
    let received = 0;
    let response: Response;

    registerRangeAbort?.(job.start, () => {
      rangeController.abort(new RangeStallError());
    });

    try {
      const probeTotal = getRangeTotal(firstResponse, job.start, job.end);
      if (!firstUsed && probeTotal === total) {
        firstUsed = true;
        response = firstResponse;
      } else {
        onReadPending(job.start, true);
        try {
          const activeHeaders = getHeaders ? getHeaders() : headers;
          response = await fetch(currentUrl, {
            headers: {
              ...activeHeaders,
              Range: `bytes=${job.start}-${job.end}`,
              "If-Range": validator,
            },
            signal: rangeSignal,
          });
        } finally {
          onReadPending(job.start, false);
        }
      }

      if (
        getRangeTotal(response, job.start, job.end) !== total ||
        getStrongRangeValidator(response) !== validator
      ) {
        await response.body?.cancel().catch(() => undefined);
        if (response.status >= 400) {
          throw new ParallelRangeHttpStatusError(
            response.status,
            response.headers.get("retry-after")
          );
        }
        throw new ParallelRangeUnsupportedError(
          "The download server stopped serving matching byte ranges"
        );
      }
      if (!response.body) throw new Error("Range response body is null");

      const reader = response.body.getReader();
      const writeChunk = async (
        chunk: Uint8Array,
        written = 0
      ): Promise<void> => {
        if (written === chunk.length) return;
        const offset = job.start + received;
        const result = await file.write(
          chunk,
          written,
          chunk.length - written,
          offset
        );
        if (!result.bytesWritten) {
          throw new Error("Could not write the downloaded byte range");
        }
        markSavedRange(state, offset, offset + result.bytesWritten);
        dirtySincePersist = true;
        received += result.bytesWritten;
        afterChunk(result.bytesWritten);
        return writeChunk(chunk, written + result.bytesWritten);
      };

      try {
        const chunks: AsyncIterable<Uint8Array> = {
          [Symbol.asyncIterator]: () => ({
            next: async () => {
              onReadPending(job.start, true);
              try {
                return await reader.read();
              } finally {
                onReadPending(job.start, false);
              }
            },
          }),
        };
        for await (const chunk of chunks) {
          if (received + chunk.length > job.end - job.start + 1) {
            throw new ParallelRangeUnsupportedError(
              "The server sent more data than the requested byte range"
            );
          }
          await beforeChunk(chunk.length);
          rangeSignal.throwIfAborted();
          await writeChunk(chunk);
          maybeSchedulePersist();
          rangeSignal.throwIfAborted();
        }
      } finally {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }

      if (received !== job.end - job.start + 1) {
        const error = new Error(
          "Byte range ended before its expected size"
        ) as Error & { retryable: boolean };
        error.retryable = true;
        throw error;
      }

      cleanCompletions++;
      if (
        cleanCompletions >= CLEAN_RANGES_BEFORE_SCALE_UP &&
        activeLimit < maxConcurrency
      ) {
        cleanCompletions = 0;
        activeLimit++;
        wakeWaiters();
      }
    } catch (error) {
      if (signal.aborted) throw error;

      const nextStart = job.start + received;
      if (nextStart > job.end) return;

      const isPerRangeStall =
        rangeController.signal.aborted &&
        rangeController.signal.reason instanceof RangeStallError;
      const effectiveError = isPerRangeStall
        ? (rangeController.signal.reason as Error)
        : error;

      if (effectiveError instanceof ParallelRangeHttpStatusError) {
        if (
          [401, 403, 404].includes(effectiveError.statusCode) &&
          refreshUrl &&
          !refreshSucceeded &&
          job.attempts < maxRangeRetries
        ) {
          const refreshed = await refreshUrlOnce().catch(() => null);
          if (refreshed) {
            jobs.unshift({
              start: nextStart,
              end: job.end,
              attempts: job.attempts + 1,
            });
            wakeWaiters();
            return;
          }
        }
        if (
          isRetryableHttpStatus(effectiveError.statusCode) &&
          job.attempts < maxRangeRetries
        ) {
          cleanCompletions = 0;
          const retryAfterMs = parseRetryAfterMs(
            effectiveError.retryAfter,
            Date.now()
          );
          const delay =
            retryAfterMs === null
              ? Math.min(1000 * Math.pow(2, job.attempts), 15_000)
              : Math.min(retryAfterMs, MAX_RETRY_AFTER_MS);
          cooldownUntil = Math.max(cooldownUntil, Date.now() + delay);
          if (activeLimit > 1) {
            activeLimit = Math.max(1, Math.floor(activeLimit / 2));
          }
          jobs.unshift({
            start: nextStart,
            end: job.end,
            attempts: job.attempts + 1,
          });
          wakeWaiters();
          return;
        }
        throw effectiveError;
      }

      if (
        !(effectiveError instanceof ParallelRangeUnsupportedError) &&
        (isPerRangeStall || isRetryableDownloadError(effectiveError)) &&
        job.attempts < maxRangeRetries
      ) {
        cleanCompletions = 0;
        const jitter = Math.floor(Math.random() * 250);
        const delay =
          Math.min(500 * Math.pow(2, job.attempts), 10_000) + jitter;
        jobs.unshift({
          start: nextStart,
          end: job.end,
          attempts: job.attempts + 1,
        });
        wakeWaiters();
        await sleepWithSignal(delay, signal);
        return;
      }

      throw effectiveError;
    } finally {
      onReadPending(job.start, false);
      registerRangeAbort?.(job.start, null);
    }
  };

  const workerLoop = async (workerIndex: number): Promise<void> => {
    while (!signal.aborted && fatalError === null) {
      if (workerIndex >= activeLimit) {
        if (jobs.length === 0 && inFlightJobs === 0) return;
        await waitForChange();
        continue;
      }
      const cooldownRemaining = cooldownUntil - Date.now();
      if (cooldownRemaining > 0) {
        await sleepWithSignal(cooldownRemaining, signal);
        continue;
      }
      const job = jobs.shift();
      if (!job) {
        if (inFlightJobs === 0) {
          wakeWaiters();
          return;
        }
        await waitForChange();
        continue;
      }
      inFlightJobs++;
      try {
        await runRange(job);
      } catch (error) {
        if (fatalError === null) {
          fatalError = error;
        }
        abort();
        wakeWaiters();
        throw error;
      } finally {
        inFlightJobs--;
        wakeWaiters();
      }
    }
  };

  let workers: Promise<void>[] = [];
  try {
    await runPersist();
    workers = Array.from({ length: maxConcurrency }, (_, index) =>
      workerLoop(index)
    );
    try {
      await Promise.all(workers);
    } catch (error) {
      abort();
      wakeWaiters();
      await Promise.allSettled(workers);
      throw fatalError ?? error;
    }
    if (fatalError !== null) throw fatalError;
    return missingRanges(state).length === 0;
  } finally {
    closed = true;
    clearInterval(checkpointTimer);
    wakeWaiters();
    try {
      await persistChain;
      await runPersist();
    } finally {
      await file.close();
      if (!firstUsed) await firstResponse.body?.cancel().catch(() => undefined);
    }
    if (missingRanges(state).length === 0) {
      await beforeComplete?.();
      removeRangeState(filePath);
    }
  }
}
