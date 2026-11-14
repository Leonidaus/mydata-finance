/**
 * The chat through the backend: POST /api/chat. The server builds the prompt, calls the model
 * with its own key and validates the answer; the app sends the question, the conversation so
 * far and the dashboard's card definitions, and gets back a reply and card operations.
 */
import type { Block, ChatOutput } from "@mydata/shared";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export interface ServerChat {
  /** Whether the backend has a chat model configured. False when it cannot be reached. */
  available(): Promise<boolean>;
  ask(input: { customerId: string; question: string; history: { role: "user" | "assistant"; text: string }[]; blocks: Block[] }, signal?: AbortSignal): Promise<ChatOutput>;
}

/** `base` is the API origin without a trailing slash; empty means same origin. */
export function createServerChat(base = "", fetchFn: typeof fetch = (...args) => fetch(...args)): ServerChat {
  // Asked once and remembered; a failed check is not, so a backend that comes up later is noticed.
  let availability: Promise<boolean> | null = null;
  return {
    available() {
      if (!availability) {
        const check = fetchFn(`${base}/api/health`)
          .then((res) => (res.ok ? res.json() : null))
          .then((health: unknown) => isRecord(health) && isRecord(health.services) && health.services.chat === true)
          .catch(() => false);
        check.then((ok) => {
          if (!ok && availability === check) availability = null;
        });
        availability = check;
      }
      return availability;
    },

    async ask(input, signal) {
      let res: Response;
      try {
        res = await fetchFn(`${base}/api/chat`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
          signal,
        });
      } catch (e) {
        if (signal?.aborted) throw e;
        throw new Error("Could not reach the coach. Is the backend running?");
      }
      const body: unknown = await res.json().catch(() => undefined);
      if (!res.ok) {
        throw new Error(isRecord(body) && typeof body.error === "string" ? body.error : `The coach answered with status ${res.status}.`);
      }
      if (!isRecord(body) || typeof body.text !== "string" || !Array.isArray(body.ops)) {
        throw new Error("The coach gave an answer the app could not read.");
      }
      return body as unknown as ChatOutput;
    },
  };
}
