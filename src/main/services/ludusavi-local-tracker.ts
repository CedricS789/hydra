import path from "node:path";

export interface LocalProcess {
  pid: number;
  parentPid?: number | null;
  exe: string | null;
  startTime?: string | null;
  inspectionComplete?: boolean;
}

export interface TrackedLocalGame {
  key: string;
  paths: string[];
}

interface ProcessIdentity {
  started: string | null;
  exe: string | null;
}

interface Session {
  processes: Map<number, ProcessIdentity>;
  closedAt: number | null;
}

const normalize = (value: string) => path.win32.normalize(value).toLowerCase();

const identityOf = (p: LocalProcess): ProcessIdentity => ({
  started: p.startTime ?? null,
  exe: p.exe,
});
const sameProcess = (saved: ProcessIdentity, p: LocalProcess) => {
  if (!p.exe && p.inspectionComplete === false) return true;
  if (saved.started && p.startTime && saved.started !== p.startTime)
    return false;
  return !!saved.exe && !!p.exe && normalize(saved.exe) === normalize(p.exe);
};

export const matchesLocalGame = (game: TrackedLocalGame, node: LocalProcess) =>
  !!node.exe && game.paths.some((p) => normalize(p) === normalize(node.exe!));

/** A failed scan is never evidence that a game exited. */
export class LudusaviExitTracker {
  private sessions = new Map<string, Session>();

  reset() {
    this.sessions.clear();
  }

  observe(
    games: TrackedLocalGame[],
    processes: LocalProcess[] | null,
    now: number,
    delayMs: number
  ): string[] {
    if (!processes?.length) return [];
    const ready: string[] = [];
    const live = new Map(processes.map((p) => [p.pid, p]));
    const configured = new Set(games.map((g) => g.key));
    for (const key of this.sessions.keys()) {
      if (!configured.has(key)) this.sessions.delete(key);
    }

    for (const game of games) {
      let session = this.sessions.get(game.key);
      const seeds = processes.filter((p) => matchesLocalGame(game, p));
      if (seeds.length && !session) {
        session = { processes: new Map(), closedAt: null };
        this.sessions.set(game.key, session);
      }
      if (!session) continue;
      for (const p of seeds) session.processes.set(p.pid, identityOf(p));

      // Retain captured descendants when a bootstrap executable terminates.
      // Only game-directory descendants count; store clients/overlays do not.
      let changed = true;
      while (changed) {
        changed = false;
        for (const p of processes) {
          if (!p.exe || !p.parentPid || session.processes.has(p.pid)) continue;
          const parent = live.get(p.parentPid);
          if (!parent || !session.processes.has(parent.pid)) continue;
          if (!sameProcess(session.processes.get(parent.pid)!, parent))
            continue;
          const withinGame = game.paths.some((exe) => {
            const relative = path.win32.relative(
              path.win32.dirname(normalize(exe)),
              normalize(p.exe!)
            );
            return (
              relative !== ".." &&
              !relative.startsWith("..\\") &&
              !path.win32.isAbsolute(relative)
            );
          });
          if (withinGame) {
            session.processes.set(p.pid, identityOf(p));
            changed = true;
          }
        }
      }

      const alive = [...session.processes].some(([pid, saved]) => {
        const p = live.get(pid);
        return !!p && sameProcess(saved, p);
      });
      if (alive) {
        session.closedAt = null;
      } else if (session.closedAt === null) {
        session.closedAt = now;
      } else if (now - session.closedAt >= delayMs) {
        ready.push(game.key);
        this.sessions.delete(game.key);
      }
    }
    return ready;
  }
}
