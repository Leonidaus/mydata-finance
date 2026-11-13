import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

/** Bind values accepted by the SQLite driver. */
export type SqlValue = string | number | null;
export type SqlParams = Record<string, SqlValue>;

/**
 * The finance database built by data/prep/build_database.py, opened read-only,
 * together with the demo's fixed "today".
 */
export interface FinanceDb {
  /** The demo's current date (YYYY-MM-DD). Transactions after it are never shown. */
  readonly today: string;
  /** Values from the `meta` table: thresholds, row counts, build time. */
  readonly meta: Readonly<Record<string, string>>;
  all<Row>(sql: string, params?: SqlParams): Row[];
  get<Row>(sql: string, params?: SqlParams): Row | undefined;
  close(): void;
}

const here = dirname(fileURLToPath(import.meta.url));

/** Default location: data/out/finance.sqlite at the repository root. */
export const DEFAULT_DB_PATH = resolve(here, "../../../data/out/finance.sqlite");

export function wrapDatabase(database: DatabaseSync): FinanceDb {
  const metaRows = database.prepare("SELECT key, value FROM meta").all() as unknown as {
    key: string;
    value: string;
  }[];
  const meta = Object.fromEntries(metaRows.map((row) => [row.key, row.value]));
  const today = meta.demo_today;
  if (!today) throw new Error("The database has no demo_today in its meta table");

  return {
    today,
    meta,
    all<Row>(sql: string, params: SqlParams = {}) {
      return database.prepare(sql).all(params) as unknown as Row[];
    },
    get<Row>(sql: string, params: SqlParams = {}) {
      return database.prepare(sql).get(params) as unknown as Row | undefined;
    },
    close() {
      database.close();
    },
  };
}

export function openDatabase(path: string = process.env.FINANCE_DB ?? DEFAULT_DB_PATH): FinanceDb {
  if (!existsSync(path)) {
    throw new Error(
      `Finance database not found at ${path}. Build it with:\n` +
        "  python3 data/prep/build_database.py --raw data/raw --out data/out/finance.sqlite",
    );
  }
  return wrapDatabase(new DatabaseSync(path, { readOnly: true }));
}
