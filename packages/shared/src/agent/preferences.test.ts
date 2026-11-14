import { describe, expect, it } from "vitest";
import { applyProfileUpdate, type CoachingProfile, DEFAULT_PROFILE, type ProfileUpdate } from "../profile";
import { type ChatModel, type ChatModelRequest, runChat } from "./chat";
import { updatePreferences } from "./preferences";
import { buildSystemPrompt } from "./prompt";
import type { ToolCall } from "./tools";

const keeping = (...categories: string[]): CoachingProfile => ({ ...DEFAULT_PROFILE, protectedCategories: categories as CoachingProfile["protectedCategories"], updatedAt: "2026-11-14T00:00:00.000Z" });

/** A profile store for one customer that records what was saved. */
function store(start: CoachingProfile) {
  let profile = start;
  const saved: ProfileUpdate[] = [];
  return {
    saved,
    get profile() {
      return profile;
    },
    apply(update: ProfileUpdate) {
      saved.push(update);
      profile = applyProfileUpdate(profile, update, "2026-11-14T12:00:00.000Z");
      return profile;
    },
  };
}
const change = (args: Record<string, unknown>): ToolCall => ({ name: "update_preferences", args });

describe("updating coaching preferences from the chat", () => {
  it("keeps one more category as is and changes the style straight away", async () => {
    const s = store(keeping("Travel"));
    const out = await updatePreferences([change({ keep_add: ["Restaurants", "Travel"], style: "direct" })], s.profile, { pendingUnprotect: [], apply: s.apply });
    expect(s.saved).toEqual([{ style: "direct", protect: { add: ["Restaurants"] } }]);
    expect(out).toMatchObject({ changed: true, ask: [] });
    expect(out.profile.protectedCategories).toEqual(["Restaurants", "Travel"]);
    expect(out.text).toMatch(/coaching style is now direct[\s\S]*Restaurants is now kept as is[\s\S]*Kept as is now: Restaurants, Travel/);
  });

  it("does not take a category off the list until the user has been asked", async () => {
    const s = store(keeping("Restaurants", "Travel"));
    const first = await updatePreferences([change({ keep_remove: ["Restaurants"] })], s.profile, { pendingUnprotect: [], apply: s.apply });
    expect(s.saved).toEqual([]);
    expect(first).toMatchObject({ changed: false, ask: ["Restaurants"] });
    expect(first.text).toMatch(/NOT changed yet: Restaurants is on the user's keep-as-is list[\s\S]*Ask them/);

    // The next message arrives with Restaurants marked as asked about: now it goes through, and only that one.
    const second = await updatePreferences([change({ keep_remove: ["Restaurants", "Travel"] })], s.profile, { pendingUnprotect: ["Restaurants"], apply: s.apply });
    expect(s.saved).toEqual([{ protect: { remove: ["Restaurants"] } }]);
    expect(second).toMatchObject({ changed: true, ask: ["Travel"] });
    expect(second.profile.protectedCategories).toEqual(["Travel"]);
    expect(second.text).toMatch(/Restaurants is no longer kept as is, as the user confirmed/);
  });

  it("ignores what makes no sense, and says when nothing changed", async () => {
    const s = store(keeping("Travel"));
    const out = await updatePreferences([change({ keep_remove: ["Groceries", "Holidays"], keep_add: ["Travel"], style: "strict" })], s.profile, { pendingUnprotect: ["Groceries"], apply: s.apply });
    expect(s.saved).toEqual([]);
    expect(out).toMatchObject({ changed: false, ask: [] });
    expect(out.text).toMatch(/Groceries was not on the keep-as-is list/);
  });
});

describe("runChat with preferences", () => {
  function scripted(...answers: ToolCall[][]) {
    const requests: ChatModelRequest[] = [];
    const model: ChatModel = {
      async generate(req) {
        requests.push(structuredClone(req));
        return { calls: answers[requests.length - 1] ?? [] };
      },
    };
    return { model, requests };
  }
  const say = (text: string): ToolCall => ({ name: "reply", args: { text } });
  const ask = (model: ChatModel, s: ReturnType<typeof store>, question: string, pendingUnprotect: string[] = []) =>
    runChat(model, {
      question,
      history: [],
      blocks: [],
      today: "2026-09-15",
      profile: s.profile,
      preferences: { pendingUnprotect: pendingUnprotect as CoachingProfile["protectedCategories"], apply: s.apply },
    });

  it("asks before taking a category off the list, and removes it after the yes", async () => {
    const s = store(keeping("Restaurants"));
    // Turn 1: the user is willing to cut restaurants, which they had asked to keep.
    const first = scripted([change({ keep_remove: ["Restaurants"] })], [say("Restaurants is on your keep-as-is list. Shall I take it off?")]);
    const asked = await ask(first.model, s, "I could spend less on restaurants.");
    expect(first.requests[0].tools.map((t) => t.name)).toContain("update_preferences");
    expect(first.requests[0].system).toMatch(/KEPT AS IS[^\n]*Restaurants[\s\S]*PREFERENCES IN THE CHAT/);
    expect(first.requests[1].turns.at(-1)?.text).toMatch(/^PREFERENCES\nNOT changed yet: Restaurants/);
    expect(asked).toMatchObject({ text: "Restaurants is on your keep-as-is list. Shall I take it off?", proposedUnprotect: ["Restaurants"] });
    expect(asked.profile).toBeUndefined();
    expect(s.profile.protectedCategories).toEqual(["Restaurants"]);

    // Turn 2: the yes, sent with what was asked about.
    const second = scripted([change({ keep_remove: ["Restaurants"] })], [say("Done. Restaurants is off the list.")]);
    const confirmed = await ask(second.model, s, "Yes, take Restaurants off my keep-as-is list.", ["Restaurants"]);
    expect(second.requests[0].system).toMatch(/the user was asked whether to take Restaurants off the keep-as-is list/);
    // After the change the coach is no longer told to keep it as is.
    expect(second.requests[1].system).not.toMatch(/KEPT AS IS/);
    expect(second.requests[1].turns.at(-1)?.text).toMatch(/^PREFERENCES\nSaved: Restaurants is no longer kept as is/);
    expect(confirmed).toMatchObject({ text: "Done. Restaurants is off the list.", proposedUnprotect: [] });
    expect(confirmed.profile?.protectedCategories).toEqual([]);
    expect(s.saved).toEqual([{ protect: { remove: ["Restaurants"] } }]);
  });

  it("cannot remove a protection in one go, however the model asks", async () => {
    const s = store(keeping("Restaurants"));
    const eager = scripted([change({ keep_remove: ["Restaurants"] })], [change({ keep_remove: ["Restaurants"] })], [change({ keep_remove: ["Restaurants"] }), say("I took it off.")]);
    const out = await ask(eager.model, s, "What would cutting restaurants save?");
    expect(s.saved).toEqual([]);
    expect(s.profile.protectedCategories).toEqual(["Restaurants"]);
    // After two tries the tool is no longer on offer, and the leftover call is not treated as an answer.
    expect(eager.requests[2].tools.map((t) => t.name)).not.toContain("update_preferences");
    expect(out).toMatchObject({ text: "I took it off.", proposedUnprotect: ["Restaurants"], rejected: [] });
  });

  it("offers no preference tool without a profile store, and says nothing about it in the prompt", async () => {
    const plain = scripted([say("Hello.")]);
    await runChat(plain.model, { question: "Hi", history: [], blocks: [], today: "2026-09-15", profile: keeping("Travel") });
    expect(plain.requests[0].tools.map((t) => t.name)).not.toContain("update_preferences");
    expect(plain.requests[0].system).not.toContain("PREFERENCES IN THE CHAT");
    expect(buildSystemPrompt([], "2026-09-15", { profile: keeping("Travel"), preferences: { pendingUnprotect: [] } })).toContain("PREFERENCES IN THE CHAT");
  });
});
