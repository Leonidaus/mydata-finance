/**
 * Gemini as a ChatModel: the request and answer format, timeouts, and falling back to another
 * model when one is overloaded.
 *
 * How the HTTP request is sent is left to a transport, because it differs by where this runs:
 * the backend calls Google directly with the API key; the app's no-backend dev mode goes through
 * the Vite dev server, which adds the key. Nothing here knows the key.
 */
import type { ChatModel, ChatTurn } from "./chat";
import type { ToolCall } from "./tools";

/** Sends one generateContent request body to `model` and returns Google's HTTP response. */
export type GeminiTransport = (model: string, body: string, signal: AbortSignal) => Promise<Response>;

export interface GeminiOptions {
  /** Models to try in order. Google often answers 503 "high demand" for a while, so on an overload the next one gets the question. */
  models?: string[];
  /** Per attempt. An overloaded model can hang for a long time before its 503, so give up early. */
  timeoutMs?: number;
  retryDelayMs?: number;
  log?: (level: "info" | "warn", message: string) => void;
}

export const DEFAULT_GEMINI_MODELS = ["gemini-flash-lite-latest", "gemini-flash-latest"];

/** "a, b" → ["a", "b"]; empty or missing → the defaults. */
export function parseGeminiModels(value: string | undefined): string[] {
  const models = (value ?? "")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  return models.length ? models : DEFAULT_GEMINI_MODELS;
}

/** Overloaded, rate-limited or briefly broken: worth another try. */
const RETRYABLE = new Set([429, 500, 503, 504]);

class RetryableError extends Error {}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(t), reject(signal.reason)), { once: true });
  });

interface Part {
  text?: string;
  functionCall?: { name: string; args?: Record<string, unknown> };
}
interface Content {
  role: "user" | "model";
  parts: Part[];
}

const toContent = (t: ChatTurn): Content => (t.raw as Content | undefined) ?? { role: t.role, parts: [{ text: t.text ?? "" }] };

export function createGeminiModel(transport: GeminiTransport, options: GeminiOptions = {}): ChatModel {
  const models = options.models?.length ? options.models : DEFAULT_GEMINI_MODELS;
  const timeoutMs = options.timeoutMs ?? 20_000;
  const retryDelayMs = options.retryDelayMs ?? 1_000;
  const log = options.log ?? (() => {});

  async function call(model: string, body: string, signal?: AbortSignal): Promise<Response> {
    const timeout = AbortSignal.timeout(timeoutMs);
    let res: Response;
    try {
      res = await transport(model, body, signal ? AbortSignal.any([signal, timeout]) : timeout);
    } catch (e) {
      if (signal?.aborted) throw e;
      if (timeout.aborted) throw new RetryableError(`${model} did not answer within ${timeoutMs / 1000} s.`);
      throw e;
    }
    if (res.ok) return res;
    const err = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    const msg = `Gemini (${model}) answered ${res.status}${err?.error?.message ? `: ${err.error.message}` : ""}`;
    throw RETRYABLE.has(res.status) ? new RetryableError(msg) : new Error(`${msg}.`);
  }

  /** Tries each model, the first one twice, and moves on only when the failure is an overload or timeout. */
  async function callWithFallback(body: string, signal?: AbortSignal): Promise<Response> {
    const attempts = [models[0], ...models];
    let last: unknown;
    for (const [i, model] of attempts.entries()) {
      if (i === 1) await sleep(retryDelayMs, signal);
      try {
        const res = await call(model, body, signal);
        if (i > 0) log("info", `answered by ${model} after ${i} failed ${i === 1 ? "try" : "tries"}`);
        return res;
      } catch (e) {
        if (!(e instanceof RetryableError)) throw e;
        log("warn", e.message);
        last = e;
      }
    }
    throw new Error(`Gemini is busy right now (${last instanceof Error ? last.message : "no answer"}). Try again in a moment.`);
  }

  return {
    async generate({ system, turns, tools }, signal) {
      const res = await callWithFallback(
        JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: turns.map(toContent),
          tools: [{ functionDeclarations: tools }],
          toolConfig: { functionCallingConfig: { mode: "ANY" } },
          generationConfig: { temperature: 0.4, maxOutputTokens: 8192 },
        }),
        signal,
      );
      const data = (await res.json()) as { candidates?: { content?: Content; finishReason?: string }[] };
      const content = data.candidates?.[0]?.content;
      if (!content?.parts) throw new Error(`Gemini returned no answer (${data.candidates?.[0]?.finishReason ?? "empty"}).`);
      const calls: ToolCall[] = content.parts.flatMap((p) => (p.functionCall ? [{ name: p.functionCall.name, args: p.functionCall.args ?? {} }] : []));
      const text = content.parts.map((p) => p.text ?? "").join("").trim() || undefined;
      return { calls, text, raw: content };
    },
  };
}
