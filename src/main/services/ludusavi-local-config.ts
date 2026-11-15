import YAML from "yaml";
import type { LudusaviLocalSettings } from "../../types/local-edition.types";

export interface SaveEngineConfig {
  [key: string]: unknown;
  manifest?: Record<string, unknown>;
  roots?: { path: string; store: string; [key: string]: unknown }[];
  customGames?: {
    name: string;
    files?: string[];
    registry?: string[];
    integration?: string;
    [key: string]: unknown;
  }[];
  backup?: Record<string, unknown>;
  restore?: Record<string, unknown>;
  cloud?: Record<string, unknown>;
}

export function parseSaveEngineConfig(text: string): SaveEngineConfig {
  if (Buffer.byteLength(text, "utf8") > 1024 * 1024)
    throw new Error("Advanced configuration must be smaller than 1 MiB.");
  const value = YAML.parse(text, { maxAliasCount: 50 }) ?? {};
  if (typeof value !== "object" || Array.isArray(value))
    throw new Error("Advanced configuration must be a YAML mapping.");
  return value;
}

/** Keep provider/rules configuration, but never permit implicit cloud sync. */
export function managedSaveConfig(
  base: SaveEngineConfig,
  settings: LudusaviLocalSettings
): SaveEngineConfig {
  const config = structuredClone(base);
  // Bundled binaries are updated through Hydra releases, not the native GUI.
  config.release = { ...(config.release as object), check: false };
  config.manifest = config.manifest ?? { enable: true };
  config.backup = {
    ...config.backup,
    path: settings.destination,
    retention: {
      full: settings.fullRetention,
      differential: settings.differentialRetention ?? 0,
    },
    format: {
      ...(config.backup?.format as object),
      chosen: settings.format ?? "zip",
      zip: { compression: settings.compression ?? "deflate" },
    },
  };
  config.restore = { ...config.restore, path: settings.destination };
  config.cloud = { ...config.cloud, synchronize: false };
  return config;
}
