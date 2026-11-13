/** An inclusive date range, both ends as YYYY-MM-DD. */
export interface Period {
  from: string;
  to: string;
}

export const PERIOD_NAMES = [
  "this_month",
  "last_month",
  "last_30_days",
  "last_3_months",
  "last_12_months",
  "this_year",
  "all",
] as const;
export type PeriodName = (typeof PERIOD_NAMES)[number];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function utc(year: number, monthIndex: number, day: number): Date {
  return new Date(Date.UTC(year, monthIndex, day));
}

/**
 * Turn a named period into dates, relative to `today`.
 * "last_3_months" and "last_12_months" mean complete calendar months before the
 * current one, so they compare cleanly with the monthly summaries.
 */
export function resolvePeriod(name: PeriodName, today: string): Period {
  const now = new Date(`${today}T00:00:00Z`);
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const endOfLastMonth = iso(utc(year, month, 0));

  switch (name) {
    case "this_month":
      return { from: iso(utc(year, month, 1)), to: today };
    case "last_month":
      return { from: iso(utc(year, month - 1, 1)), to: endOfLastMonth };
    case "last_30_days":
      return { from: iso(utc(year, month, now.getUTCDate() - 29)), to: today };
    case "last_3_months":
      return { from: iso(utc(year, month - 3, 1)), to: endOfLastMonth };
    case "last_12_months":
      return { from: iso(utc(year, month - 12, 1)), to: endOfLastMonth };
    case "this_year":
      return { from: iso(utc(year, 0, 1)), to: today };
    case "all":
      return { from: "0001-01-01", to: today };
  }
}
