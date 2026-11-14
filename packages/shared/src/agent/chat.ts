/**
 * One chat answer: prompt the model, validate its tool calls, retry once with the errors.
 * Provider-neutral: a ChatModel (Gemini today) turns a request into tool calls.
 * Nothing here has access to customer data; the input is the question, the chat history
 * and the dashboard's block definitions.
 */
import type { Block, DashboardOp } from "../blocks";
import { buildSystemPrompt } from "./prompt";
import { REPLY_TOOL, TOOL_DECLARATIONS, type ToolCall, type ToolDeclaration } from "./tools";
import { type CardPick, parseToolCalls } from "./validate";

/** A turn in the conversation. `raw` is the provider's own message, replayed as-is on a retry. */
export interface ChatTurn {
  role: "user" | "model";
  text?: string;
  raw?: unknown;
}

export interface ChatModelRequest {
  system: string;
  turns: ChatTurn[];
  tools: ToolDeclaration[];
}

export interface ChatModelResponse {
  calls: ToolCall[];
  /** Any plain text the model wrote besides tool calls. */
  text?: string;
  raw?: unknown;
}

export interface ChatModel {
  generate(request: ChatModelRequest, signal?: AbortSignal): Promise<ChatModelResponse>;
}

export interface ChatInput {
  question: string;
  /** Earlier turns, with assistant text still containing placeholders. */
  history: { role: "user" | "assistant"; text: string }[];
  blocks: Block[];
  today: string;
}

export interface ChatOutput {
  /** Reply with placeholders, for the app to fill. */
  text: string;
  ops: DashboardOp[];
  /** Calls that were still invalid after the retry, for debugging. */
  rejected: string[];
  /** Whether each added card came from the library or was built custom. */
  picks: CardPick[];
}

export const MAX_QUESTION_CHARS = 1000;
export const MAX_HISTORY_TURNS = 10;

export async function runChat(model: ChatModel, input: ChatInput, signal?: AbortSignal): Promise<ChatOutput> {
  const question = input.question.trim().slice(0, MAX_QUESTION_CHARS);
  const turns: ChatTurn[] = [
    ...input.history.slice(-MAX_HISTORY_TURNS).map((t): ChatTurn => ({ role: t.role === "assistant" ? "model" : "user", text: t.text })),
    { role: "user", text: question },
  ];
  const system = buildSystemPrompt(input.blocks, input.today);

  let res = await model.generate({ system, turns, tools: TOOL_DECLARATIONS }, signal);
  let parsed = parseToolCalls(res.calls, input.blocks);

  // Something was rejected, or there is nothing at all: one retry with the reasons.
  if (parsed.errors.length || (parsed.text === null && !parsed.ops.length)) {
    const problems = parsed.errors.length ? parsed.errors : ["No card and no reply. Answer with a card call (it carries the reply) or with reply."];
    const retryTurns: ChatTurn[] = [
      ...turns,
      { role: "model", raw: res.raw, text: res.text },
      {
        role: "user",
        text: `Some tool calls were rejected:\n- ${problems.join("\n- ")}\nSend the whole answer again with corrected tool calls.`,
      },
    ];
    const retry = await model.generate({ system, turns: retryTurns, tools: TOOL_DECLARATIONS }, signal);
    const reparsed = parseToolCalls(retry.calls, input.blocks);
    // Keep the retry only if it is at least as useful as the first try.
    if (reparsed.ops.length >= parsed.ops.length || (reparsed.text !== null && !parsed.ops.length)) {
      res = retry;
      parsed = { ...reparsed, text: reparsed.text ?? parsed.text };
    }
  }

  // The cards are fine but nothing was said about them: ask for the sentence only, and keep the cards.
  if (parsed.text === null && parsed.ops.length) {
    const ids = parsed.ops.map((o) => (o.op === "add_block" ? o.block.id : o.id)).join(", ");
    const said = await model.generate(
      {
        system,
        turns: [
          ...turns,
          { role: "model", raw: res.raw, text: res.text },
          { role: "user", text: `Done: the dashboard now shows what you asked for (card ids: ${ids}). Now call reply with what to tell the user about it.` },
        ],
        tools: TOOL_DECLARATIONS.filter((t) => t.name === REPLY_TOOL),
      },
      signal,
    );
    parsed = { ...parsed, text: parseToolCalls(said.calls, input.blocks).text ?? (said.text?.trim() || null) };
  }

  const fallback = parsed.ops.length ? "Here is a card for that." : "Sorry, I couldn't build a card for that. Try asking in another way.";
  return { text: parsed.text ?? (res.text?.trim() || fallback), ops: parsed.ops, rejected: parsed.errors, picks: parsed.picks };
}
