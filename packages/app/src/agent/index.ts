/**
 * The two ways a question gets answered:
 * - `cannedReply`: the suggested prompts. Answered locally by the keyword rules, instantly and
 *   without an API call.
 * - `askAgent`: free text. It goes, in this order of preference, to
 *     "server"   the backend's POST /api/chat, when the app uses the backend and it has a model;
 *     "browser"  Gemini through the Vite dev server, when `npm run dev` has GEMINI_API_KEY
 *                (dev mode works without the backend);
 *     "mock"     the keyword rules.
 *   All return { text, ops }; the model's text may contain {{blockId.value}} placeholders, which
 *   App fills from the computed results.
 *
 * The model only ever gets the question, the chat history (unfilled) and the block definitions.
 */
import { type Block, type ChatOutput, runChat } from "@mydata/shared";
import { apiBase } from "../data";
import { gemini, geminiAvailable } from "./gemini";
import { type AgentReply, type RunEngine, respond } from "./mockAgent";
import { createServerChat } from "./server";

export type { AgentReply, RunEngine };
export { geminiAvailable };

export type ChatMode = "server" | "browser" | "mock";

export interface AgentContext {
  customerId: string;
  blocks: Block[];
  today: string;
  history: { role: "user" | "assistant"; text: string }[];
  run: RunEngine;
  /** Whether the app is using the backend for this customer (API mode, not dev mode). */
  useBackend: boolean;
}

const serverChat = createServerChat(apiBase);

/** Which of the three answers typed questions right now. */
export async function chatMode(useBackend: boolean): Promise<ChatMode> {
  if (useBackend && (await serverChat.available())) return "server";
  return geminiAvailable ? "browser" : "mock";
}

function report(out: ChatOutput): AgentReply {
  if (out.rejected.length) console.warn("Model tool calls rejected:", out.rejected);
  for (const p of out.picks ?? []) {
    if (p.via === "library") console.info(`[agent] ${p.blockId}: library component ${p.component}`);
    else console.info(`[agent] ${p.blockId}: custom ${p.view}${p.why ? ` (why: ${p.why})` : ""}`);
  }
  return { text: out.text, ops: out.ops };
}

export const cannedReply = (prompt: string, ctx: AgentContext): Promise<AgentReply> => respond(prompt, ctx.blocks, ctx.run);

export async function askAgent(question: string, ctx: AgentContext): Promise<AgentReply> {
  const mode = await chatMode(ctx.useBackend);
  if (mode === "server") {
    return report(await serverChat.ask({ customerId: ctx.customerId, question, history: ctx.history, blocks: ctx.blocks }));
  }
  if (mode === "browser") {
    return report(await runChat(gemini, { question, history: ctx.history, blocks: ctx.blocks, today: ctx.today }));
  }
  return respond(question, ctx.blocks, ctx.run);
}
