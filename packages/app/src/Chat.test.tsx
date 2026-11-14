import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ProtectedCategory } from "@mydata/shared";
import Chat from "./Chat";

type SavedMessage = {
  id: number;
  role: "user" | "assistant";
  text: string;
  question?: string;
  blocked?: ProtectedCategory[];
  overrideUsed?: boolean;
};
const saved = vi.hoisted(() => ({ messages: [] as SavedMessage[] }));

// Render the real chat with an already received answer, without needing a browser or voice service.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: <S,>(initial: S | (() => S)) => {
      const [value, setValue] = actual.useState(initial);
      return [Array.isArray(initial) ? saved.messages : value, setValue];
    },
  };
});
vi.mock("./voice/client", () => ({ createVoiceClient: () => ({}) }));
vi.mock("./voice/useVoice", () => ({ useVoice: () => ({ available: false, reset: () => {} }) }));

const blockedAnswer: SavedMessage = {
  id: 1, role: "assistant", text: "Travel is on your keep-as-is list.",
  question: "What if I cut travel?", blocked: ["Travel"], overrideUsed: false,
};
const renderChat = () => renderToStaticMarkup(<Chat onAsk={async () => ({ text: "OK" })} resetKey="CUST00001" mode="server" />);

beforeEach(() => { saved.messages = []; });

describe("protected-category consent in chat", () => {
  it("offers the one-time override alongside a blocked answer and the coach face", () => {
    saved.messages = [blockedAnswer];
    const html = renderChat();
    expect(html).toContain(blockedAnswer.text);
    expect(html).toContain("Show it anyway");
    expect(html).toContain('class="coach-row"');
  });

  it("does not offer another override after the one-time consent was used", () => {
    saved.messages = [{ ...blockedAnswer, overrideUsed: true }];
    expect(renderChat()).not.toContain("Show it anyway");
  });

  it("does not offer consent for an ordinary answer", () => {
    saved.messages = [{ id: 1, role: "assistant", text: "Here is your spending." }];
    expect(renderChat()).not.toContain("Show it anyway");
  });

  it("does not offer a stale override after the conversation has moved on", () => {
    saved.messages = [blockedAnswer, { id: 2, role: "user", text: "Show groceries instead." }];
    expect(renderChat()).not.toContain("Show it anyway");
  });
});
