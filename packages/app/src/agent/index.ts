/**
 * The two ways a question gets answered:
 * - `cannedReply`: the suggested prompts. Answered locally by the keyword rules, instantly and
 *   without an API call.
 * - `askAgent`: free text. Goes to Gemini when the dev server has GEMINI_API_KEY (see
 *   vite.config.ts), otherwise to the keyword rules. Both return { text, ops }; Gemini's text may
 *   contain {{blockId.value}} placeholders, which App fills from the computed results.
 *
 * Gemini only ever gets the question, the chat history (unfilled) and the block definitions.
 */
import { type Block, runChat } from "@mydata/shared";
import { gemini, geminiAvailable } from "./gemini";
import { type AgentReply, type RunEngine, respond } from "./mockAgent";

export type { AgentReply, RunEngine };
export { geminiAvailable };

export interface AgentContext {
  blocks: Block[];
  today: string;
  history: { role: "user" | "assistant"; text: string }[];
  run: RunEngine;
}

export const cannedReply = (prompt: string, ctx: AgentContext): Promise<AgentReply> => respond(prompt, ctx.blocks, ctx.run);

export async function askAgent(question: string, ctx: AgentContext): Promise<AgentReply> {
  if (!geminiAvailable) return respond(question, ctx.blocks, ctx.run);
  const out = await runChat(gemini, { question, history: ctx.history, blocks: ctx.blocks, today: ctx.today });
  if (out.rejected.length) console.warn("Gemini tool calls rejected:", out.rejected);
  for (const p of out.picks) {
    if (p.via === "library") console.info(`[agent] ${p.blockId}: library component ${p.component}`);
    else console.info(`[agent] ${p.blockId}: custom ${p.view}${p.why ? ` (why: ${p.why})` : ""}`);
  }
  return { text: out.text, ops: out.ops };
}
