/** A delayed initial read must never overwrite an event received after subscribing. */
export function observeLatestSnapshot<T>(
  subscribe: (apply: (value: T) => void) => () => void,
  read: () => Promise<T>,
  apply: (value: T) => void
): () => void {
  let active = true;
  let receivedEvent = false;
  const unsubscribe = subscribe((value) => {
    if (!active) return;
    receivedEvent = true;
    apply(value);
  });
  void read()
    .then((value) => {
      if (active && !receivedEvent) apply(value);
    })
    .catch(() => {});
  return () => {
    active = false;
    unsubscribe();
  };
}
