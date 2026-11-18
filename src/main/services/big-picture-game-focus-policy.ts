import path from "node:path";
import type { EpicProcessNode } from "./epic/managed-process-tracker";
import type { NativeWindowCandidate } from "./native-addon";

export const normalizeFocusExecutablePath = (
  filePath: string,
  platform: NodeJS.Platform = process.platform
): string => {
  const trimmed = filePath.trim();
  if (!trimmed) return "";

  if (platform === "win32") {
    return path.win32.normalize(trimmed.replaceAll("/", "\\")).toLowerCase();
  }

  return path.posix.normalize(trimmed);
};

export const resolveGameCandidatePids = ({
  rootPids,
  executablePaths,
  processTree,
  platform = process.platform,
}: {
  rootPids: Iterable<number>;
  executablePaths: Iterable<string>;
  processTree?: EpicProcessNode[];
  platform?: NodeJS.Platform;
}): number[] => {
  const normalizedTargets = new Set(
    Array.from(executablePaths, (entry) =>
      normalizeFocusExecutablePath(entry, platform)
    ).filter(Boolean)
  );

  const visited = new Set<number>();
  const queue: number[] = [];

  for (const pid of rootPids) {
    if (Number.isInteger(pid) && pid > 0 && !visited.has(pid)) {
      visited.add(pid);
      queue.push(pid);
    }
  }

  if (!processTree?.length) {
    return queue;
  }

  const childrenByParent = new Map<number, number[]>();
  for (const node of processTree) {
    if (node.parentPid && node.parentPid > 0) {
      const list = childrenByParent.get(node.parentPid);
      if (list) {
        list.push(node.pid);
      } else {
        childrenByParent.set(node.parentPid, [node.pid]);
      }
    }

    if (normalizedTargets.size > 0 && node.exe) {
      const normalizedExe = normalizeFocusExecutablePath(node.exe, platform);
      if (normalizedTargets.has(normalizedExe) && !visited.has(node.pid)) {
        visited.add(node.pid);
        queue.push(node.pid);
      }
    }
  }

  for (let index = 0; index < queue.length; index++) {
    const pid = queue[index];
    const children = childrenByParent.get(pid);
    if (!children) continue;

    for (const childPid of children) {
      if (childPid > 0 && !visited.has(childPid)) {
        visited.add(childPid);
        queue.push(childPid);
      }
    }
  }

  return queue;
};

export const selectPreferredGameWindow = (
  candidates: NativeWindowCandidate[],
  alreadyFocusedHandles: ReadonlySet<string>
): NativeWindowCandidate | null => {
  const unseen = candidates.filter(
    (candidate) => !alreadyFocusedHandles.has(candidate.windowHandle)
  );
  if (unseen.length === 0) return null;

  unseen.sort((left, right) => {
    if (left.isMinimized !== right.isMinimized) {
      return left.isMinimized ? 1 : -1;
    }
    if (left.isToolWindow !== right.isToolWindow) {
      return left.isToolWindow ? 1 : -1;
    }
    return right.area - left.area;
  });

  return unseen[0];
};

export const shouldAttemptWindowFocus = ({
  target,
  hasFocusedAnyWindow,
  foregroundHandle,
  bigPictureHandle,
  gameLauncherHandle,
}: {
  target: NativeWindowCandidate | null;
  hasFocusedAnyWindow: boolean;
  foregroundHandle: string | null;
  bigPictureHandle: string | null;
  gameLauncherHandle: string | null;
}): boolean => {
  if (!target) return false;
  if (!hasFocusedAnyWindow) return true;

  if (!foregroundHandle) return true;
  if (bigPictureHandle && foregroundHandle === bigPictureHandle) return true;
  if (gameLauncherHandle && foregroundHandle === gameLauncherHandle) {
    return true;
  }

  return false;
};
