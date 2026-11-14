import type { ReleaseSourceFile } from "@types";

export interface ReleaseTreeEntry {
  path: string;
  type: string;
  sha: string;
}

/** Compare complete snapshots, rather than a merge-base commit diff. */
export const compareReleaseTrees = (
  official: ReleaseTreeEntry[],
  custom: ReleaseTreeEntry[]
): ReleaseSourceFile[] => {
  const left = new Map(
    official.filter((f) => f.type === "blob").map((f) => [f.path, f.sha])
  );
  const right = new Map(
    custom.filter((f) => f.type === "blob").map((f) => [f.path, f.sha])
  );
  return [...new Set([...left.keys(), ...right.keys()])]
    .sort()
    .flatMap((file): ReleaseSourceFile[] => {
      const originalSha = left.get(file) ?? null;
      const modifiedSha = right.get(file) ?? null;
      return originalSha === modifiedSha
        ? []
        : [
            {
              path: file,
              originalSha,
              modifiedSha,
              status: !originalSha
                ? "added"
                : !modifiedSha
                  ? "removed"
                  : "modified",
            },
          ];
    });
};
