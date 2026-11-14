/**
 * The chat on the server: the prompt, the model call and the checking of the model's answer
 * all happen here, so the browser only sends the question and gets back a validated reply.
 *
 * An answer takes two steps:
 * 1. The model chooses which cards to build (`runChat` from @mydata/shared: prompt, tools,
 *    validation, one retry). It sees no customer data at this point.
 * 2. The finance engine computes those cards, and the model writes a reply that says what the
 *    figures mean (explain.ts). It sees the cards' results, never the transaction list, and a
 *    reply quoting a number that is not in them is discarded.
 * When step 2 does not produce a usable reply, the answer falls back to a sentence with a
 * {{cardId.value}} placeholder, which the app fills in from the engine.
 */
import {
  applyOps,
  type Block,
  CARD_ONLY_REPLY,
  type ChatModel,
  type ChatOutput,
  createGeminiModel,
  type EngineResult,
  ENGINE_FNS,
  MAX_HISTORY_TURNS,
  MAX_QUESTION_CHARS,
  parseGeminiModels,
  runChat,
  TEMPLATE_IDS,
} from "@mydata/shared";
import { explainFigures } from "./explain";

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const MAX_BLOCKS = 40;
const MAX_TITLE_CHARS = 120;
const MAX_HISTORY_TEXT_CHARS = 4000;
const BLOCK_ID = /^[a-z][a-z0-9-]{0,47}$/;
/** One answer may take two model calls, each with fallbacks; past this the request is abandoned. */
export const CHAT_TIMEOUT_MS = 75_000;

/** Gemini called directly from the server, with the key added here. */
export function createServerGeminiModel(apiKey: string, models?: string, fetchFn: typeof fetch = fetch): ChatModel {
  return createGeminiModel(
    (model, body, signal) =>
      fetchFn(`${GEMINI_URL}/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
        body,
        signal,
      }),
    {
      models: parseGeminiModels(models),
      log: (level, message) => (level === "warn" ? console.warn : console.info)(`[chat] ${message}`),
    },
  );
}

export class ChatRequestError extends Error {}

export interface ChatRequest {
  customerId: string;
  question: string;
  history: { role: "user" | "assistant"; text: string }[];
  blocks: Block[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The dashboard as the browser reports it. Only what the prompt and the validation use is
 * kept (id, title, what the card computes, how it is shown, whether it is pinned); anything
 * malformed is skipped, since a stale saved dashboard should not break the chat.
 */
function readBlocks(value: unknown): Block[] {
  if (!Array.isArray(value)) return [];
  const blocks: Block[] = [];
  for (const item of value.slice(0, MAX_BLOCKS)) {
    if (!isRecord(item) || typeof item.id !== "string" || !BLOCK_ID.test(item.id)) continue;
    if (!isRecord(item.data) || !isRecord(item.view)) continue;
    const { data, view } = item;
    let request: Block["data"];
    if (data.kind === "engine" && typeof data.fn === "string" && (ENGINE_FNS as readonly string[]).includes(data.fn)) {
      request = { kind: "engine", fn: data.fn as (typeof ENGINE_FNS)[number], args: isRecord(data.args) ? data.args : {} };
    } else if (data.kind === "sql") {
      request = { kind: "sql", sql: "" };
    } else continue;
    let shown: Block["view"];
    if (view.kind === "template" && typeof view.template === "string" && (TEMPLATE_IDS as readonly string[]).includes(view.template)) {
      shown = { kind: "template", template: view.template as (typeof TEMPLATE_IDS)[number] };
    } else if (view.kind === "spec") {
      shown = { kind: "spec", spec: {} };
    } else if (view.kind === "code") {
      shown = { kind: "code", code: "" };
    } else continue;
    blocks.push({
      id: item.id,
      title: typeof item.title === "string" ? item.title.slice(0, MAX_TITLE_CHARS) : item.id,
      explanation: "",
      source: "own",
      data: request,
      view: shown,
      ...(item.pinned === true && { pinned: true }),
    });
  }
  return blocks;
}

function readHistory(value: unknown): ChatRequest["history"] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new ChatRequestError("history must be a list of { role, text }");
  return value.slice(-MAX_HISTORY_TURNS).map((turn) => {
    if (!isRecord(turn) || (turn.role !== "user" && turn.role !== "assistant") || typeof turn.text !== "string") {
      throw new ChatRequestError('Each history turn needs a role ("user" or "assistant") and a text');
    }
    return { role: turn.role, text: turn.text.slice(0, MAX_HISTORY_TEXT_CHARS) };
  });
}

/** Checks a chat request body. Throws ChatRequestError with a message that is safe to show. */
export function parseChatRequest(body: unknown): ChatRequest {
  if (!isRecord(body)) throw new ChatRequestError("Body must be a JSON object");
  if (typeof body.customerId !== "string") throw new ChatRequestError("customerId is required");
  if (typeof body.question !== "string" || body.question.trim() === "") {
    throw new ChatRequestError("question must be a non-empty text");
  }
  if (body.question.length > MAX_QUESTION_CHARS) {
    throw new ChatRequestError(`question must be at most ${MAX_QUESTION_CHARS} characters`);
  }
  return {
    customerId: body.customerId,
    question: body.question,
    history: readHistory(body.history),
    blocks: readBlocks(body.blocks),
  };
}

export interface ChatAnswer extends ChatOutput {
  /** True when the reply interprets figures the engine computed; false when it only points at the card. */
  explained: boolean;
}

export interface AnswerOptions {
  /** `today` comes from the server's database, not from the caller. */
  today: string;
  /** Runs a card's data request for this customer; null when it cannot be computed. */
  compute: (block: Block) => EngineResult | null;
  signal?: AbortSignal;
}

/** At most this many new cards are computed and explained per answer. */
const MAX_EXPLAINED_CARDS = 3;

export async function answerChat(model: ChatModel, request: ChatRequest, options: AnswerOptions): Promise<ChatAnswer> {
  const { today, compute, signal } = options;
  // Step 1: which cards. The reply is written in step 2, so a missing one is not asked for here.
  const out = await runChat(
    model,
    { question: request.question, history: request.history, blocks: request.blocks, today, replyFollowUp: false },
    signal,
  );

  const touched = [...new Set(out.ops.flatMap((op) => (op.op === "add_block" ? [op.block.id] : op.op === "update_block" ? [op.id] : [])))];
  if (touched.length === 0) return { ...out, explained: false };
  const after = applyOps({ customerId: request.customerId, blocks: request.blocks }, out.ops).blocks;
  const facts = touched
    .slice(0, MAX_EXPLAINED_CARDS)
    .flatMap((id) => {
      const block = after.find((b) => b.id === id);
      const result = block && compute(block);
      return block && result ? [{ block, result }] : [];
    });

  // Step 2: what the figures mean.
  if (facts.length) {
    try {
      const explanation = await explainFigures(model, { question: request.question, facts, today }, signal);
      if (explanation.text) return { ...out, text: explanation.text, explained: true };
      if (explanation.unbacked.length) console.warn("[chat] reply discarded, numbers not in the figures:", explanation.unbacked);
    } catch (error) {
      if (signal?.aborted) throw error;
      console.warn("[chat] explanation failed:", error instanceof Error ? error.message : error);
    }
  }

  // Fallback: the model's own reply if it gave one, otherwise the card's headline figure as a placeholder.
  if (out.text !== CARD_ONLY_REPLY) return { ...out, explained: false };
  const first = facts[0];
  if (!first) return { ...out, explained: false };
  const field = typeof first.result.value === "number" ? "value" : first.result.caption ? "caption" : null;
  return { ...out, text: field ? `${first.block.title}: {{${first.block.id}.${field}}}.` : out.text, explained: false };
}
