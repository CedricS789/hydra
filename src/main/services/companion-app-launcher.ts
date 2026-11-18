import path from "node:path";
import type { CompanionApp } from "../../types/companion-app.types";
import {
  companionAppArguments,
  validateCompanionApps,
} from "../../shared/companion-apps.js";

type ProcessInfo = { pid: number; exe: string | null };
type Preferences = {
  companionAppsEnabled?: boolean;
  companionApps?: CompanionApp[];
} | null;
export type CompanionAppWarning =
  | "failed"
  | "inspection"
  | "timeout"
  | "invalid";
export interface CompanionAppDependencies {
  platform: string;
  getPreferences: () => Promise<Preferences>;
  listProcesses: () => Promise<ProcessInfo[]>;
  readArguments: (
    process: ProcessInfo,
    signal: AbortSignal
  ) => Promise<string[] | null>;
  launch: (
    app: CompanionApp,
    args: string[],
    signal: AbortSignal,
    requestInteractiveTimeout?: () => void
  ) => Promise<void>;
  warn: (names: string[], reason: CompanionAppWarning) => void;
}

type InFlightLaunch = {
  promise: Promise<void>;
  interactive: boolean;
  onInteractive: Set<() => void>;
};

/** Independent of game tracking: these processes never become game executables. */
export class CompanionAppLauncher {
  private readonly inFlight = new Map<string, InFlightLaunch>();
  constructor(
    private readonly deps: CompanionAppDependencies,
    private readonly timeoutMs = 5_000,
    private readonly elevatedTimeoutMs = 30_000
  ) {}

  private normalizePath(value: string) {
    const normalized = (
      this.deps.platform === "win32" ? path.win32 : path.posix
    ).normalize(value);
    return this.deps.platform === "win32"
      ? normalized.toLowerCase()
      : normalized;
  }

  private warn(names: string[], reason: CompanionAppWarning) {
    try {
      this.deps.warn(names, reason);
    } catch {
      /* Warnings cannot block play. */
    }
  }

  async startBeforeGame(): Promise<void> {
    if (this.deps.platform !== "win32" && this.deps.platform !== "linux")
      return;
    const controller = new AbortController();
    const failures: string[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    let resolveTimeout!: () => void;
    let interactiveRequested = false;
    const timeout = new Promise<void>((resolve) => {
      resolveTimeout = resolve;
    });
    const armTimer = (delayMs: number) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        controller.abort();
        this.warn([], "timeout");
        resolveTimeout();
      }, delayMs);
    };
    const requestInteractiveTimeout = () => {
      if (interactiveRequested || controller.signal.aborted) return;
      interactiveRequested = true;
      if (this.elevatedTimeoutMs > this.timeoutMs) {
        armTimer(this.elevatedTimeoutMs);
      }
    };
    armTimer(this.timeoutMs);
    const work = async () => {
      const preferences = await this.deps.getPreferences();
      if (
        controller.signal.aborted ||
        preferences?.companionAppsEnabled !== true
      )
        return;
      const apps = validateCompanionApps(preferences.companionApps ?? []);
      const visited = new Set<string>();
      for (const app of apps) {
        if (controller.signal.aborted) break;
        if (!app.enabled) continue;
        const args = companionAppArguments(app);
        const key = JSON.stringify([
          this.normalizePath(app.executablePath),
          args,
        ]);
        if (visited.has(key)) continue;
        visited.add(key);
        let entry = this.inFlight.get(key);
        if (!entry) {
          const onInteractive = new Set<() => void>();
          const current: InFlightLaunch = {
            promise: Promise.resolve(),
            interactive: false,
            onInteractive,
          };
          const notifyInteractive = () => {
            if (current.interactive) return;
            current.interactive = true;
            for (const listener of current.onInteractive) listener();
          };
          current.promise = this.ensureStarted(
            app,
            args,
            controller.signal,
            notifyInteractive
          ).finally(() => {
            if (this.inFlight.get(key) === current) this.inFlight.delete(key);
          });
          void current.promise.catch(() => {});
          this.inFlight.set(key, current);
          entry = current;
        }
        entry.onInteractive.add(requestInteractiveTimeout);
        if (entry.interactive) requestInteractiveTimeout();
        try {
          await entry.promise;
        } catch {
          if (!controller.signal.aborted) failures.push(app.name);
        } finally {
          entry.onInteractive.delete(requestInteractiveTimeout);
        }
      }
      if (failures.length && !controller.signal.aborted)
        this.warn(failures, "failed");
    };
    try {
      await Promise.race([
        work().catch(() => {
          if (!controller.signal.aborted) this.warn([], "invalid");
        }),
        timeout,
      ]);
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }

  private async ensureStarted(
    app: CompanionApp,
    args: string[],
    signal: AbortSignal,
    requestInteractiveTimeout: () => void
  ) {
    const processes = await this.deps.listProcesses();
    if (signal.aborted) return;
    const matches = processes.filter(
      (proc) =>
        proc.exe &&
        this.normalizePath(proc.exe) === this.normalizePath(app.executablePath)
    );
    for (const proc of matches) {
      if (!args.length) return;
      const existingArgs = await this.deps.readArguments(proc, signal);
      if (signal.aborted) return;
      if (existingArgs === null) {
        this.warn([app.name], "inspection");
        return; // Do not create a duplicate when an existing command cannot be inspected.
      }
      if (JSON.stringify(existingArgs) === JSON.stringify(args)) return;
    }
    if (!signal.aborted)
      await this.deps.launch(app, args, signal, requestInteractiveTimeout);
  }
}
