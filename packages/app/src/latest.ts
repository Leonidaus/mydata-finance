/**
 * Async state for one request at a time: loading, ready or failed, with retry.
 * An answer is only ever shown for the request that is current. Changing the request (other
 * customer, other controls), closing the view or retrying drops whatever is still on its way.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export type Outcome<T> = { status: "ready"; data: T } | { status: "error"; error: string };

/** While loading, `previous` is the last answer from the same scope (if one was asked for), to show as "updating". */
export type Latest<T> = { status: "loading"; previous?: T } | Outcome<T>;

export interface Settled<T> {
  key: string;
  scope: string | null;
  outcome: Outcome<T>;
}

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Starts `task` and reports how it ended, unless it was cancelled first.
 * Returns the cancel function, which also aborts the task's signal.
 */
export function runGuarded<T>(task: (signal: AbortSignal) => Promise<T>, onSettled: (outcome: Outcome<T>) => void): () => void {
  const controller = new AbortController();
  const live = () => !controller.signal.aborted;
  new Promise<T>((resolve) => resolve(task(controller.signal))).then(
    (data) => live() && onSettled({ status: "ready", data }),
    (e: unknown) => live() && onSettled({ status: "error", error: errorMessage(e) }),
  );
  return () => controller.abort();
}

/** What to show for request `key`, given the last request that finished. */
export function resolveLatest<T>(settled: Settled<T> | null, key: string | null, scope: string | null): Latest<T> {
  if (settled && settled.key === key) return settled.outcome;
  if (settled && scope !== null && settled.scope === scope && settled.outcome.status === "ready") {
    return { status: "loading", previous: settled.outcome.data };
  }
  return { status: "loading" };
}

/**
 * Runs `task` whenever `key` changes and returns its state; `key` must identify the request
 * completely (null = nothing to load yet). With a `scope`, e.g. the customer, the last answer
 * from the same scope is offered as `previous` while the next one loads; without, never.
 */
export function useLatest<T>(
  key: string | null,
  task: (signal: AbortSignal) => Promise<T>,
  scope: string | null = null,
): Latest<T> & { retry: () => void } {
  const [settled, setSettled] = useState<Settled<T> | null>(null);
  const [attempt, setAttempt] = useState(0);
  const taskRef = useRef(task);
  taskRef.current = task;

  useEffect(() => {
    if (key === null) return;
    return runGuarded(
      (signal) => taskRef.current(signal),
      (outcome) => setSettled({ key, scope, outcome }),
    );
    // `scope` belongs to `key`: it is read when the request starts.
  }, [key, attempt]);

  const retry = useCallback(() => {
    setSettled(null);
    setAttempt((n) => n + 1);
  }, []);

  return { ...resolveLatest(settled, key, scope), retry };
}
