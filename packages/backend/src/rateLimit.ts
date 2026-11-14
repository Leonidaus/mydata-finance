import type { MiddlewareHandler } from "hono";

export interface RequestBudget {
  /** Most requests allowed in any 60 seconds, counted across all callers. */
  perMinute: number;
  /** Most requests allowed in any 60 minutes, counted across all callers. */
  perHour: number;
}

/**
 * Caps how often a route that spends money on an outside service (speech, the language
 * model) can be called. The count is global, not per caller: the point is to bound what a
 * public demo can cost, and a per-address limit is easy to get around.
 * Answers 429 with a Retry-After header when the budget is used up.
 */
export function requestBudget(name: string, budget: RequestBudget, now: () => number = Date.now): MiddlewareHandler {
  let recent: number[] = [];
  return async (c, next) => {
    const time = now();
    recent = recent.filter((t) => time - t < 3_600_000);
    const lastMinute = recent.filter((t) => time - t < 60_000).length;
    if (lastMinute >= budget.perMinute || recent.length >= budget.perHour) {
      const oldest = lastMinute >= budget.perMinute ? recent[recent.length - budget.perMinute] : recent[0];
      const window = lastMinute >= budget.perMinute ? 60_000 : 3_600_000;
      const retryAfter = Math.max(1, Math.ceil((oldest + window - time) / 1000));
      c.header("retry-after", String(retryAfter));
      return c.json({ error: `The ${name} service is busy. Try again in ${retryAfter} seconds.` }, 429);
    }
    recent.push(time);
    return next();
  };
}
