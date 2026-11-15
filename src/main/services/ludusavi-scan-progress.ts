import fs from "node:fs/promises";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import type { SaveDiscoveryProgress } from "../../types/local-edition.types";

/** Parse the pinned CLI's trace records; parallel step IDs are not percentages. */
export class SaveScanProgress {
  private active = new Map<number, string>();
  private finished = new Set<number>();
  private total: number | undefined;
  line(value: string): SaveDiscoveryProgress | undefined {
    if (!value.includes("[ludusavi::cli]")) return;
    const start = /step (\d+) \/ (\d+): (.+)$/.exec(value);
    const end = /step (\d+) completed/.exec(value);
    const excluded =
      /\[ludusavi::cli\] \[(.+)\] excluded by backup filter$/.exec(value);
    if (start) {
      this.total = Number(start[2]);
      this.active.set(Number(start[1]), start[3]);
    } else if (end) {
      this.finished.add(Number(end[1]));
      this.active.delete(Number(end[1]));
    } else if (excluded) {
      for (const [id, title] of this.active)
        if (title === excluded[1]) {
          this.finished.add(id);
          this.active.delete(id);
        }
    } else return;
    return {
      phase: "scanning",
      completed: this.finished.size,
      total: this.total,
      currentTitles: [...this.active.values()].slice(-5),
    };
  }
}

/** Read only new native CLI log bytes; discard new scan logs when finished. */
export async function monitorSaveScan(
  directory: string,
  report: (progress: SaveDiscoveryProgress) => void
) {
  const logNames = async () =>
    (await fs.readdir(directory)).filter((name) =>
      /^ludusavi.*\.log$/.test(name)
    );
  const initial = new Set(await logNames());
  const files = new Map<
    string,
    { offset: number; decoder: StringDecoder; pending: string }
  >();
  for (const name of initial)
    files.set(name, {
      offset: (await fs.stat(path.join(directory, name))).size,
      decoder: new StringDecoder("utf8"),
      pending: "",
    });
  const parser = new SaveScanProgress();
  let pending = Promise.resolve();
  const poll = async () => {
    for (const name of await logNames()) {
      const state = files.get(name) ?? {
        offset: 0,
        decoder: new StringDecoder("utf8"),
        pending: "",
      };
      files.set(name, state);
      const handle = await fs.open(path.join(directory, name), "r");
      try {
        let remaining = (await handle.stat()).size - state.offset;
        while (remaining > 0) {
          const bytes = Buffer.alloc(Math.min(remaining, 64 * 1024));
          const { bytesRead } = await handle.read(
            bytes,
            0,
            bytes.length,
            state.offset
          );
          if (!bytesRead) break;
          state.offset += bytesRead;
          remaining -= bytesRead;
          const lines = (
            state.pending + state.decoder.write(bytes.subarray(0, bytesRead))
          ).split(/\r?\n/);
          state.pending = lines.pop()?.slice(-4096) ?? "";
          for (const line of lines) {
            const value = parser.line(line);
            if (value) report(value);
          }
        }
      } finally {
        await handle.close();
      }
    }
  };
  const enqueue = () => (pending = pending.then(poll).catch(() => {}));
  const timer = setInterval(() => void enqueue(), 300);
  return async () => {
    clearInterval(timer);
    await enqueue();
    for (const name of files.keys())
      if (!initial.has(name))
        await fs
          .rm(path.join(directory, name), { force: true })
          .catch(() => {});
  };
}
