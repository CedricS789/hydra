/** Reserve a game's launch through process detection, including the gap after dispatch. */
export class GameLaunchCoordinator {
  private readonly pending = new Map<string, Promise<unknown>>();

  run<T>(
    key: string,
    launch: () => Promise<{ value: T; dispatched: boolean }>,
    observation: {
      isRunning: () => boolean;
      subscribe: (listener: () => void) => () => void;
      timeoutMs?: number;
    }
  ): Promise<T> {
    const existing = this.pending.get(key);
    if (existing) return existing as Promise<T>;
    const request = Promise.resolve()
      .then(async () => {
        const result = await launch();
        if (result.dispatched && !observation.isRunning()) {
          await new Promise<void>((resolve, reject) => {
            let unsubscribe = () => {};
            const finish = (error?: Error) => {
              clearTimeout(timer);
              unsubscribe();
              if (error) reject(error);
              else resolve();
            };
            const timer = setTimeout(
              () => finish(new Error("game_launch_not_detected")),
              observation.timeoutMs ?? 60_000
            );
            const check = () => {
              if (observation.isRunning()) finish();
            };
            unsubscribe = observation.subscribe(check);
            // A game may start between the first read and listener registration.
            check();
          });
        }
        return result.value;
      })
      .finally(() => {
        if (this.pending.get(key) === request) this.pending.delete(key);
      });
    this.pending.set(key, request);
    return request;
  }
}
