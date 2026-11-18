import { create } from "zustand";

export const useLaunchRequestsStore = create<{ pending: ReadonlySet<string> }>(
  () => ({ pending: new Set() })
);
const requests = new Map<string, Promise<unknown>>();

/** Synchronous reservation also catches a second click before React rerenders. */
export function runBigPictureLaunch<T>(
  key: string,
  operation: () => Promise<T>
): Promise<T> {
  const active = requests.get(key);
  if (active) return active as Promise<T>;
  const pending = new Set(useLaunchRequestsStore.getState().pending).add(key);
  useLaunchRequestsStore.setState({ pending });
  const request = Promise.resolve()
    .then(operation)
    .finally(() => {
      if (requests.get(key) !== request) return;
      requests.delete(key);
      const next = new Set(useLaunchRequestsStore.getState().pending);
      next.delete(key);
      useLaunchRequestsStore.setState({ pending: next });
    });
  requests.set(key, request);
  return request;
}
