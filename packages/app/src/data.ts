/**
 * Loads demo fixtures (built by data/prep/build_fixtures.py) and runs block data requests.
 * Phase 2 replaces this with calls to the backend's /api/data.
 */
import {
  type Block,
  type Cohorts,
  contextFromFixture,
  type EngineContext,
  type EngineResult,
  type FixtureBundle,
  type FixtureIndex,
  runEngine,
} from "@mydata/shared";

const base = `${import.meta.env.BASE_URL}fixtures/`;

async function getJson<T>(name: string): Promise<T> {
  const res = await fetch(base + name);
  if (!res.ok) throw new Error(`Could not load ${name} (${res.status})`);
  return (await res.json()) as T;
}

let indexPromise: Promise<FixtureIndex> | null = null;
let cohortsPromise: Promise<Cohorts> | null = null;
const contexts = new Map<string, Promise<EngineContext>>();

export const loadIndex = () => (indexPromise ??= getJson<FixtureIndex>("index.json"));

export function loadContext(customerId: string): Promise<EngineContext> {
  let p = contexts.get(customerId);
  if (!p) {
    cohortsPromise ??= getJson<Cohorts>("cohorts.json");
    p = Promise.all([loadIndex(), cohortsPromise, getJson<FixtureBundle>(`${customerId}.json`)]).then(
      ([index, cohorts, bundle]) => contextFromFixture(bundle, cohorts, index.today),
    );
    contexts.set(customerId, p);
  }
  return p;
}

export function runBlock(ctx: EngineContext, block: Block): EngineResult {
  if (block.data.kind === "sql") {
    throw new Error("SQL blocks need the backend (phase 2).");
  }
  return runEngine(ctx, block.data.fn, block.data.args);
}
