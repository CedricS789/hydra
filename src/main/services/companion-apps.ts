import { execFile, spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { Notification } from "electron";
import { t } from "i18next";
import type { UserPreferences } from "@types";
import { db, levelKeys } from "@main/level";
import { NativeAddon } from "./native-addon";
import { logger } from "./logger";
import { WindowManager } from "./window-manager";
import {
  CompanionAppLauncher,
  type CompanionAppWarning,
} from "./companion-app-launcher";
import {
  parseWindowsCommandLine,
  quoteWindowsArguments,
  validateCompanionApps,
} from "../../shared/companion-apps";

const canonicalPath = (value: string) => realpath(value).catch(() => value);
const ELEVATION_ERROR_CODES = new Set(["EACCES", "UNKNOWN"]);
const windowsPowerShellPath = () =>
  path.join(
    process.env.SystemRoot ?? "C:\\Windows",
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe"
  );

const ELEVATED_COMPANION_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "try {",
  "  $info = New-Object System.Diagnostics.ProcessStartInfo",
  "  $info.FileName = $env:HYDRA_COMPANION_PATH",
  "  if ($env:HYDRA_COMPANION_ARGS) { $info.Arguments = $env:HYDRA_COMPANION_ARGS }",
  "  $info.WorkingDirectory = $env:HYDRA_COMPANION_CWD",
  "  $info.Verb = 'runas'",
  "  $info.UseShellExecute = $true",
  "  $info.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Normal",
  "  [void][System.Diagnostics.Process]::Start($info)",
  "} catch {",
  "  exit 1",
  "}",
].join("; ");

const spawnDirect = (executablePath: string, args: string[], cwd: string) =>
  new Promise<void>((resolve, reject) => {
    const child = spawn(executablePath, args, {
      cwd,
      detached: true,
      stdio: "ignore",
      shell: false,
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });

const launchElevatedWindowsApp = async (
  executablePath: string,
  args: string[],
  cwd: string,
  signal: AbortSignal,
  requestInteractiveTimeout?: () => void
) => {
  if (signal.aborted) return;
  requestInteractiveTimeout?.();
  await new Promise<void>((resolve, reject) => {
    execFile(
      windowsPowerShellPath(),
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        Buffer.from(ELEVATED_COMPANION_SCRIPT, "utf16le").toString("base64"),
      ],
      {
        windowsHide: true,
        signal,
        env: {
          ...process.env,
          HYDRA_COMPANION_PATH: executablePath,
          HYDRA_COMPANION_ARGS: quoteWindowsArguments(args),
          HYDRA_COMPANION_CWD: cwd,
        },
      },
      (error) =>
        error ? reject(new Error("companion_app_spawn_failed")) : resolve()
    );
  });
};

const launcher = new CompanionAppLauncher({
  platform: process.platform,
  getPreferences: async () => {
    const preferences = await db.get<string, UserPreferences | null>(
      levelKeys.userPreferences,
      { valueEncoding: "json" }
    );
    if (preferences?.companionAppsEnabled !== true) return null;
    return {
      companionAppsEnabled: true,
      companionApps: await Promise.all(
        validateCompanionApps(preferences.companionApps ?? []).map(
          async (app) => ({
            ...app,
            executablePath: await canonicalPath(app.executablePath),
          })
        )
      ),
    };
  },
  listProcesses: async () => {
    const processes = await NativeAddon.listProcesses();
    if (!processes.length) throw new Error("process_inspection_unavailable");
    return Promise.all(
      processes.flatMap((proc) => {
        // AppImages run from a temporary mount; APPIMAGE keeps the original path.
        const paths = [
          proc.exe,
          process.platform === "linux" ? proc.environ?.APPIMAGE : null,
        ].filter((value): value is string => Boolean(value));
        return paths.map(async (executable) => ({
          pid: proc.pid,
          exe: await canonicalPath(executable),
        }));
      })
    );
  },
  readArguments: async (proc, signal) => {
    try {
      if (process.platform === "linux") {
        const command = await readFile(`/proc/${proc.pid}/cmdline`, { signal });
        const args = command.toString().split("\0");
        if (args.at(-1) === "") args.pop();
        return args.slice(1);
      }
      // Only a numeric PID enters this script; user arguments are never evaluated.
      if (!Number.isSafeInteger(proc.pid) || proc.pid <= 0) return null;
      const script = `$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new(); Get-CimInstance Win32_Process -Filter 'ProcessId = ${proc.pid}' | Select-Object -ExpandProperty CommandLine | ConvertTo-Json -Compress`;
      const commandLine = await new Promise<string>((resolve, reject) => {
        execFile(
          windowsPowerShellPath(),
          [
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-EncodedCommand",
            Buffer.from(script, "utf16le").toString("base64"),
          ],
          {
            windowsHide: true,
            signal,
            encoding: "utf8",
            maxBuffer: 1024 * 1024,
          },
          (error, stdout) =>
            error
              ? reject(new Error("process_inspection_failed"))
              : resolve(stdout)
        );
      });
      const decoded: unknown = JSON.parse(commandLine.replace(/^\uFEFF/, ""));
      return typeof decoded === "string" && decoded.length
        ? parseWindowsCommandLine(decoded).slice(1)
        : null;
    } catch {
      return null;
    }
  },
  launch: async (app, args, signal, requestInteractiveTimeout) => {
    if (signal.aborted) return;
    if (
      !path.isAbsolute(app.executablePath) ||
      (process.platform === "win32" &&
        !/\.(exe|com)$/i.test(app.executablePath))
    )
      throw new Error("companion_app_not_native");
    if (!(await stat(app.executablePath)).isFile())
      throw new Error("companion_app_not_file");
    if (process.platform === "linux")
      await access(app.executablePath, constants.X_OK);
    const cwd = app.workingDirectory || path.dirname(app.executablePath);
    if (!(await stat(cwd)).isDirectory())
      throw new Error("companion_app_invalid_directory");
    if (signal.aborted) return;
    if (process.platform === "win32" && app.runAsAdmin === true) {
      await launchElevatedWindowsApp(
        app.executablePath,
        args,
        cwd,
        signal,
        requestInteractiveTimeout
      );
      return;
    }
    try {
      await spawnDirect(app.executablePath, args, cwd);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | null)?.code;
      if (
        process.platform === "win32" &&
        code &&
        ELEVATION_ERROR_CODES.has(code)
      ) {
        await launchElevatedWindowsApp(
          app.executablePath,
          args,
          cwd,
          signal,
          requestInteractiveTimeout
        );
        return;
      }
      throw new Error("companion_app_spawn_failed");
    }
  },
  warn: (names, reason: CompanionAppWarning) => {
    // Spawn errors can contain private arguments. Log neither commands nor errors.
    logger.warn("[Companion apps] Preparation warning", {
      reason,
      count: names.length,
    });
    const title = t("settings:companion_apps_warning_title");
    const message = t(`settings:companion_apps_warning_${reason}`, {
      names: names.join(", "),
    });
    WindowManager.sendToAppWindows("on-show-toast", {
      title,
      message,
      type: "warning",
      duration: 8_000,
    });
    const visible = [
      WindowManager.mainWindow,
      WindowManager.bigPictureWindow,
    ].some(
      (window) =>
        window &&
        !window.isDestroyed() &&
        window.isVisible() &&
        !window.isMinimized()
    );
    if (!visible && Notification.isSupported())
      new Notification({ title, body: message, silent: true }).show();
  },
});

/** Optional utility setup must never fail the game launch. */
export const startCompanionAppsBeforeGame = () =>
  launcher.startBeforeGame().catch(() => {
    logger.warn("[Companion apps] Preparation unavailable");
  });
