/**
 * Fixture mode: loads the demo fixtures (built by data/prep/build_fixtures.py) and runs the
 * shared engine in the browser. Only the 15 fixture customers exist here.
 */
import {
  type Cohorts,
  contextFromFixture,
  type EngineContext,
  filterTransactions,
  type FixtureBundle,
  type FixtureIndex,
  runEngine,
} from "@mydata/shared";
import { type DataSource, DEFAULT_TX_LIMIT, MAX_TX_LIMIT } from "./types";

export interface FixtureSource extends DataSource {
  /** Personas and customer ids for the picker. */
  loadIndex(): Promise<FixtureIndex>;
}

/** `base` is the fixtures folder URL, ending in a slash. */
export function createFixtureSource(base: string, fetchFn: typeof fetch = (...args) => fetch(...args)): FixtureSource {
  async function getJson<T>(name: string): Promise<T> {
    const res = await fetchFn(base + name);
    if (!res.ok) throw new Error(`Could not load ${name} (${res.status})`);
    return (await res.json()) as T;
  }

  // Loaded once and shared by all callers. A failed load is forgotten so that a retry fetches again.
  const cache = new Map<string, Promise<unknown>>();
  function once<T>(key: string, load: () => Promise<T>): Promise<T> {
    let p = cache.get(key) as Promise<T> | undefined;
    if (!p) {
      p = load();
      cache.set(key, p);
      p.catch(() => cache.delete(key));
    }
    return p;
  }

  const loadIndex = () => once("index", () => getJson<FixtureIndex>("index.json"));
  const loadCohorts = () => once("cohorts", () => getJson<Cohorts>("cohorts.json"));
  const loadContext = (customerId: string) =>
    once(`customer:${customerId}`, async (): Promise<EngineContext> => {
      const [index, cohorts, bundle] = await Promise.all([loadIndex(), loadCohorts(), getJson<FixtureBundle>(`${customerId}.json`)]);
      return contextFromFixture(bundle, cohorts, index.today);
    });

  return {
    mode: "fixtures",
    loadIndex,

    async customer(customerId) {
      const ctx = await loadContext(customerId);
      return { customerId: ctx.customer.customer_id, age: ctx.customer.customer_age, today: ctx.today };
    },

    async runData(customerId, request) {
      if (request.kind === "sql") {
        throw new Error("SQL blocks need the backend (phase 2).");
      }
      return runEngine(await loadContext(customerId), request.fn, request.args);
    },

    async transactions(customerId, filter, limit = DEFAULT_TX_LIMIT) {
      const matching = filterTransactions(await loadContext(customerId), filter);
      const take = Math.min(Math.max(limit, 0), MAX_TX_LIMIT);
      return { count: matching.length, transactions: take === 0 ? [] : matching.slice(-take).reverse() };
    },
  };
}
