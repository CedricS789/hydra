import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

/** The launcher queue serializes commands; this lock covers other processes. */
export async function acquireSaveBackupLock(destination: string) {
  await fs.mkdir(destination, { recursive: true });
  const file = path.join(destination, ".hydra-ludusavi.lock");
  const open = () => fs.open(file, "wx");
  const handle = await open().catch(async (error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") throw error;
    const owner = JSON.parse(await fs.readFile(file, "utf8"));
    if (owner.host !== os.hostname() || !Number.isInteger(owner.pid))
      throw new Error("The backup destination is locked by another process.");
    const alive = [owner.pid, owner.childPid].some((pid: unknown) => {
      if (!Number.isInteger(pid) || (pid as number) < 1) return false;
      try {
        process.kill(pid as number, 0);
        return true;
      } catch (e) {
        return (e as NodeJS.ErrnoException).code !== "ESRCH";
      }
    });
    if (alive) throw new Error("A backup operation is already running.");
    await fs.unlink(file);
    return open();
  });
  const child = async (childPid?: number) => {
    const content = JSON.stringify({
      host: os.hostname(),
      pid: process.pid,
      childPid,
    });
    await handle.write(content, 0, "utf8");
    await handle.truncate(Buffer.byteLength(content));
  };
  try {
    await child();
  } catch (error) {
    await handle.close();
    await fs.unlink(file).catch(() => undefined);
    throw error;
  }
  return {
    child,
    release: async () => {
      await handle.close();
      await fs.unlink(file).catch(() => undefined);
    },
  };
}
