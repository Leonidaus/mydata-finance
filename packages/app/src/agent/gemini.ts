/**
 * Gemini over REST, through the dev server's /gemini route (vite.config.ts adds the API key there,
 * so the key never reaches the browser). Implements the shared ChatModel contract.
 */
import type { ChatModel, ChatTurn, ToolCall } from "@mydata/shared";

/** True when `npm run dev` was started with GEMINI_API_KEY set. */
export const geminiAvailable: boolean = typeof __GEMINI_PROXY__ !== "undefined" && __GEMINI_PROXY__;

const MODEL = import.meta.env.VITE_GEMINI_MODEL?.trim() || "gemini-flash-latest";
const TIMEOUT_MS = 45_000;

interface Part {
  text?: string;
  functionCall?: { name: string; args?: Record<string, unknown> };
}
interface Content {
  role: "user" | "model";
  parts: Part[];
}

const toContent = (t: ChatTurn): Content => (t.raw as Content | undefined) ?? { role: t.role, parts: [{ text: t.text ?? "" }] };

export const gemini: ChatModel = {
  async generate({ system, turns, tools }, signal) {
    const timeout = AbortSignal.timeout(TIMEOUT_MS);
    const res = await fetch(`/gemini/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: turns.map(toContent),
        tools: [{ functionDeclarations: tools }],
        toolConfig: { functionCallingConfig: { mode: "ANY" } },
        generationConfig: { temperature: 0.4, maxOutputTokens: 8192 },
      }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      throw new Error(`Gemini answered ${res.status}${body?.error?.message ? `: ${body.error.message}` : ""}.`);
    }
    const data = (await res.json()) as { candidates?: { content?: Content; finishReason?: string }[] };
    const content = data.candidates?.[0]?.content;
    if (!content?.parts) throw new Error(`Gemini returned no answer (${data.candidates?.[0]?.finishReason ?? "empty"}).`);
    const calls: ToolCall[] = content.parts.flatMap((p) => (p.functionCall ? [{ name: p.functionCall.name, args: p.functionCall.args ?? {} }] : []));
    const text = content.parts.map((p) => p.text ?? "").join("").trim() || undefined;
    return { calls, text, raw: content };
  },
};
