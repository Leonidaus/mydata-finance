import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { type Block, catalog } from "@mydata/shared";
import Chat from "./Chat";
import { type Message, savedCard } from "./conversation";

const stored = vi.hoisted(() => ({ messages: [] as unknown[] }));

// Render the real conversation as it opens from the browser's storage, without needing a browser or voice service.
vi.mock("./conversation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./conversation")>()),
  loadConversation: () => stored.messages,
  saveConversation: () => {},
}));
vi.mock("./voice/client", () => ({ createVoiceClient: () => ({}) }));
vi.mock("./voice/useVoice", () => ({ useVoice: () => ({ available: false, reset: () => {} }) }));

const blockedAnswer: Message = {
  id: 1, role: "assistant", text: "Travel is on your keep-as-is list.",
  question: "What if I cut travel?", blocked: ["Travel"], overrideUsed: false,
};
const open = (messages: Message[]) => { stored.messages = messages; };
const renderChat = (props: Partial<Parameters<typeof Chat>[0]> = {}) =>
  renderToStaticMarkup(<Chat onAsk={async () => ({ text: "OK" })} customerId="CUST00001" mode="server" {...props} />);

beforeEach(() => open([]));

describe("protected-category consent in chat", () => {
  it("offers the one-time override alongside a blocked answer and the coach face", () => {
    open([blockedAnswer]);
    const html = renderChat();
    expect(html).toContain(blockedAnswer.text);
    expect(html).toContain("Show it anyway");
    expect(html).toContain('class="coach-row"');
  });

  it("does not offer another override after the one-time consent was used", () => {
    open([{ ...blockedAnswer, overrideUsed: true }]);
    expect(renderChat()).not.toContain("Show it anyway");
  });

  it("does not offer consent for an ordinary answer", () => {
    open([{ id: 1, role: "assistant", text: "Here is your spending." }]);
    expect(renderChat()).not.toContain("Show it anyway");
  });

  it("does not offer a stale override after the conversation has moved on", () => {
    open([blockedAnswer, { id: 2, role: "user", text: "Show groceries instead." }]);
    expect(renderChat()).not.toContain("Show it anyway");
  });
});

describe("an answer and its cards", () => {
  const taxis: Block = { ...catalog.categoryBars({ period: "last_month", category: "Transportation", title: "Transportation by merchant type" }), id: "taxis" };
  const answered: Message[] = [
    { id: 1, role: "user", text: "How much on taxis?" },
    { id: 2, role: "assistant", text: "You spent €42 on taxis.", cards: [taxis], suggestions: ["And the last 3 months?"] },
  ];

  it("shows the card inside the answer it belongs to, after the coach's words", () => {
    open(answered);
    const html = renderChat({ onSave: () => {}, onFocus: () => {} });
    const answer = html.slice(html.indexOf('class="turn turn-coach"'));
    expect(answer.indexOf("You spent €42 on taxis.")).toBeLessThan(answer.indexOf("Transportation by merchant type"));
    expect(answer).toContain('class="block block-answer"');
    expect(answer).toContain("Save to overview");
    expect(answer).toContain("Ask about this");
    expect(answer).toContain("And the last 3 months?");
  });

  it("shows the same card under two answers without sharing an element id", () => {
    open([...answered, { id: 3, role: "user", text: "And this month?" }, { id: 4, role: "assistant", text: "This month €10.", cards: [{ ...taxis, title: "Taxis this month" }] }]);
    const ids = [...renderChat().matchAll(/aria-labelledby="([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it("marks a card the overview has, and one the overview has in an earlier version", () => {
    open(answered);
    expect(renderChat({ onSave: () => {}, overview: [savedCard(taxis)] })).toContain("Saved to overview");
    expect(renderChat({ onSave: () => {}, overview: [savedCard({ ...taxis, title: "Before" })] })).toContain("Save changes to overview");
  });

  it("offers the coach's next steps only after its latest answer", () => {
    open([...answered, { id: 3, role: "user", text: "Thanks" }]);
    expect(renderChat()).not.toContain("And the last 3 months?");
  });

  it("names the card a question is about, above the question and while it is being written", () => {
    open([{ id: 1, role: "user", text: "What about last month?", about: "Transportation by merchant type" }]);
    expect(renderChat()).toContain("About: Transportation by merchant type");
    open([]);
    const html = renderChat({ focus: { id: "taxis", title: "Bills" }, onFocus: () => {} });
    expect(html).toContain("About: Bills");
    expect(html).toContain("Ask about this card…");
  });

  it("starts with the starter questions and no log, and puts the header first in the scroll", () => {
    const html = renderChat({ header: <p>saved cards</p> });
    expect(html).toContain("Explain my spending amount");
    expect(html).not.toContain('role="log"');
    expect(html.indexOf("saved cards")).toBeLessThan(html.indexOf('class="composer"'));
  });

  it("leaves the scroll to the header while the log is hidden", () => {
    open(answered);
    expect(renderChat({ showLog: false })).not.toContain("You spent €42 on taxis.");
  });
});

describe("several receipts sent at once", () => {
  const receipt = (id: string, merchant: string) => ({
    id, createdAt: "", merchant, mcc: "5411", date: "2026-09-14", time: "13:20", total: 62.52, paidBy: "card" as const,
    lines: [{ name: "Maito", subcategory: "dairy_eggs" as const, amount: 62.52, kind: "item" as const }],
    linesMismatch: false, status: "confirmed" as const, txId: 1, autoMatched: true,
  });

  it("shows one card per receipt under the summary, and how many photos were sent once they are gone", () => {
    open([
      { id: 1, role: "user", text: "", photoCount: 2, modelText: "[2 RECEIPT PHOTOS sent]" },
      { id: 2, role: "assistant", text: "I saved 2 receipts: 2 linked to a card payment, 0 waiting for you to pick the payment.", receipts: [receipt("a", "Ruokakauppa Kamppi"), receipt("b", "Bistro Esplanadi")] },
    ]);
    const html = renderChat();
    expect(html).toContain("2 receipt photos");
    expect(html).toContain("Ruokakauppa Kamppi");
    expect(html).toContain("Bistro Esplanadi");
    expect(html.match(/class="receipt-card"/g)).toHaveLength(2);
  });

  it("says one photo in the singular", () => {
    open([{ id: 1, role: "user", text: "", photoCount: 1 }]);
    expect(renderChat()).toContain("1 receipt photo<");
  });
});
