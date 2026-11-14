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
 *
 * With two models (ChatModels), a fast one answers most turns in a couple of seconds and may
 * hand a turn over to a stronger, slower one: goals and plans, open coaching questions, custom
 * views. The second tries in steps 2 and 3 also go to the stronger model, since the fast one
 * has by then got it wrong once.
 */
import { applyOps, type Block, type DashboardOp } from "../blocks";
import { ENGINE_FNS, type EngineFn, type EngineResult } from "../engine/types";
import { describeResult, numbersIn, questionLanguage, requestLabel, resultNumbers, unbackedNumbers } from "./figures";
import { placeholders } from "./placeholders";
import { buildSystemPrompt } from "./prompt";
import { buildSnapshot, type Figures, type Headline, type Lookup, runLookup } from "./snapshot";
import {
  HAND_OVER_DECLARATION,
  HAND_OVER_TOOL,
  LOOKUP_DECLARATION,
  LOOKUP_TOOL,
  type Mood,
  REPLY_TOOL,
  TOOL_DECLARATIONS,
  type ToolCall,
  type ToolDeclaration,
} from "./tools";
import { type CardPick, parseToolCalls } from "./validate";
import type { CoachingProfile, ProtectedCategory } from "../profile";

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

/** A fast model for most turns and, optionally, a stronger one for the turns that gain from it. */
export interface ChatModels {
  fast: ChatModel;
  strong?: ChatModel;
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
  profile?: CoachingProfile;
  allowProtected?: readonly ProtectedCategory[];
  language?: "en" | "fi";
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
  /** Which model wrote the answer: "strong" when the fast one handed the turn over. */
  answeredBy: "fast" | "strong";
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
const answerCalls = (res: ChatModelResponse) => res.calls.filter((c) => c.name !== LOOKUP_TOOL && c.name !== HAND_OVER_TOOL);

/** The engine functions and library cards for planning towards a goal. A turn that uses them is one for the stronger model. */
const PLANNING_FNS: readonly string[] = ["goalPlan", "savingsOptions", "goalReview"];
const PLANNING_COMPONENTS: readonly string[] = ["goal_plan", "saving_options", "goal_review"];

/**
 * Whether the fast model's answer is a planning turn it should have handed over: it asked to
 * hand over, or it reached for a planning function, a planning card, or a plan on the dashboard.
 */
function isForStrongModel(calls: ToolCall[], blocks: Block[]): boolean {
  return calls.some((call) => {
    if (call.name === HAND_OVER_TOOL) return true;
    const { fn, component, id } = call.args;
    if (typeof fn === "string" && PLANNING_FNS.includes(fn)) return true;
    if (typeof component === "string" && PLANNING_COMPONENTS.includes(component)) return true;
    if (call.name !== "update_block" || typeof id !== "string") return false;
    const block = blocks.find((b) => b.id === id);
    return block?.data.kind === "engine" && PLANNING_FNS.includes(block.data.fn);
  });
}

/** One turn of this answer, with the model that wrote it (none for the user's turns). */
interface Said {
  turn: ChatTurn;
  by?: ChatModel;
}

/** What a model answered, as a turn: its own message for replaying to itself, and the same as text. */
const modelTurn = (res: ChatModelResponse, by: ChatModel): Said => ({
  turn: { role: "model", raw: res.raw, text: res.text?.trim() || `Tool calls: ${JSON.stringify(res.calls).slice(0, 4000)}` },
  by,
});
const userTurn = (text: string): Said => ({ turn: { role: "user", text } });

/**
 * The conversation as `model` should see it. A provider's own message is only replayed to the
 * model that wrote it; another model gets the same turn as text.
 */
const turnsFor = (said: Said[], model: ChatModel): ChatTurn[] =>
  said.map(({ turn, by }) => (by && by !== model ? { role: turn.role, text: turn.text } : turn));

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

/**
 * The placeholders in a reply that the app could not fill: a card that does not exist, or one
 * whose result has no headline figure (a comparison, a list) or no caption. Without a lookup
 * the figures are not known here and nothing is reported.
 */
async function unfillable(text: string, lookup: Lookup | undefined, blocks: Block[], cards: BuiltCard[]): Promise<string[]> {
  if (!lookup) return [];
  const bad: string[] = [];
  for (const { id, field } of placeholders(text)) {
    const block = blocks.find((b) => b.id === id);
    let result = cards.find((c) => c.block.id === id)?.result;
    if (!result && block?.data.kind === "engine") {
      try {
        result = await lookup(block.data.fn, block.data.args);
      } catch {
        result = undefined;
      }
    }
    const filled = result && (field === "value" ? typeof result.value === "number" : Boolean(result.caption));
    if (!filled) bad.push(`{{${id}.${field}}}`);
  }
  return [...new Set(bad)];
}

/**
 * Figures a reply took from the snapshot although the card it comes with now says otherwise.
 * When an answer builds a card for a function the snapshot also has, with other arguments
 * ("1 000 € of this account is savings"), the snapshot's headline is the figure from before the
 * change. Quoting it without the card's own headline tells the user the wrong number, even
 * though the number itself is one the coach was shown.
 */
function staleFigures(text: string, cards: BuiltCard[], headlines: Headline[]): { said: number; card: number }[] {
  const said = numbersIn(text);
  const mentions = (value: number) => said.some((n) => Math.abs(n - value) < 0.006 || n === Math.round(value));
  const stale: { said: number; card: number }[] = [];
  for (const { block, result } of cards) {
    if (block.data.kind !== "engine" || typeof result.value !== "number") continue;
    const { fn, args } = block.data;
    const now = result.value;
    if (mentions(now)) continue;
    for (const before of headlines) {
      if (before.fn !== fn || requestLabel(fn, before.args) === requestLabel(fn, args)) continue;
      const different = Math.round(before.value) !== Math.round(now);
      if (different && mentions(before.value) && !stale.some((f) => f.said === before.value)) stale.push({ said: before.value, card: now });
    }
  }
  return stale;
}

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

export async function runChat(models: ChatModel | ChatModels, input: ChatInput, signal?: AbortSignal): Promise<ChatOutput> {
  const { fast, strong } = "generate" in models ? { fast: models, strong: undefined } : models;
  const question = input.question.trim().slice(0, MAX_QUESTION_CHARS);
  const history = input.history.slice(-MAX_HISTORY_TURNS);
  const said: Said[] = [
    ...history.map((t): Said => ({ turn: { role: t.role === "assistant" ? "model" : "user", text: t.text } })),
    userTurn(question),
  ];
  const { lookup } = input;
  const snapshot = lookup ? await buildSnapshot(lookup, input.blocks) : null;
  const system = buildSystemPrompt(input.blocks, input.today, {
    snapshot: snapshot?.text,
    profile: input.profile,
    allowProtected: input.allowProtected,
    language: input.language,
  });
  // Every number the reply may quote: what the coach was shown, and what was said in the conversation.
  const backed = [...(snapshot?.numbers ?? []), ...numbersIn(question), ...history.flatMap((t) => numbersIn(t.text)), ...numbersIn(input.today)];

  // 1. The answer, after at most MAX_LOOKUP_ROUNDS rounds of looking figures up. The fast model
  // starts, and may hand the turn over to the stronger one once.
  let active = fast;
  let handedOver = false;
  let strongFailed = false;
  let res: ChatModelResponse;
  for (let rounds = 0; ; ) {
    const mayLookUp = lookup !== undefined && rounds < MAX_LOOKUP_ROUNDS;
    const mayHandOver = strong !== undefined && !handedOver;
    const tools = [...(mayHandOver ? [HAND_OVER_DECLARATION] : []), ...(mayLookUp ? [LOOKUP_DECLARATION] : []), ...TOOL_DECLARATIONS];
    try {
      res = await active.generate({ system, turns: turnsFor(said, active), tools }, signal);
    } catch (e) {
      // The stronger model failing must not cost the answer: the fast one answers after all.
      if (active === fast || signal?.aborted) throw e;
      active = fast;
      strongFailed = true;
      continue;
    }
    // The fast model's answer is dropped: the stronger one starts from the same conversation.
    if (mayHandOver && strong && isForStrongModel(res.calls, input.blocks)) {
      active = strong;
      handedOver = true;
      continue;
    }
    const lookups = res.calls.filter((c) => c.name === LOOKUP_TOOL);
    if (!mayLookUp || lookups.length === 0) break;
    const found = await lookUp(lookup, lookups);
    backed.push(...found.numbers);
    rounds++;
    said.push(
      modelTurn(res, active),
      userTurn(`LOOKED UP\n${found.text}\n\n${rounds === MAX_LOOKUP_ROUNDS ? "Now answer the user." : "Now answer the user, or look up what is still missing."}`),
    );
  }
  const answeredBy = active === fast ? "fast" : "strong";
  let parsed = parseToolCalls(answerCalls(res), input.blocks);
  // Second tries go to the stronger model when there is one that works.
  const fixer = strong && !strongFailed ? strong : active;
  let resBy = active;

  // 2. Something was rejected, or there is neither a card nor a reply: ask for the whole answer again.
  if (parsed.errors.length || (parsed.text === null && parsed.ops.length === 0)) {
    const problems = [...parsed.errors, ...(parsed.text === null ? ["reply: missing. Every answer needs a reply."] : [])];
    said.push(
      modelTurn(res, resBy),
      userTurn(`Some tool calls were rejected:\n- ${problems.join("\n- ")}\nSend the whole answer again with corrected tool calls (all cards and the reply).`),
    );
    const retry = await repair(() => fixer.generate({ system, turns: turnsFor(said, fixer), tools: TOOL_DECLARATIONS }, signal), signal);
    const reparsed = retry && parseToolCalls(answerCalls(retry), input.blocks);
    // Keep the retry only if it is at least as useful as the first try.
    if (retry && reparsed && (reparsed.ops.length >= parsed.ops.length || reparsed.text !== null)) {
      res = retry;
      resBy = fixer;
      parsed = {
        ...reparsed,
        text: reparsed.text ?? parsed.text,
        mood: reparsed.mood ?? parsed.mood,
        suggestions: reparsed.suggestions.length ? reparsed.suggestions : parsed.suggestions,
      };
    }
  }

  // 3. The reply must be there, quote only numbers the coach was shown, and use only placeholders the app can fill.
  const after = applyOps({ customerId: "", blocks: input.blocks }, parsed.ops).blocks;
  const cards = await builtCards(lookup, input.blocks, parsed.ops);
  const faultsIn = async (text: string) => ({
    unbacked: unbackedNumbers(text, backed),
    empty: await unfillable(text, lookup, after, cards),
    stale: staleFigures(text, cards, snapshot?.headlines ?? []),
  });
  const sound = (f: Awaited<ReturnType<typeof faultsIn>>) => f.unbacked.length === 0 && f.empty.length === 0 && f.stale.length === 0;
  let faults = parsed.text === null ? null : await faultsIn(parsed.text);
  let checked = faults !== null && sound(faults);
  if (!checked) {
    // Ask for the reply alone, with only the reply tool on offer: the cards stay as they are.
    // The coach now gets the figures of the cards it built, which it had not seen.
    backed.push(...cards.flatMap((c) => resultNumbers(c.result)));
    const figures = cards.map((c) => describeResult(cardHeading(c), c.result)).join("\n\n");
    const problem =
      faults === null
        ? "Your answer had no reply."
        : [
            faults.unbacked.length ? `Your reply quoted numbers that are not in your figures: ${faults.unbacked.join(", ")}.` : "",
            faults.empty.length ? `Your reply used ${faults.empty.join(", ")}, which the app cannot fill in: that card has no such figure. Say the figures themselves.` : "",
            faults.stale.length ? `Your reply says ${faults.stale.map((f) => f.said).join(", ")}, the figure from before this change. The card you built shows ${faults.stale.map((f) => f.card).join(", ")}: answer with the card's figures.` : "",
          ]
            .filter(Boolean)
            .join(" ");
    const replyRequest: ChatModelRequest = {
      system,
      turns: turnsFor(
        [
          ...said,
          modelTurn(res, resBy),
          userTurn(
            `${problem} ${parsed.ops.length ? "The cards are in place. " : ""}Call reply once: answer the user's question in their language.` +
              (figures ? `\n\nCARD FIGURES\n${figures}\n\n` : " ") +
              "Use only numbers from SNAPSHOT, LOOKED UP and CARD FIGURES, as given or rounded to whole euros. Do not calculate; " +
              "say it in words when the figure you want is not there.",
          ),
        ],
        fixer,
      ),
      tools: TOOL_DECLARATIONS.filter((t) => t.name === REPLY_TOOL),
    };
    const followUp = await repair(() => fixer.generate(replyRequest, signal), signal);
    const reply = followUp && parseToolCalls(followUp.calls.filter((c) => c.name === REPLY_TOOL), []);
    if (reply && reply.text !== null) {
      faults = await faultsIn(reply.text);
      if (sound(faults)) {
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

  const replyFaults =
    checked || faults === null
      ? []
      : [
          ...(faults.unbacked.length ? [`reply: numbers not in the figures: ${faults.unbacked.join(", ")}`] : []),
          ...(faults.empty.length ? [`reply: placeholders that cannot be filled: ${faults.empty.join(", ")}`] : []),
          ...(faults.stale.length ? [`reply: figures from before the change: ${faults.stale.map((f) => f.said).join(", ")}`] : []),
        ];
  return {
    text: checked && parsed.text !== null ? parsed.text : standardReply(question, cards, parsed.ops.length > 0),
    ops: parsed.ops,
    rejected: [...parsed.errors, ...replyFaults],
    picks: parsed.picks,
    mood: checked ? parsed.mood : null,
    suggestions: parsed.suggestions,
    checked,
    answeredBy,
  };
}
