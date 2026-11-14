/**
 * Changing the saved coaching preferences from the chat.
 *
 * The preferences (a coaching style and the categories to keep as is) are set in the app's
 * coaching settings and saved per customer. The coach can change them when the user asks:
 *
 * - keeping one more category as is, or another style, is applied straight away;
 * - taking a category off the keep-as-is list needs the user's yes. The first call only records
 *   that the coach has to ask; the removal is applied when the next message arrives with that
 *   category marked as asked about. A model cannot remove a protection on its own say-so.
 */
import { SPENDING_CATEGORIES } from "../engine/util";
import { COACHING_STYLES, type CoachingProfile, type CoachingStyle, type ProfileUpdate, type ProtectedCategory } from "../profile";
import type { ToolCall, ToolDeclaration } from "./tools";

export const PREFERENCES_TOOL = "update_preferences";

export const PREFERENCES_DECLARATION: ToolDeclaration = {
  name: PREFERENCES_TOOL,
  description:
    "Change the user's saved coaching preferences when they ask for it in the chat. Call it alone; you are told what changed, and then you answer. " +
    'keep_add: categories the user wants left alone ("leave my travel alone"). style: when they ask you to be more direct, more encouraging or more exploring. ' +
    "keep_remove: categories to take off the keep-as-is list, when the user says they are willing to cut one of them. That needs their yes: " +
    "the first time nothing is changed and you are told to ask them; call it again once they have said yes.",
  parametersJsonSchema: {
    type: "object",
    properties: {
      style: { type: "string", enum: [...COACHING_STYLES] },
      keep_add: { type: "array", items: { type: "string", enum: [...SPENDING_CATEGORIES] } },
      keep_remove: { type: "array", items: { type: "string", enum: [...SPENDING_CATEGORIES] } },
    },
  },
};

export interface PreferenceAccess {
  /** Categories the coach asked about in its previous answer; only these may come off the keep-as-is list now. */
  pendingUnprotect: readonly ProtectedCategory[];
  /** Saves the change and returns the profile as it is now. */
  apply(update: ProfileUpdate): CoachingProfile | Promise<CoachingProfile>;
}

export interface PreferenceOutcome {
  /** The profile after the change (the same one when nothing changed). */
  profile: CoachingProfile;
  changed: boolean;
  /** Categories the coach has to ask the user about before they can come off the list. */
  ask: ProtectedCategory[];
  /** What happened, as text for the model. */
  text: string;
}

const categories = (value: unknown): ProtectedCategory[] =>
  Array.isArray(value) ? SPENDING_CATEGORIES.filter((category) => value.includes(category)) : [];

/** Applies what the model's update_preferences calls ask for, as far as the rules above allow. */
export async function updatePreferences(calls: ToolCall[], profile: CoachingProfile, access: PreferenceAccess): Promise<PreferenceOutcome> {
  const style = calls.map((c) => c.args.style).filter((s): s is CoachingStyle => (COACHING_STYLES as readonly unknown[]).includes(s)).at(-1);
  const wantRemove = new Set(calls.flatMap((c) => categories(c.args.keep_remove)));
  const wantAdd = new Set(calls.flatMap((c) => categories(c.args.keep_add)).filter((category) => !wantRemove.has(category)));
  const kept = new Set(profile.protectedCategories);

  const add = [...wantAdd].filter((category) => !kept.has(category));
  const remove = [...wantRemove].filter((category) => kept.has(category) && access.pendingUnprotect.includes(category));
  const ask = [...wantRemove].filter((category) => kept.has(category) && !access.pendingUnprotect.includes(category));
  const notKept = [...wantRemove].filter((category) => !kept.has(category));

  const update: ProfileUpdate = {
    ...(style && style !== profile.style && { style }),
    ...((add.length || remove.length) && { protect: { ...(add.length && { add }), ...(remove.length && { remove }) } }),
  };
  const changed = Boolean(update.style || update.protect);
  const after = changed ? await access.apply(update) : profile;

  const lines: string[] = [];
  if (update.style) lines.push(`Saved: the coaching style is now ${after.style}. Answer in that style from now on.`);
  if (add.length) lines.push(`Saved: ${add.join(", ")} ${add.length === 1 ? "is" : "are"} now kept as is. Do not suggest cutting ${add.length === 1 ? "it" : "them"}.`);
  if (remove.length) {
    lines.push(`Saved: ${remove.join(", ")} ${remove.length === 1 ? "is" : "are"} no longer kept as is, as the user confirmed. Figures and savings for ${remove.length === 1 ? "it" : "them"} are available now: go on with what the user asked.`);
  }
  if (ask.length) {
    lines.push(
      `NOT changed yet: ${ask.join(", ")} ${ask.length === 1 ? "is" : "are"} on the user's keep-as-is list, which they set themselves. ` +
        `Ask them in one sentence whether you should take ${ask.length === 1 ? "it" : "them"} off that list, and say that their saved preference would change. ` +
        "Offer a yes and a no in suggestions. Do not calculate anything for it and do not build a card in this answer.",
    );
  }
  if (notKept.length) lines.push(`${notKept.join(", ")} ${notKept.length === 1 ? "was" : "were"} not on the keep-as-is list: nothing to change, go on with what the user asked.`);
  if (!lines.length) lines.push("Nothing was changed: the preferences are already like that.");
  lines.push(`Kept as is now: ${after.protectedCategories.length ? after.protectedCategories.join(", ") : "nothing"}. Coaching style: ${after.style}.`);
  return { profile: after, changed, ask, text: lines.join("\n") };
}

/** How the coach handles preferences in the chat, for the system prompt. */
export function preferencesSection(pendingUnprotect: readonly ProtectedCategory[]): string {
  const pending = pendingUnprotect.length
    ? `\n- In your previous answer the user was asked whether to take ${pendingUnprotect.join(", ")} off the keep-as-is list. If their message is a yes, call update_preferences with keep_remove for it first, then go on with what they wanted. If it is a no, leave the list as it is and offer another category.`
    : "";
  return `PREFERENCES IN THE CHAT
- The coaching style and the keep-as-is list are the user's saved preferences. They can change them by telling you, and you change them with update_preferences.
- "Leave my travel alone", "don't touch my hobbies": keep_add. "Be more direct", "go easier on me": style. Say in one short sentence what you changed.
- When the user says they would be willing to cut something that is on the keep-as-is list, or asks what cutting it would save: do not refuse, and do not look it up. Call update_preferences with keep_remove for that category. The first time, nothing changes and you ask the user whether to take it off the list. Only after their yes is it removed, and then you carry on with the cut they asked about.
- Never take a category off the list because you think it would help. Only the user decides that.${pending}`;
}
