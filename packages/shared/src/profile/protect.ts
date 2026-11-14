import { EngineArgumentError, validateEngineArgs } from "../engine/args";
import { WHATIF_DEFAULT_CATEGORY } from "../engine/functions";
import { MCC_CODES } from "../mcc";
import type { EngineFn } from "../engine/types";
import type { ProtectedCategory } from "./types";

export class ProtectedCategoryError extends EngineArgumentError {
  readonly code = "protected_category";
  constructor(readonly categories: ProtectedCategory[]) {
    super(
      `${categories.join(", ")} ${categories.length === 1 ? "is" : "are"} on the user's keep-as-is list, ` +
        "so no saving is calculated for it. Say so plainly, offer another category, and mention " +
        "that the user can change this in the coaching settings or ask to see it anyway.",
    );
    this.name = "ProtectedCategoryError";
  }
}

export interface ProtectionContext {
  protectedCategories: readonly ProtectedCategory[];
  allow?: readonly ProtectedCategory[];
}

/** Applies server-owned protections after ordinary engine argument validation. */
export function applyProtections(fn: EngineFn, args: Record<string, unknown>, ctx: ProtectionContext): Record<string, unknown> {
  const clean = validateEngineArgs(fn, args);
  const protectedSet = new Set(ctx.protectedCategories.filter((category) => !ctx.allow?.includes(category)));
  if (fn === "savingsOptions") {
    const modelProtect = Array.isArray(clean.protect) ? (clean.protect as ProtectedCategory[]) : [];
    const protect = [...new Set([...modelProtect, ...protectedSet])];
    return { ...clean, ...(protect.length && { protect }) };
  }
  if (fn === "whatIf") {
    const category = typeof clean.mcc === "string" ? MCC_CODES[clean.mcc].category : (clean.category as ProtectedCategory | undefined) ?? WHATIF_DEFAULT_CATEGORY;
    if (protectedSet.has(category)) throw new ProtectedCategoryError([category]);
  }
  return clean;
}
