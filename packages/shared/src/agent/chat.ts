/**
 * One chat answer from the coach. Provider-neutral: a ChatModel (Gemini today) turns a
 * request into tool calls.
 *
 * The coach gets a snapshot of the customer's figures (results of the finance engine: totals
 * and rows, never the transaction list) and answers in words, with a card when a picture
 * helps. Usually that is one model call. The steps around it:
 * 1. Look up: the coach may first ask for figures it lacks (another period, one category).
 * 2. Validate: rejected tool calls are sent back once, for the whole answer again.
 * 3. Check the reply: every number in it must be one the coach was shown. If not, or if the
 *    reply is missing, it is asked for the reply alone, now with the figures of the cards it
 *    built. A reply that still fails is replaced by a standard sentence.
 */
import { applyOps, type Block, type DashboardOp } from "../blocks";
import { ENGINE_FNS, type EngineFn, type EngineResult } from "../engine/types";
import { describeResult, numbersIn, questionLanguage, requestLabel, resultNumbers, unbackedNumbers } from "./figures";
import { buildSystemPrompt } from "./prompt";
import { buildSnapshot, type Figures, type Lookup, runLookup } from "./snapshot";
import { LOOKUP_DECLARATION, LOOKUP_TOOL, type Mood, REPLY_TOOL, TOOL_DECLARATIONS, type ToolCall, type ToolDeclaration } from "./tools";
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
  /** Earlier turns, as the user saw them or with placeholders still in the assistant's text. */
  history: { role: "user" | "assistant"; text: string }[];
  blocks: Block[];
  today: string;
  /**
   * Runs engine functions for the customer who is asking. With it the coach gets a snapshot of
   * the figures and may look up more. Without it the coach sees no figures and can only refer
   * to a card's headline figure with a placeholder.
   */
  lookup?: Lookup;
}

export interface ChatOutput {
  /** The reply. May contain {{id.value}} placeholders for the app to fill. */
  text: string;
  ops: DashboardOp[];
  /** Calls that were still invalid after the retry, for debugging. */
  rejected: string[];
  /** Whether each added card came from the library or was built custom. */
  picks: CardPick[];
  /** The coach's face for this answer, when it chose one. */
  mood: Mood | null;
  /** Up to three next steps the coach offers, written as the user would say them. */
  suggestions: string[];
  /**
   * True when the reply is the coach's own and every number in it is one it was shown.
   * False when a standard sentence stands in for a reply that was missing or failed the check.
   */
  checked: boolean;
}

/** The reply used when the model built a card but said nothing, and the card's figures are not known here. */
export const CARD_ONLY_REPLY = "Here is a card for that.";

export const MAX_QUESTION_CHARS = 1000;
export const MAX_HISTORY_TURNS = 10;
/** How many times the coach may ask for more figures before it has to answer. */
export const MAX_LOOKUP_ROUNDS = 2;
const MAX_LOOKUPS_PER_ROUND = 4;
/** At most this many of the cards an answer built have their figures given back for the reply. */
const MAX_CARD_FIGURES = 3;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const answerCalls = (res: ChatModelResponse) => res.calls.filter((c) => c.name !== LOOKUP_TOOL);

/** Runs the lookups of one model turn. A call that makes no sense comes back as a message for the model. */
async function lookUp(lookup: Lookup, calls: ToolCall[]): Promise<Figures> {
  const found = await Promise.all(
    calls.slice(0, MAX_LOOKUPS_PER_ROUND).map(async (call): Promise<Figures> => {
      const { fn, args } = call.args;
      if (typeof fn !== "string" || !(ENGINE_FNS as readonly string[]).includes(fn)) {
        return { text: `lookup: fn must be one of ${ENGINE_FNS.join(", ")}.`, numbers: [] };
      }
      return runLookup(lookup, fn as EngineFn, isRecord(args) ? args : {});
    }),
  );
  return { text: found.map((f) => f.text).join("\n\n"), numbers: found.flatMap((f) => f.numbers) };
}

interface BuiltCard {
  block: Block;
  result: EngineResult;
}

/** The cards an answer added or changed, with what the engine computes for them. */
async function builtCards(lookup: Lookup | undefined, current: Block[], ops: DashboardOp[]): Promise<BuiltCard[]> {
  if (!lookup) return [];
  const touched = [...new Set(ops.flatMap((op) => (op.op === "add_block" ? [op.block.id] : op.op === "update_block" ? [op.id] : [])))];
  const after = applyOps({ customerId: "", blocks: current }, ops).blocks;
  const cards = await Promise.all(
    touched.slice(0, MAX_CARD_FIGURES).map(async (id): Promise<BuiltCard | null> => {
      const block = after.find((b) => b.id === id);
      if (!block || block.data.kind !== "engine") return null;
      try {
        return { block, result: await lookup(block.data.fn, block.data.args) };
      } catch {
        return null; // a card that cannot be computed is left out; the app shows its error on the card
      }
    }),
  );
  return cards.filter((c) => c !== null);
}

const cardHeading = ({ block }: BuiltCard) =>
  `Card ${block.id}: "${block.title}" = ${block.data.kind === "engine" ? requestLabel(block.data.fn, block.data.args) : "query"}`;

/** What stands in for a reply that was missing or failed the number check. */
function standardReply(question: string, cards: BuiltCard[], hasOps: boolean): string {
  const finnish = questionLanguage(question) === "fi";
  const first = cards[0];
  if (first) {
    const field = typeof first.result.value === "number" ? "value" : first.result.caption ? "caption" : null;
    if (field) return `${first.block.title}: {{${first.block.id}.${field}}}.`;
  }
  if (hasOps) return finnish ? "Tein siitä kortin." : CARD_ONLY_REPLY;
  return finnish
    ? "En saanut tähän vastausta, jonka luvut voisin varmistaa. Kokeile kysyä toisin."
    : "I couldn't answer that with figures I can stand behind. Try asking in another way.";
}

/**
 * A second try at an answer the coach already gave. If the model fails here, what it gave the
 * first time is still worth returning, so the failure is not passed on (a cancelled request is).
 */
async function repair(call: () => Promise<ChatModelResponse>, signal?: AbortSignal): Promise<ChatModelResponse | null> {
  try {
    return await call();
  } catch (e) {
    if (signal?.aborted) throw e;
    return null;
  }
}

export async function runChat(model: ChatModel, input: ChatInput, signal?: AbortSignal): Promise<ChatOutput> {
  const question = input.question.trim().slice(0, MAX_QUESTION_CHARS);
  const history = input.history.slice(-MAX_HISTORY_TURNS);
  const turns: ChatTurn[] = [
    ...history.map((t): ChatTurn => ({ role: t.role === "assistant" ? "model" : "user", text: t.text })),
    { role: "user", text: question },
  ];
  const { lookup } = input;
  const snapshot = lookup ? await buildSnapshot(lookup) : null;
  const system = buildSystemPrompt(input.blocks, input.today, { snapshot: snapshot?.text });
  // Every number the reply may quote: what the coach was shown, and what was said in the conversation.
  const backed = [...(snapshot?.numbers ?? []), ...numbersIn(question), ...history.flatMap((t) => numbersIn(t.text))];

  // 1. The answer, after at most MAX_LOOKUP_ROUNDS rounds of looking figures up.
  let res: ChatModelResponse;
  for (let round = 0; ; round++) {
    const mayLookUp = lookup !== undefined && round < MAX_LOOKUP_ROUNDS;
    res = await model.generate({ system, turns, tools: mayLookUp ? [LOOKUP_DECLARATION, ...TOOL_DECLARATIONS] : TOOL_DECLARATIONS }, signal);
    const lookups = res.calls.filter((c) => c.name === LOOKUP_TOOL);
    if (!mayLookUp || lookups.length === 0) break;
    const found = await lookUp(lookup, lookups);
    backed.push(...found.numbers);
    const last = round + 1 === MAX_LOOKUP_ROUNDS;
    turns.push(
      { role: "model", raw: res.raw, text: res.text },
      { role: "user", text: `LOOKED UP\n${found.text}\n\n${last ? "Now answer the user." : "Now answer the user, or look up what is still missing."}` },
    );
  }
  let parsed = parseToolCalls(answerCalls(res), input.blocks);

  // 2. Something was rejected, or there is neither a card nor a reply: ask for the whole answer again.
  if (parsed.errors.length || (parsed.text === null && parsed.ops.length === 0)) {
    const problems = [...parsed.errors, ...(parsed.text === null ? ["reply: missing. Every answer needs a reply."] : [])];
    turns.push(
      { role: "model", raw: res.raw, text: res.text },
      {
        role: "user",
        text: `Some tool calls were rejected:\n- ${problems.join("\n- ")}\nSend the whole answer again with corrected tool calls (all cards and the reply).`,
      },
    );
    const retry = await repair(() => model.generate({ system, turns, tools: TOOL_DECLARATIONS }, signal), signal);
    const reparsed = retry && parseToolCalls(answerCalls(retry), input.blocks);
    // Keep the retry only if it is at least as useful as the first try.
    if (retry && reparsed && (reparsed.ops.length >= parsed.ops.length || reparsed.text !== null)) {
      res = retry;
      parsed = {
        ...reparsed,
        text: reparsed.text ?? parsed.text,
        mood: reparsed.mood ?? parsed.mood,
        suggestions: reparsed.suggestions.length ? reparsed.suggestions : parsed.suggestions,
      };
    }
  }

  // 3. The reply must be there, and quote only numbers the coach was shown.
  let unbacked = parsed.text === null ? [] : unbackedNumbers(parsed.text, backed);
  let checked = parsed.text !== null && unbacked.length === 0;
  let cards: BuiltCard[] = [];
  if (!checked) {
    // Ask for the reply alone, with only the reply tool on offer: the cards stay as they are.
    // The coach now gets the figures of the cards it built, which it had not seen.
    cards = await builtCards(lookup, input.blocks, parsed.ops);
    backed.push(...cards.flatMap((c) => resultNumbers(c.result)));
    const figures = cards.map((c) => describeResult(cardHeading(c), c.result)).join("\n\n");
    const problem =
      parsed.text === null
        ? "Your answer had no reply."
        : `Your reply quoted numbers that are not in your figures: ${unbacked.join(", ")}.`;
    const replyRequest: ChatModelRequest = {
      system,
      turns: [
        ...turns,
        { role: "model", raw: res.raw, text: res.text },
        {
          role: "user",
          text:
            `${problem} ${parsed.ops.length ? "The cards are in place. " : ""}Call reply once: answer the user's question in their language.` +
            (figures ? `\n\nCARD FIGURES\n${figures}\n\n` : " ") +
            "Use only numbers from SNAPSHOT, LOOKED UP and CARD FIGURES, as given or rounded to whole euros. Do not calculate; " +
            "say it in words when the figure you want is not there.",
        },
      ],
      tools: TOOL_DECLARATIONS.filter((t) => t.name === REPLY_TOOL),
    };
    const followUp = await repair(() => model.generate(replyRequest, signal), signal);
    const reply = followUp && parseToolCalls(followUp.calls.filter((c) => c.name === REPLY_TOOL), []);
    if (reply && reply.text !== null) {
      unbacked = unbackedNumbers(reply.text, backed);
      if (unbacked.length === 0) {
        checked = true;
        parsed = {
          ...parsed,
          text: reply.text,
          mood: reply.mood ?? parsed.mood,
          suggestions: reply.suggestions.length ? reply.suggestions : parsed.suggestions,
        };
      }
    }
  }

  return {
    text: checked && parsed.text !== null ? parsed.text : standardReply(question, cards, parsed.ops.length > 0),
    ops: parsed.ops,
    rejected: [...parsed.errors, ...(checked || unbacked.length === 0 ? [] : [`reply: numbers not in the figures: ${unbacked.join(", ")}`])],
    picks: parsed.picks,
    mood: checked ? parsed.mood : null,
    suggestions: parsed.suggestions,
    checked,
  };
}
