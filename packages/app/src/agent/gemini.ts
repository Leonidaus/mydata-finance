/**
 * Gemini over REST, through the dev server's /gemini route (vite.config.ts adds the API key there,
 * so the key never reaches the browser). Implements the shared ChatModel contract.
 */
import type { ChatModel, ChatTurn, ToolCall } from "@mydata/shared";

/** True when `npm run dev` was started with GEMINI_API_KEY set. */
export const geminiAvailable: boolean = typeof __GEMINI_PROXY__ !== "undefined" && __GEMINI_PROXY__;

/**
 * Models to try in order. VITE_GEMINI_MODEL may list several, comma-separated. Google often answers
 * 503 "high demand" for a while, so on an overload the next model gets the question.
 */
const MODELS = (import.meta.env.VITE_GEMINI_MODEL || "gemini-flash-lite-latest,gemini-flash-latest")
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);
/** Per attempt. An overloaded model can hang for a long time before its 503, so give up early. */
const TIMEOUT_MS = 20_000;
const RETRY_DELAY_MS = 1_000;
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

async function call(model: string, body: string, signal?: AbortSignal): Promise<Response> {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`/gemini/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      body,
    });
  } catch (e) {
    if (signal?.aborted) throw e;
    if (timeout.aborted) throw new RetryableError(`${model} did not answer within ${TIMEOUT_MS / 1000} s.`);
    throw e;
  }
  if (res.ok) return res;
  const err = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  const msg = `Gemini (${model}) answered ${res.status}${err?.error?.message ? `: ${err.error.message}` : ""}`;
  throw RETRYABLE.has(res.status) ? new RetryableError(msg) : new Error(`${msg}.`);
}

/** Tries each model, the first one twice, and moves on only when the failure is an overload or timeout. */
async function callWithFallback(body: string, signal?: AbortSignal): Promise<Response> {
  const attempts = [MODELS[0], ...MODELS];
  let last: unknown;
  for (const [i, model] of attempts.entries()) {
    if (i === 1) await sleep(RETRY_DELAY_MS, signal);
    try {
      const res = await call(model, body, signal);
      if (i > 0) console.info(`[agent] answered by ${model} after ${i} failed ${i === 1 ? "try" : "tries"}`);
      return res;
    } catch (e) {
      if (!(e instanceof RetryableError)) throw e;
      console.warn(`[agent] ${e.message}`);
      last = e;
    }
  }
  throw new Error(`Gemini is busy right now (${last instanceof Error ? last.message : "no answer"}). Try again in a moment.`);
}

export const gemini: ChatModel = {
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
