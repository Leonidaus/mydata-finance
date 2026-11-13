/**
 * API mode: asks the backend (packages/backend) for everything, so any of its customers works.
 * The engine runs on the server; the app only sends a block's DataRequest or a transaction filter.
 */
import type { EngineResult } from "@mydata/shared";
import type { DataSource, TransactionPage } from "./types";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isAbort = (e: unknown) => isRecord(e) && e.name === "AbortError";

/** The message shown for a failed request. The backend answers errors as `{ error: string }`. */
export function failureMessage(status: number, body: unknown): string {
  if (isRecord(body) && typeof body.error === "string" && body.error) return body.error;
  // Without a JSON error the answer came from something in front of the backend, e.g. the dev proxy.
  if (status >= 500) return `The finance API is not available (status ${status}). Is the backend running?`;
  return `The finance API answered with status ${status}.`;
}

/** `base` is the API origin without a trailing slash; empty means same origin. */
export function createApiSource(base = "", fetchFn: typeof fetch = (...args) => fetch(...args)): DataSource {
  async function call(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
    let res: Response;
    try {
      res = await fetchFn(base + path, init);
    } catch (e) {
      if (isAbort(e)) throw e;
      throw new Error("Could not reach the finance API. Is the backend running?");
    }
    const body: unknown = await res.json().catch((e: unknown) => {
      if (isAbort(e)) throw e;
      return undefined;
    });
    if (!res.ok) throw new Error(failureMessage(res.status, body));
    if (!isRecord(body)) throw new Error("The finance API gave an answer the app could not read. Check the API address.");
    return body;
  }

  const post = (path: string, body: unknown, signal?: AbortSignal) =>
    call(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });

  function unexpected(what: string): never {
    throw new Error(`The finance API gave an unexpected answer for ${what}.`);
  }

  // The demo's "today" is fixed while the backend runs, so ask once. A failure is not remembered.
  let today: Promise<string> | null = null;
  function loadToday(): Promise<string> {
    if (!today) {
      const p = call("/api/health").then((health) => (typeof health.today === "string" ? health.today : unexpected("its status")));
      p.catch(() => {
        if (today === p) today = null;
      });
      today = p;
    }
    return today;
  }

  return {
    mode: "api",

    async customer(customerId, signal) {
      const [profile, day] = await Promise.all([call(`/api/customers/${encodeURIComponent(customerId)}`, { signal }), loadToday()]);
      if (typeof profile.customerId !== "string" || typeof profile.age !== "number") unexpected("this customer");
      return { customerId: profile.customerId, age: profile.age, today: day };
    },

    async runData(customerId, request, signal) {
      const result = await post("/api/data", { customerId, data: request }, signal);
      if (!Array.isArray(result.rows)) unexpected("this block");
      return result as unknown as EngineResult;
    },

    async transactions(customerId, filter, limit, signal) {
      const page = await post("/api/transactions", { customerId, filter, limit }, signal);
      if (typeof page.count !== "number" || !Array.isArray(page.transactions)) unexpected("these transactions");
      return page as unknown as TransactionPage;
    },
  };
}
