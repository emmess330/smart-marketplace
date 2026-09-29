import type { Context } from "hono/mod.ts";

// Fixed-window counters held in this process's memory. That suits this app,
// which runs one instance of each service; with several instances each would
// count separately, and the counters would need a shared store (e.g. Redis).
export class RateLimiter {
  #windows = new Map<string, { count: number; resetAt: number }>();
  #hitsSinceSweep = 0;

  constructor(readonly max: number, readonly windowMs: number) {}

  // Seconds until `key` may try again, or 0 if it isn't currently blocked.
  retryAfter(key: string): number {
    const window = this.#windows.get(key);
    if (!window || window.resetAt <= Date.now() || window.count < this.max) return 0;
    return Math.ceil((window.resetAt - Date.now()) / 1000);
  }

  // Counts one hit against `key`.
  hit(key: string) {
    const now = Date.now();
    const window = this.#windows.get(key);
    if (!window || window.resetAt <= now) {
      this.#windows.set(key, { count: 1, resetAt: now + this.windowMs });
    } else {
      window.count += 1;
    }
    this.#sweep(now);
  }

  reset(key: string) {
    this.#windows.delete(key);
  }

  // Drop expired windows now and then, so keys from one-off clients (or an
  // attacker cycling through emails) don't accumulate forever.
  #sweep(now: number) {
    if (++this.#hitsSinceSweep < 1000) return;
    this.#hitsSinceSweep = 0;
    for (const [key, window] of this.#windows) {
      if (window.resetAt <= now) this.#windows.delete(key);
    }
  }
}

// Limit from the environment (so tests and deployments can tune it), else the default.
export function limitFromEnv(name: string, fallback: number) {
  const value = Number(Deno.env.get(name));
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

// The TCP peer address. X-Forwarded-For is deliberately ignored: with no
// trusted proxy in front of the services, any client could set it.
export function clientIp(c: Context) {
  const addr = (c.env as Deno.ServeHandlerInfo | undefined)?.remoteAddr;
  return addr && "hostname" in addr ? addr.hostname : "unknown";
}

export function tooManyRequests(c: Context, retryAfterSeconds: number) {
  c.header("Retry-After", String(retryAfterSeconds));
  return c.json(
    { error: "Too many attempts. Please try again later.", retry_after: retryAfterSeconds },
    429,
  );
}
