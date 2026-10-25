export interface ReadQueueOptions {
  canRead(): boolean;
  send(ids: readonly string[]): Promise<{ ok: boolean; httpStatus: number }>;
  onChanged(): void;
  onError(failed: boolean, httpStatus?: number): void;
}

/** Exact-ID, monotonic acknowledgement queue. No range or latest-cursor writes. */
export function createReadQueue(options: ReadQueueOptions) {
  const pending = new Set<string>();
  let confirmed = new Set<string>();
  let active = true;
  let sending = false;
  let failed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  async function flush() {
    if (!active || sending || failed || !options.canRead()) return;
    const ids = [...pending].slice(0, 100);
    if (!ids.length) return;
    sending = true;
    const result = await options.send(ids);
    if (!active) return;
    sending = false;
    if (!result.ok) {
      failed = true;
      options.onError(true, result.httpStatus);
      return;
    }
    for (const id of ids) { pending.delete(id); confirmed.add(id); }
    if (confirmed.size > 2000) confirmed = new Set([...confirmed].slice(-1000));
    options.onChanged();
    if (pending.size) timer = setTimeout(() => { timer = undefined; void flush(); }, 250);
  }
  return {
    display(ids: readonly string[]) {
      if (!active || !options.canRead()) return;
      for (const id of ids) {
        if (!confirmed.has(id) && pending.size < 2000) pending.add(id);
      }
      if (!failed && !sending && pending.size && !timer) {
        timer = setTimeout(() => { timer = undefined; void flush(); }, 250);
      }
    },
    pause() { pending.clear(); clearTimeout(timer); timer = undefined; },
    retry() { failed = false; options.onError(false); void flush(); },
    activate() { active = true; sending = false; },
    dispose() { active = false; pending.clear(); clearTimeout(timer); timer = undefined; },
  };
}
