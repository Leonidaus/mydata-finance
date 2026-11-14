/**
 * The chat on the server: the prompt, the model call and the checking of the model's answer
 * all happen here, so the browser only sends the question and gets back a validated reply.
 *
 * The agent itself (prompt, tools, validation, one retry) is `runChat` from @mydata/shared.
 * The model still never sees the customer's figures: it chooses which cards to build, and the
 * app fills the numbers in from the finance engine.
 */
import {
  type Block,
  type ChatModel,
  type ChatOutput,
  createGeminiModel,
  ENGINE_FNS,
  MAX_HISTORY_TURNS,
  MAX_QUESTION_CHARS,
  parseGeminiModels,
  runChat,
  TEMPLATE_IDS,
} from "@mydata/shared";

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

/** One chat answer. `today` comes from the server's database, not from the caller. */
export function answerChat(model: ChatModel, request: ChatRequest, today: string, signal?: AbortSignal): Promise<ChatOutput> {
  return runChat(model, { question: request.question, history: request.history, blocks: request.blocks, today }, signal);
}
