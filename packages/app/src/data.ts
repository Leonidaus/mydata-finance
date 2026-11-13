/**
 * Picks where the app's data comes from. Set at build time in packages/app/.env (see .env.example):
 *
 *   VITE_DATA_SOURCE=api       (default) the backend's /api: every customer, engine runs server-side
 *   VITE_DATA_SOURCE=fixtures  the static demo fixtures and the shared engine in the browser, no backend
 *   VITE_API_BASE=<origin>     API mode only. Default is the app's own origin, where the Vite dev
 *                              server (or the host in production) forwards /api to the backend.
 *
 * Both modes implement the same DataSource contract (sources/types.ts).
 */
import { createApiSource } from "./sources/api";
import { createFixtureSource } from "./sources/fixtures";
import type { DataMode, DataSource } from "./sources/types";

export type { CustomerInfo, DataMode, DataSource, TransactionPage } from "./sources/types";

export interface DataConfig {
  mode: DataMode;
  /** API origin without a trailing slash; empty means same origin. */
  apiBase: string;
}

export function resolveDataConfig(env: { VITE_DATA_SOURCE?: string; VITE_API_BASE?: string }): DataConfig {
  const mode = env.VITE_DATA_SOURCE?.trim() || "api";
  if (mode !== "api" && mode !== "fixtures") {
    throw new Error(`VITE_DATA_SOURCE must be "api" or "fixtures", not "${mode}".`);
  }
  return { mode, apiBase: (env.VITE_API_BASE ?? "").trim().replace(/\/+$/, "") };
}

const config = resolveDataConfig(import.meta.env);
const fixtures = createFixtureSource(`${import.meta.env.BASE_URL}fixtures/`);

export const dataSource: DataSource = config.mode === "api" ? createApiSource(config.apiBase) : fixtures;

/**
 * The personas and customer ids offered in the picker. In API mode too: these customers are in
 * the database as well, and nothing else from the fixtures is used there.
 */
export const loadIndex = fixtures.loadIndex;
