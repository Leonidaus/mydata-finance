import { describe, expect, it } from "vitest";
import { type Block, catalog, custom, type DashboardOp, defaultDashboard } from "@mydata/shared";
import {
  answerCards,
  applyReply,
  contextBlocks,
  fromStored,
  MAX_ANSWER_CARDS,
  MAX_STORED_MESSAGES,
  type Message,
  modelHistory,
  patchCard,
  savedCard,
  savedState,
  saveToOverview,
  toStored,
  withoutCards,
} from "./conversation";

const card = (id: string, extra: Partial<Block> = {}): Block => ({
  id, title: id, explanation: "", source: "own",
  data: { kind: "engine", fn: "spendBy", args: { period: "last_month" } },
  view: { kind: "template", template: "category_bars" },
  ...extra,
});
const ids = (blocks: Block[]) => blocks.map((b) => b.id);
const overview = defaultDashboard().map((b, i) => ({ ...b, id: i === 0 ? "safe" : "month" }));

describe("the cards the coach is told about", () => {
  it("lists the latest answer's card first and unpinned, then earlier answers, then the overview as saved", () => {
    const context = contextBlocks(overview, [[card("taxis")], [card("bills")]]);
    expect(ids(context)).toEqual(["bills", "taxis", "safe", "month"]);
    expect(context.map((b) => b.pinned === true)).toEqual([false, false, true, true]);
  });

  it("puts the card the user chose to ask about first, also when it is a saved one", () => {
    expect(ids(contextBlocks(overview, [[card("taxis")], [card("bills")]], "taxis"))).toEqual(["taxis", "bills", "safe", "month"]);
    const aboutSaved = contextBlocks(overview, [[card("taxis")]], "month");
    expect(ids(aboutSaved)).toEqual(["month", "taxis", "safe"]);
    expect(aboutSaved[0].pinned).toBeUndefined();
  });

  it("lets the latest answer's copy of a saved card be what a follow-up means by it", () => {
    const shown = { ...overview[0], data: { kind: "engine" as const, fn: "safeToSpend" as const, args: { horizon: "until_payday" } } };
    const context = contextBlocks(overview, [[shown]]);
    expect(ids(context)).toEqual(["safe", "month"]);
    expect(context[0].pinned).toBeUndefined();
    expect(context[0].data).toEqual(shown.data);
  });

  it("uses the overview's version of a saved card that an earlier answer showed", () => {
    const old = { ...overview[0], title: "As it was" };
    const context = contextBlocks(overview, [[old], [card("taxis")]]);
    expect(ids(context)).toEqual(["taxis", "safe", "month"]);
    expect(context[1].title).toBe(overview[0].title);
    expect(context[1].pinned).toBe(true);
  });

  it("uses the newest copy of a card that several answers showed, and tells the coach about a limited number", () => {
    const context = contextBlocks([], [[card("taxis", { title: "first" })], [card("taxis", { title: "second" })]]);
    expect(context.map((b) => b.title)).toEqual(["second"]);
    const many = Array.from({ length: MAX_ANSWER_CARDS + 3 }, (_, i) => [card(`c${i}`)]);
    expect(contextBlocks(overview, many)).toHaveLength(MAX_ANSWER_CARDS + overview.length);
  });
});

describe("what the coach's card edits do", () => {
  const add = (block: Block): DashboardOp => ({ op: "add_block", block, index: 0 });

  it("shows a new card with the answer and leaves the overview alone", () => {
    const applied = applyReply(overview, contextBlocks(overview, []), [add(card("taxis"))]);
    expect(ids(applied.cards)).toEqual(["taxis"]);
    expect(applied.overview).toEqual(overview);
    expect(ids(applied.after)).toContain("taxis");
  });

  it("gives a follow-up its own updated copy, so that the earlier answer keeps its figures", () => {
    const first = card("taxis");
    const context = contextBlocks(overview, [[first]]);
    const applied = applyReply(overview, context, [{ op: "update_block", id: "taxis", patch: { data: { kind: "engine", fn: "spendBy", args: { period: "last_3_months" } } } }]);
    expect(applied.cards).toHaveLength(1);
    expect(applied.cards[0].data).toEqual({ kind: "engine", fn: "spendBy", args: { period: "last_3_months" } });
    expect(first.data).toEqual({ kind: "engine", fn: "spendBy", args: { period: "last_month" } });
  });

  it("changes a saved card in the overview too, and shows it with the answer", () => {
    const patch = { data: { kind: "engine" as const, fn: "safeToSpend" as const, args: { horizon: "week", reserve: 2000 } } };
    const applied = applyReply(overview, contextBlocks(overview, []), [{ op: "update_block", id: "safe", patch }]);
    expect(applied.overview[0].data).toEqual(patch.data);
    expect(applied.overview[0].pinned).toBe(true);
    expect(applied.overview[1]).toEqual(overview[1]);
    expect(ids(applied.cards)).toEqual(["safe"]);
    expect(applied.cards[0].pinned).toBeUndefined();
  });

  it("saves a savings plan without a tap, and keeps one copy when the plan changes", () => {
    const plan = { ...custom.goalPlan({ target: 20000, saved: 5000 }), id: "plan" };
    const made = applyReply(overview, contextBlocks(overview, []), [add(plan)]);
    expect(ids(made.overview)).toEqual(["safe", "month", "plan"]);
    expect(made.overview[2].pinned).toBe(true);
    expect(ids(made.cards)).toEqual(["plan"]);

    const data = { kind: "engine" as const, fn: "goalPlan" as const, args: { target: 20000, saved: 5000, monthly: 400 } };
    const changed = applyReply(made.overview, contextBlocks(made.overview, [made.cards]), [{ op: "update_block", id: "plan", patch: { data } }]);
    expect(ids(changed.overview)).toEqual(["safe", "month", "plan"]);
    expect(changed.overview[2].data).toEqual(data);
  });

  it("does not save other cards the library marks as ones to keep", () => {
    const review = { ...custom.goalReview({ target: 20000 }), id: "review" };
    expect(ids(applyReply(overview, contextBlocks(overview, []), [add(review)]).overview)).toEqual(["safe", "month"]);
  });

  it("takes a removed card out of the overview and reports it, so that answers can drop it", () => {
    const applied = applyReply(overview, contextBlocks(overview, [[card("taxis")]]), [{ op: "remove_block", id: "month" }, { op: "remove_block", id: "taxis" }]);
    expect(ids(applied.overview)).toEqual(["safe"]);
    expect(applied.removed).toEqual(["month", "taxis"]);
    expect(applied.cards).toEqual([]);
  });

  it("answers the keyword coach's update-and-move of a saved card with that card", () => {
    const { id: _id, ...patch } = catalog.safeToSpend("until_payday");
    const applied = applyReply(overview, contextBlocks(overview, []), [
      { op: "update_block", id: "safe", patch },
      { op: "move_block", id: "safe", index: 0 },
    ]);
    expect(ids(applied.cards)).toEqual(["safe"]);
    expect(ids(applied.overview)).toEqual(["safe", "month"]);
  });
});

describe("saving from an answer", () => {
  it("tells a card that is not saved from one saved as shown and one saved in another version", () => {
    const taxis = card("taxis");
    expect(savedState(overview, taxis)).toBe("no");
    const saved = saveToOverview(overview, taxis);
    expect(ids(saved)).toEqual(["safe", "month", "taxis"]);
    expect(saved[2]).toEqual(savedCard(taxis));
    expect(savedState(saved, taxis)).toBe("saved");
    const moved = { ...taxis, data: { kind: "engine" as const, fn: "spendBy" as const, args: { period: "last_3_months" } } };
    expect(savedState(saved, moved)).toBe("changed");
    expect(saveToOverview(saved, moved)).toHaveLength(3);
    expect(savedState(saveToOverview(saved, moved), moved)).toBe("saved");
  });
});

describe("the conversation", () => {
  const messages: Message[] = [
    { id: 1, role: "user", text: "", modelText: "[PHOTO headphones 349 €]", photoUrl: "data:image/jpeg;base64,AAAA", photo: { item: "headphones", amount: 349 } as Message["photo"] },
    { id: 2, role: "assistant", text: "You spent €42.", modelText: "You spent {{taxis.value}}.", cards: [card("taxis"), card("bills")] },
    { id: 3, role: "user", text: "Why?" },
    { id: 4, role: "assistant", text: "I couldn't answer that." },
  ];

  it("gives the coach what it said before figures were filled in, and leaves out what was never part of it", () => {
    expect(modelHistory(messages, 30)).toEqual([
      { role: "user", text: "[PHOTO headphones 349 €]" },
      { role: "assistant", text: "You spent {{taxis.value}}." },
    ]);
    expect(modelHistory(messages, 1)).toEqual([{ role: "assistant", text: "You spent {{taxis.value}}." }]);
    expect(answerCards(messages).map(ids)).toEqual([["taxis", "bills"]]);
  });

  it("changes a card in one answer only, and drops a removed card from the answers that showed it", () => {
    const two = [...messages, { id: 5, role: "assistant" as const, text: "Again", cards: [card("taxis")] }];
    const patched = patchCard(two, 5, "taxis", { title: "Changed" });
    expect(patched[1].cards?.[0].title).toBe("taxis");
    expect(patched[4].cards?.[0].title).toBe("Changed");
    expect(withoutCards(two, ["taxis"]).map((m) => ids(m.cards ?? []))).toEqual([[], ["bills"], [], [], []]);
    expect(withoutCards(two, [])).toBe(two);
  });

  it("is stored without its photos and read back as it was, cards and all", () => {
    const stored = toStored(messages);
    expect(stored[0].photoUrl).toBeUndefined();
    expect(stored[0].photo).toEqual(messages[0].photo);
    expect(fromStored(JSON.stringify(stored))).toEqual(stored);
    expect(fromStored(JSON.stringify(stored))[1].cards).toEqual(messages[1].cards);
  });

  it("keeps the newest messages of a long conversation", () => {
    const long = Array.from({ length: MAX_STORED_MESSAGES + 5 }, (_, i): Message => ({ id: i + 1, role: "user", text: String(i) }));
    const stored = toStored(long);
    expect(stored).toHaveLength(MAX_STORED_MESSAGES);
    expect(stored.at(-1)?.id).toBe(MAX_STORED_MESSAGES + 5);
  });

  it("opens empty when what is stored is not a conversation", () => {
    expect(fromStored(null)).toEqual([]);
    expect(fromStored("not json")).toEqual([]);
    expect(fromStored('{"id":1}')).toEqual([]);
    expect(fromStored('[{"id":1,"role":"user","text":"hi"},{"id":"2"},null]')).toEqual([{ id: 1, role: "user", text: "hi" }]);
  });
});
