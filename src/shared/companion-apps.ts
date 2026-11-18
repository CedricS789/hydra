import type { CompanionApp } from "../types/companion-app.types";
import stringArgv from "string-argv";

const absolutePath = /^(?:[A-Za-z]:[\\/]|\\\\|\/)/;
const validString = (value: unknown): value is string =>
  typeof value === "string" && !value.includes("\0");

export function validateCompanionApps(value: unknown): CompanionApp[] {
  if (!Array.isArray(value)) throw new Error("companion_apps_invalid");
  const ids = new Set<string>();
  return value.map((entry: unknown) => {
    if (!entry || typeof entry !== "object")
      throw new Error("companion_apps_invalid");
    const app = entry as Record<string, unknown>;
    if (
      !validString(app.id) ||
      !app.id ||
      ids.has(app.id) ||
      !validString(app.name) ||
      !app.name.trim() ||
      !validString(app.executablePath) ||
      !absolutePath.test(app.executablePath) ||
      !validString(app.arguments) ||
      !validString(app.workingDirectory) ||
      (app.workingDirectory !== "" &&
        !absolutePath.test(app.workingDirectory)) ||
      typeof app.enabled !== "boolean" ||
      (app.runAsAdmin !== undefined && typeof app.runAsAdmin !== "boolean")
    )
      throw new Error("companion_apps_invalid");
    ids.add(app.id);
    return {
      id: app.id,
      name: app.name.trim(),
      executablePath: app.executablePath,
      arguments: app.arguments,
      workingDirectory: app.workingDirectory,
      enabled: app.enabled,
      ...(app.runAsAdmin ? { runAsAdmin: true } : {}),
    };
  });
}

export const companionAppArguments = (app: CompanionApp) =>
  stringArgv(app.arguments);

/** Quotes arguments per Windows CommandLineToArgvW / CRT parsing rules. */
export function quoteWindowsArguments(args: string[]): string {
  return args
    .map((arg) => {
      if (arg.length > 0 && !/[\s"]/.test(arg)) return arg;
      let quoted = '"';
      let index = 0;
      while (index < arg.length) {
        let slashes = 0;
        while (arg[index] === "\\") {
          slashes++;
          index++;
        }
        if (index === arg.length) {
          quoted += "\\".repeat(slashes * 2);
        } else if (arg[index] === '"') {
          quoted += "\\".repeat(slashes * 2 + 1) + '"';
          index++;
        } else {
          quoted += "\\".repeat(slashes) + arg[index++];
        }
      }
      return `${quoted}"`;
    })
    .join(" ");
}

/** Windows uses its own quoting rules; backslashes are literal except before quotes. */
export function parseWindowsCommandLine(commandLine: string): string[] {
  const args: string[] = [];
  let index = 0;
  while (index < commandLine.length) {
    while (/\s/.test(commandLine[index] ?? "") && index < commandLine.length)
      index++;
    if (index === commandLine.length) break;
    let value = "";
    let quoted = false;
    while (index < commandLine.length) {
      if (!quoted && /\s/.test(commandLine[index])) break;
      let slashes = 0;
      while (commandLine[index] === "\\") {
        slashes++;
        index++;
      }
      if (commandLine[index] === '"') {
        value += "\\".repeat(Math.floor(slashes / 2));
        if (slashes % 2) value += '"';
        else if (quoted && commandLine[index + 1] === '"') {
          value += '"';
          index++;
        } else quoted = !quoted;
        index++;
      } else {
        value += "\\".repeat(slashes);
        if (
          index < commandLine.length &&
          (quoted || !/\s/.test(commandLine[index]))
        )
          value += commandLine[index++];
      }
    }
    args.push(value);
  }
  return args;
}
