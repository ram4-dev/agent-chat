import { RATE_LIMITS } from '@agent-chat/contracts';

/** Process-local fixed windows; restart resets budgets on this single-node MVP. */
export function createRequestLimiter(now = Date.now) {
  const windows = new Map<string, { expiresAt: number; count: number }>();
  return {
    allow(key: string, max: number): boolean {
      const at = now();
      let window = windows.get(key);
      if (window === undefined || window.expiresAt <= at) {
        for (const [candidate, value] of windows) if (value.expiresAt <= at) windows.delete(candidate);
        if (windows.size >= RATE_LIMITS.MAX_KEYS && !windows.has(key)) return false;
        window = { expiresAt: at + RATE_LIMITS.WINDOW_MS, count: 0 };
        windows.set(key, window);
      }
      if (window.count >= max) return false;
      window.count += 1;
      return true;
    },
  };
}
