/**
 * The chat on the server: the prompt, the model call and the checking of the model's answer
 * all happen here, so the browser only sends the question and gets back a validated reply.
 *
 * The conversation itself is `runChat` in @mydata/shared. This module gives it what only the
 * server has: the model with its key, and the finance engine for the customer who is asking.
 * The coach sees results of the engine (totals and rows), never the transaction list, and a
 * reply quoting a number that is not in those results is not passed on.
 */
import {
  type Block,
  type ChatImage,
  type ChatModel,
  type ChatModels,
  type ChatOutput,
  createGeminiModel,
  DEFAULT_STRONG_GEMINI_MODELS,
  ENGINE_FNS,
  IMAGE_MIME_TYPES,
  isChatImage,
  type Lookup,
  type PreferenceAccess,
  MAX_IMAGE_BASE64_CHARS,
  MAX_HISTORY_TURNS,
  MAX_QUESTION_CHARS,
  type CoachingProfile,
  type ProtectedCategory,
  ProfileError,
  parseCategoryList,
  parseGeminiModels,
  runChat,
  TEMPLATE_IDS,
} from "@mydata/shared";

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const MAX_BLOCKS = 40;
const MAX_TITLE_CHARS = 120;
const MAX_HISTORY_TEXT_CHARS = 4000;
const BLOCK_ID = /^[a-z][a-z0-9-]{0,47}$/;
/** One answer is usually one model call (two when the turn is handed over) and at most six, each with fallbacks; past this the request is abandoned. */
export const CHAT_TIMEOUT_MS = 75_000;

/** Gemini called directly from the server, with the key added here. `defaults` is the model list used when `models` is empty. */
export function createServerGeminiModel(apiKey: string, models?: string, fetchFn: typeof fetch = fetch, defaults?: string[]): ChatModel {
  return createGeminiModel(
    (model, body, signal) =>
      fetchFn(`${GEMINI_URL}/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
        body,
        signal,
      }),
    {
      models: parseGeminiModels(models, defaults),
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
  allowProtected?: ProtectedCategory[];
  /** Categories the previous answer asked the user about taking off the keep-as-is list. */
  pendingUnprotect?: ProtectedCategory[];
  /** A photo sent with the message. With a photo the question may be empty: "can I afford this?" is then meant. */
  image?: ChatImage;
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
  if (body.image !== undefined && !isChatImage(body.image)) {
    throw new ChatRequestError(`image must be { mimeType, data }: a ${IMAGE_MIME_TYPES.join(", ")} picture as base64, at most ${MAX_IMAGE_BASE64_CHARS / 1_000_000} million characters`);
  }
  // A photo may be sent without words.
  if (typeof body.question !== "string" || (body.question.trim() === "" && body.image === undefined)) {
    throw new ChatRequestError("question must be a non-empty text");
  }
  if (body.question.length > MAX_QUESTION_CHARS) {
    throw new ChatRequestError(`question must be at most ${MAX_QUESTION_CHARS} characters`);
  }
  try {
    return {
      ...(body.image !== undefined && { image: { mimeType: body.image.mimeType, data: body.image.data } }),
      customerId: body.customerId,
      question: body.question,
      history: readHistory(body.history),
      blocks: readBlocks(body.blocks),
      ...(body.allowProtected !== undefined && { allowProtected: parseCategoryList(body.allowProtected, "allowProtected") }),
      ...(body.pendingUnprotect !== undefined && { pendingUnprotect: parseCategoryList(body.pendingUnprotect, "pendingUnprotect") }),
    };
  } catch (error) {
    if (error instanceof ProfileError) throw new ChatRequestError(error.message);
    throw error;
  }
}

export type ChatAnswer = ChatOutput & { blocked: ProtectedCategory[] };

export interface AnswerOptions {
  /** `today` comes from the server's database, not from the caller. */
  today: string;
  /** Runs an engine function for the customer who is asking. Throws when it cannot be computed. */
  lookup: Lookup;
  profile?: CoachingProfile;
  allowProtected?: readonly ProtectedCategory[];
  /** Lets the coach change the saved preferences when the user asks for it in the chat. */
  preferences?: PreferenceAccess;
  signal?: AbortSignal;
}

/**
 * The models from the environment: GEMINI_MODEL answers, and GEMINI_STRONG_MODEL takes the turns it hands
 * over. Both may list several models. GEMINI_STRONG_MODEL=off runs the fast model alone.
 */
export function createServerChatModels(apiKey: string, env: { GEMINI_MODEL?: string; GEMINI_STRONG_MODEL?: string }, fetchFn: typeof fetch = fetch): ChatModels {
  const strongOff = env.GEMINI_STRONG_MODEL?.trim().toLowerCase() === "off";
  return {
    fast: createServerGeminiModel(apiKey, env.GEMINI_MODEL, fetchFn),
    strong: strongOff ? undefined : createServerGeminiModel(apiKey, env.GEMINI_STRONG_MODEL, fetchFn, DEFAULT_STRONG_GEMINI_MODELS),
  };
}

export async function answerChat(model: ChatModel | ChatModels, request: ChatRequest, options: AnswerOptions): Promise<ChatAnswer> {
  const answer = await runChat(
    model,
    {
      question: request.question,
      history: request.history,
      blocks: request.blocks,
      today: options.today,
      lookup: options.lookup,
      profile: options.profile,
      allowProtected: options.allowProtected,
      preferences: options.preferences,
      image: request.image,
    },
    options.signal,
  );
  if (answer.rejected.length) console.warn("[chat] rejected:", answer.rejected);
  return { ...answer, blocked: [] };
}
