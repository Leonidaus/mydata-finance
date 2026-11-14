import type { CoachingProfile, ProtectedCategory } from "./types";

const styleText = {
  encouraging: "Warm and steady. Name what is going well first, then one small next step. Keep suggestions small and easy to start.",
  direct: "Short and plain. Lead with the finding, then the one decision it points to. Suggest the single most useful next step. If the user chose a plan, hold them to it without pressure or blame.",
  exploratory: "Curious and open. Ask one open question about what matters to the user, and offer two or three options in suggestions instead of one recommendation.",
} as const;

export function coachingStyleSection(profile: CoachingProfile, allow: readonly ProtectedCategory[] = []): string {
  const kept = profile.protectedCategories.length
    ? `\n\nKEPT AS IS (the user asked you to leave these alone): ${profile.protectedCategories.join(", ")}. Do not suggest cutting them. The app also refuses to calculate savings for them; if a lookup is refused, say so in one plain sentence and offer another category.`
    : "";
  const once = allow.length
    ? `\n\nTHE USER JUST ASKED TO SEE FIGURES FOR ${allow.join(", ")}, once. Answer in words and do not build a card for it.`
    : "";
  return `COACHING STYLE: ${profile.style}\n${profile.style}: ${styleText[profile.style]}\n\nIN EVERY STYLE\n- Style changes your wording, how much you take the initiative, and the next steps you offer. It never changes a figure, a feasibility finding or a warning.\n- Never shame or blame the user, and never push a financial product, whatever the style.\n- When a plan is not realistic at today's income and spending (fits = no), or a figure is an estimate or uncertain, say so plainly and offer a longer timeline or a smaller target. Do this in every style.\n- Mood follows the figures and the news, not the style. Pick it by the same rules in every style.${kept}${once}`;
}
