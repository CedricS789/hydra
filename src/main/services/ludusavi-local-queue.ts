/** One writer across games; repeated requests for a game share its queued task. */
export class LudusaviBackupQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private pending = new Map<string, Promise<unknown>>();

  get busy() {
    return this.pending.size > 0;
  }
  drain() {
    return this.tail;
  }

  enqueue<T>(key: string, task: () => Promise<T>): Promise<T> {
    const existing = this.pending.get(key);
    if (existing) return existing as Promise<T>;
    const result = this.tail.catch(() => undefined).then(task);
    this.pending.set(key, result);
    this.tail = result.catch(() => undefined);
    void result
      .finally(() => {
        if (this.pending.get(key) === result) this.pending.delete(key);
      })
      .catch(() => undefined);
    return result;
  }
}
