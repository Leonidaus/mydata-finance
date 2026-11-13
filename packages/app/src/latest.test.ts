import { describe, expect, it } from "vitest";
import { type Outcome, resolveLatest, runGuarded, type Settled } from "./latest";

/** A task whose promise the test settles by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("runGuarded", () => {
  it("reports the answer of a task that was not cancelled", async () => {
    const seen: Outcome<string>[] = [];
    runGuarded(async () => "A", (o) => seen.push(o));
    await flush();
    expect(seen).toEqual([{ status: "ready", data: "A" }]);
  });

  it("reports a failure with its message, also when the task throws right away", async () => {
    const rejected: Outcome<string>[] = [];
    const thrown: Outcome<string>[] = [];
    runGuarded<string>(() => Promise.reject(new Error("Customer not found")), (o) => rejected.push(o));
    runGuarded<string>(() => {
      throw new Error("bad request");
    }, (o) => thrown.push(o));
    await flush();
    expect(rejected).toEqual([{ status: "error", error: "Customer not found" }]);
    expect(thrown).toEqual([{ status: "error", error: "bad request" }]);
  });

  it("reports nothing once cancelled, whether the task then succeeds or fails", async () => {
    const seen: Outcome<string>[] = [];
    const ok = deferred<string>();
    const bad = deferred<string>();
    const cancelOk = runGuarded(() => ok.promise, (o) => seen.push(o));
    const cancelBad = runGuarded(() => bad.promise, (o) => seen.push(o));
    cancelOk();
    cancelBad();
    ok.resolve("late");
    bad.reject(new Error("late failure"));
    await flush();
    expect(seen).toEqual([]);
  });

  it("aborts the task's signal on cancel", () => {
    let signal: AbortSignal | undefined;
    const cancel = runGuarded((s) => {
      signal = s;
      return new Promise<string>(() => {});
    }, () => {});
    expect(signal?.aborted).toBe(false);
    cancel();
    expect(signal?.aborted).toBe(true);
  });

  it("switching customers quickly: the older answer arriving last is not reported", async () => {
    const seen: Outcome<string>[] = [];
    const first = deferred<string>();
    const second = deferred<string>();
    const cancelFirst = runGuarded(() => first.promise, (o) => seen.push(o));
    cancelFirst(); // what the hook does when the request changes
    runGuarded(() => second.promise, (o) => seen.push(o));
    second.resolve("customer B");
    await flush();
    first.resolve("customer A");
    await flush();
    expect(seen).toEqual([{ status: "ready", data: "customer B" }]);
  });
});

describe("resolveLatest", () => {
  const ready: Settled<string> = { key: "A|last_month", scope: "A", outcome: { status: "ready", data: "A's figures" } };
  const failed: Settled<string> = { key: "A|last_month", scope: "A", outcome: { status: "error", error: "boom" } };

  it("shows the outcome of exactly the current request", () => {
    expect(resolveLatest(ready, "A|last_month", "A")).toEqual({ status: "ready", data: "A's figures" });
    expect(resolveLatest(failed, "A|last_month", "A")).toEqual({ status: "error", error: "boom" });
  });

  it("is loading before anything has finished and when there is nothing to load", () => {
    expect(resolveLatest(null, "A|last_month", "A")).toEqual({ status: "loading" });
    expect(resolveLatest(ready, null, null)).toEqual({ status: "loading" });
  });

  it("offers the previous answer only as `previous`, and only within the same scope", () => {
    expect(resolveLatest(ready, "A|last_3_months", "A")).toEqual({ status: "loading", previous: "A's figures" });
    expect(resolveLatest(ready, "B|last_month", "B")).toEqual({ status: "loading" });
    expect(resolveLatest(ready, "A|last_3_months", null)).toEqual({ status: "loading" });
    expect(resolveLatest({ ...ready, scope: null }, "A|last_3_months", null)).toEqual({ status: "loading" });
  });

  it("never carries an error over to another request", () => {
    expect(resolveLatest(failed, "A|last_3_months", "A")).toEqual({ status: "loading" });
    expect(resolveLatest(failed, "B|last_month", "B")).toEqual({ status: "loading" });
  });
});
