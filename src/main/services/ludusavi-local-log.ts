import fs from "node:fs/promises";
import path from "node:path";

export const LUDUSAVI_LOG_MAX_BYTES = 2 * 1024 * 1024;

const logFiles = (directory: string) => [
  path.join(directory, "backup.log"),
  path.join(directory, "backup.log.old"),
];

const fileSize = (file: string) =>
  fs.stat(file).then(
    (stat) => stat.size,
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return 0;
      throw error;
    }
  );

/** Call through the backup queue so clearing and appending cannot overlap. */
export const clearLudusaviBackupLogs = async (directory: string) => {
  for (const file of logFiles(directory)) await fs.rm(file, { force: true });
};

/** Keep only the current and previous log, each at most 2 MiB. */
export const appendLudusaviBackupLog = async (
  directory: string,
  entry: unknown
) => {
  await fs.mkdir(directory, { recursive: true });
  const [current, previous] = logFiles(directory);
  const serialized = JSON.stringify(entry) ?? "null";
  let line = `${serialized}\n`;
  if (Buffer.byteLength(line, "utf8") > LUDUSAVI_LOG_MAX_BYTES) {
    line = `${JSON.stringify({
      truncated: true,
      message:
        "Oversized log entry truncated. Check recent backup results for details.",
      preview: serialized.slice(0, 16 * 1024),
    })}\n`;
  }
  // Older builds could leave oversized logs; apply the same cap on upgrade.
  if ((await fileSize(previous)) > LUDUSAVI_LOG_MAX_BYTES)
    await fs.rm(previous, { force: true });
  let size = await fileSize(current);
  if (size > LUDUSAVI_LOG_MAX_BYTES) {
    await fs.rm(current, { force: true });
    size = 0;
  }
  if (size + Buffer.byteLength(line, "utf8") > LUDUSAVI_LOG_MAX_BYTES) {
    await fs.rm(previous, { force: true });
    await fs.rename(current, previous);
  }
  await fs.appendFile(current, line);
};
