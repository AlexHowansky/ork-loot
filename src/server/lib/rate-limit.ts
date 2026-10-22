import { AppError } from "./errors.ts";

/** Fixed-window, in-memory attempt limiter keyed by e.g. client IP. */
export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Records an attempt; throws a 429 when the limit is exceeded. */
  hit(key: string) {
    const now = Date.now();
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      this.prune(now);
      return;
    }
    entry.count++;
    if (entry.count > this.limit) {
      throw new AppError(
        429,
        "Too many attempts. Please wait a minute and try again.",
      );
    }
  }

  private prune(now: number) {
    if (this.hits.size < 10_000) return;
    for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k);
  }
}
