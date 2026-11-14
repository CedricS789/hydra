import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";

interface MappingBackup {
  name: string;
  files: Record<string, { hash?: string; size?: number } | null>;
  registry?: { hash?: string | null };
  children?: MappingBackup[];
}

export async function confinedSavePath(root: string, candidate: string) {
  const actualRoot = await fs.realpath(root);
  const actual = await fs.realpath(candidate);
  const relative = path.relative(actualRoot, actual);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  )
    throw new Error(
      "Backup metadata refers to a path outside the backup destination."
    );
  return actual;
}

/** Check declared entries plus ZIP integrity, without extracting to live saves. */
export async function validateSaveVersion(
  destination: string,
  directory: string,
  version: string,
  archive: (file: string) => Promise<Set<string>>
) {
  const gameFolder = await confinedSavePath(destination, directory);
  const mappingFile = await confinedSavePath(
    gameFolder,
    path.join(gameFolder, "mapping.yaml")
  );
  const mapping = YAML.parse(await fs.readFile(mappingFile, "utf8"), {
    maxAliasCount: 50,
  }) as {
    drives: Record<string, string>;
    backups: MappingBackup[];
  };
  if (
    !mapping ||
    !Array.isArray(mapping.backups) ||
    !mapping.drives ||
    typeof mapping.drives !== "object"
  )
    throw new Error("The backup mapping is malformed.");
  const full = mapping.backups.find(
    (item) =>
      item.name === version ||
      item.children?.some((child) => child.name === version)
  );
  if (!full)
    throw new Error("The selected backup version is no longer available.");
  const differential =
    full.name === version
      ? undefined
      : full.children?.find((child) => child.name === version);
  for (const item of [full, ...(differential ? [differential] : [])])
    if (
      !item.files ||
      typeof item.files !== "object" ||
      Array.isArray(item.files)
    )
      throw new Error("The backup file mapping is malformed.");
  const effective = { ...full.files, ...differential?.files };
  const entries = new Map<string, Set<string>>();
  for (const item of [full, ...(differential ? [differential] : [])]) {
    if (
      item.name !== "." &&
      (path.basename(item.name) !== item.name || item.name === "..")
    )
      throw new Error("Invalid backup version path.");
    const file = await confinedSavePath(
      gameFolder,
      path.join(gameFolder, item.name)
    );
    if (item.name.endsWith(".zip")) entries.set(item.name, await archive(file));
  }
  let files = 0;
  for (const [source, info] of Object.entries(effective)) {
    if (!info) continue;
    const owner =
      differential?.files && source in differential.files ? differential : full;
    const drive = Object.entries(mapping.drives).find(([, prefix]) =>
      source
        .replaceAll("\\", "/")
        .startsWith(`${prefix.replaceAll("\\", "/")}/`)
    );
    if (!drive)
      throw new Error(`No backup drive mapping exists for ${source}.`);
    const member = `${drive[0]}/${source.replaceAll("\\", "/").slice(drive[1].length + 1)}`;
    if (member.split("/").some((part) => part === ".."))
      throw new Error("Invalid archived file path.");
    if (owner.name.endsWith(".zip")) {
      if (!entries.get(owner.name)?.has(member))
        throw new Error(
          `A declared save is missing from the archive: ${source}`
        );
    } else {
      const file = await confinedSavePath(
        gameFolder,
        path.join(gameFolder, owner.name, member)
      );
      if (!(await fs.stat(file)).isFile())
        throw new Error(`A declared save is missing: ${source}`);
      if (info.size !== undefined && (await fs.stat(file)).size !== info.size)
        throw new Error(`A saved file has an unexpected size: ${source}`);
    }
    files++;
  }
  const registryOwner = differential?.registry?.hash ? differential : full;
  if (registryOwner.registry?.hash) {
    if (registryOwner.name.endsWith(".zip")) {
      if (!entries.get(registryOwner.name)?.has("registry.yaml"))
        throw new Error("The saved registry data is missing.");
    } else
      await confinedSavePath(
        gameFolder,
        path.join(gameFolder, registryOwner.name, "registry.yaml")
      );
  }
  return { files, archives: entries.size };
}
