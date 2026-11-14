/**
 * The conversation with the coach, and the small overview of what the user keeps.
 *
 * Each answer carries the cards it showed, as its own copies: a follow-up that changes a card
 * gives the new answer an updated copy, and the earlier answer keeps the figures it described.
 * The overview holds only what is saved: the starting cards, a savings plan (saved as soon as it
 * exists), and whatever the user saves from an answer.
 *
 * The coach still sees one list of cards, as when the app had a dashboard: the cards of recent
 * answers, newest first, followed by the overview. The first card in that list is what "it" and
 * "that" mean in a follow-up.
 */
import type { Block, ChatImage, DashboardOp, Mood, PhotoRead, ProtectedCategory, ReceiptView } from "@mydata/shared";
import { applyDashboardOps } from "./dashboard";

export interface Message {
  id: number;
  role: "user" | "assistant";
  /** What is shown: the coach's reply with its figures filled in. */
  text: string;
  /**
   * What the coach is given as the conversation so far: its own reply before the figures were
   * filled in (figures are never sent back to it), and the question with what a photo showed.
   * Missing on messages that are not part of that conversation, such as an error.
   */
  modelText?: string;
  question?: string;
  blocked?: ProtectedCategory[];
  overrideUsed?: boolean;
  /** Categories this answer asked about taking off the keep-as-is list. */
  proposedUnprotect?: ProtectedCategory[];
  /** A photo sent with the message, as a data URL. Not kept when the conversation is stored. */
  photoUrl?: string;
  /** What the coach read from the photo, once it has answered. */
  photo?: PhotoRead;
  /** The cards this answer showed. */
  cards?: Block[];
  /** The receipt this answer saved, as it is now. */
  receipt?: ReceiptView;
  /** The title of the card the user asked about, when they chose one. */
  about?: string;
  /** How the coach looked and what it offered next. */
  mood?: Mood | null;
  suggestions?: string[];
}

export type Turn = { role: "user" | "assistant"; text: string };

/** What the conversation sends with a question. */
export interface AskInput {
  question: string;
  /** A suggested prompt, answered by the keyword rules without a model call. */
  canned?: boolean;
  allowProtected?: ProtectedCategory[];
  /** A photo sent with the message. The question may then be empty. */
  image?: ChatImage;
  history: Turn[];
  /** The cards of the answers so far, oldest answer first. */
  answers: Block[][];
  /** The card the user chose to ask about. */
  focusId?: string;
  /** What the previous answer asked about taking off the keep-as-is list: this message may be the yes. */
  pendingUnprotect: ProtectedCategory[];
}

export interface AskResult {
  text: string;
  /** The coach's reply before figures were filled in, and the question as it was given. Both missing when nothing was asked. */
  modelText?: string;
  userText?: string;
  cards?: Block[];
  /** Cards the coach removed: they leave earlier answers too. */
  removed?: string[];
  mood?: Mood | null;
  suggestions?: string[];
  blocked?: ProtectedCategory[];
  proposedUnprotect?: ProtectedCategory[];
  photo?: PhotoRead;
  receipt?: ReceiptView;
}

/** How many cards from answers the coach is told about. Older ones stay on screen but out of its view. */
export const MAX_ANSWER_CARDS = 6;

const withPin = (block: Block, pinned: boolean): Block => {
  const { pinned: _was, ...rest } = block;
  return pinned ? { ...rest, pinned: true } : rest;
};

/** A card as it sits in the overview. */
export const savedCard = (block: Block): Block => withPin(block, true);

/** A savings plan is something to come back to, and the coach reads it from the overview: it is saved without a tap. */
export const savesItself = (block: Block): boolean => block.data.kind === "engine" && block.data.fn === "goalPlan";

/** The cards an answer showed, per assistant message, oldest first. */
export const answerCards = (messages: Message[]): Block[][] => messages.flatMap((m) => (m.role === "assistant" && m.cards?.length ? [m.cards] : []));

/** The conversation as the coach is given it. */
export const modelHistory = (messages: Message[], max: number): Turn[] =>
  messages.flatMap((m) => (m.modelText === undefined ? [] : [{ role: m.role, text: m.modelText }])).slice(-max);

/**
 * The cards the coach is told about. First the one the user chose to ask about, then the latest
 * answer's cards, then earlier answers' (newest first), then the overview. Cards from answers are
 * listed unpinned, so the first of them is "the latest answer"; a saved card is listed as saved,
 * unless it is what the conversation is about right now.
 */
export function contextBlocks(overview: Block[], answers: Block[][], focusId?: string): Block[] {
  const saved = new Set(overview.map((b) => b.id));
  const newestFirst = [...answers].reverse();
  const out: Block[] = [];
  const seen = new Set<string>();
  let fromAnswers = 0;
  const add = (block: Block, pinned: boolean) => {
    if (seen.has(block.id)) return;
    seen.add(block.id);
    out.push(withPin(block, pinned));
  };

  const focus = focusId === undefined ? undefined : (newestFirst.flat().find((b) => b.id === focusId) ?? overview.find((b) => b.id === focusId));
  if (focus) add(focus, false);
  newestFirst.forEach((cards, age) => {
    for (const card of cards) {
      if (age > 0 && saved.has(card.id)) continue; // the overview has the current version
      if (seen.has(card.id) || fromAnswers >= MAX_ANSWER_CARDS) continue;
      fromAnswers++;
      add(card, false);
    }
  });
  for (const block of overview) add(block, true);
  return out;
}

export interface AppliedReply {
  /** Every card the coach knows about after its edits; reply placeholders are filled from these. */
  after: Block[];
  /** The cards this answer shows: what it added or changed. */
  cards: Block[];
  /** Ids the coach removed. */
  removed: string[];
  overview: Block[];
}

/**
 * What the coach's card edits mean here. A card it added or changed is shown with the answer.
 * A saved card it changed is changed in the overview too, a card it removed leaves the overview,
 * and a savings plan is saved.
 */
export function applyReply(overview: Block[], context: Block[], ops: DashboardOp[]): AppliedReply {
  const after = applyDashboardOps({ customerId: "", blocks: context }, ops).blocks;
  const byId = new Map(after.map((b) => [b.id, b]));
  const touched = [...new Set(ops.flatMap((op) => (op.op === "add_block" ? [op.block.id] : op.op === "update_block" ? [op.id] : [])))];
  const cards = touched.flatMap((id) => {
    const block = byId.get(id);
    return block ? [withPin(block, false)] : [];
  });
  const removed = [...new Set(ops.flatMap((op) => (op.op === "remove_block" ? [op.id] : [])))];

  const changed = new Map(cards.map((c) => [c.id, c]));
  const next = overview.filter((b) => !removed.includes(b.id)).map((b) => (changed.has(b.id) ? savedCard(changed.get(b.id) as Block) : b));
  for (const card of cards) {
    if (savesItself(card) && !next.some((b) => b.id === card.id)) next.push(savedCard(card));
  }
  return { after, cards, removed, overview: next };
}

export type SavedState = "no" | "saved" | "changed";

const content = (block: Block) => JSON.stringify([block.title, block.data, block.view]);

/** Whether a card is in the overview, and whether the overview has it as it is shown here. */
export function savedState(overview: Block[], block: Block): SavedState {
  const saved = overview.find((b) => b.id === block.id);
  if (!saved) return "no";
  return content(saved) === content(block) ? "saved" : "changed";
}

/** Saves a card to the overview, in place of an earlier version of it. */
export function saveToOverview(overview: Block[], block: Block): Block[] {
  const card = savedCard(block);
  return overview.some((b) => b.id === block.id) ? overview.map((b) => (b.id === block.id ? card : b)) : [...overview, card];
}

/** The conversation without the given cards: a card the coach removed leaves the answers that showed it. */
export function withoutCards(messages: Message[], ids: string[]): Message[] {
  if (!ids.length) return messages;
  return messages.map((m) => (m.cards?.some((c) => ids.includes(c.id)) ? { ...m, cards: m.cards.filter((c) => !ids.includes(c.id)) } : m));
}

/** Changes one card of one answer, e.g. when the user moves its slider. Other answers keep theirs. */
export function patchCard(messages: Message[], messageId: number, cardId: string, patch: Partial<Block>): Message[] {
  return messages.map((m) => (m.id === messageId && m.cards ? { ...m, cards: m.cards.map((c) => (c.id === cardId ? { ...c, ...patch, id: c.id } : c)) } : m));
}

// ---- kept in the browser, per customer ----

/** The newest messages that are kept. A long conversation loses its beginning, not its end. */
export const MAX_STORED_MESSAGES = 60;
const conversationKey = (customerId: string) => `mydata.conversation.v1.${customerId}`;

const isMessage = (value: unknown): value is Message => {
  if (typeof value !== "object" || value === null) return false;
  const m = value as Record<string, unknown>;
  return typeof m.id === "number" && (m.role === "user" || m.role === "assistant") && typeof m.text === "string" && (m.cards === undefined || Array.isArray(m.cards));
};

/** What is stored of a conversation: the newest messages, without the photos (a data URL each). */
export function toStored(messages: Message[]): Message[] {
  return messages.slice(-MAX_STORED_MESSAGES).map(({ photoUrl: _photo, ...kept }) => kept);
}

/** Reads a stored conversation; anything that is not one gives an empty conversation. */
export function fromStored(raw: string | null): Message[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isMessage) : [];
  } catch {
    return [];
  }
}

export function loadConversation(customerId: string): Message[] {
  if (!customerId) return [];
  try {
    return fromStored(localStorage.getItem(conversationKey(customerId)));
  } catch {
    return []; // storage unavailable: the conversation simply starts empty
  }
}

export function saveConversation(customerId: string, messages: Message[]): void {
  if (!customerId) return;
  try {
    if (messages.length) localStorage.setItem(conversationKey(customerId), JSON.stringify(toStored(messages)));
    else localStorage.removeItem(conversationKey(customerId));
  } catch {
    /* storage full or unavailable: the conversation is not remembered */
  }
}
