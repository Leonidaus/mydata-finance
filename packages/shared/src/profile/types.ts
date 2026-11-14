import type { TransactionCategory } from "../schema";

export const COACHING_STYLES = ["encouraging", "direct", "exploratory"] as const;
export type CoachingStyle = (typeof COACHING_STYLES)[number];

/** Runtime-validated against SPENDING_CATEGORIES; its static type is intentionally wider. */
export type ProtectedCategory = TransactionCategory;

export const PROFILE_VERSION = 1;

export interface CoachingProfile {
  version: typeof PROFILE_VERSION;
  style: CoachingStyle;
  /** Unique, in SPENDING_CATEGORIES order. */
  protectedCategories: ProtectedCategory[];
  /** Set by the server for saved profiles; null means the never-saved default. */
  updatedAt: string | null;
}

export const DEFAULT_PROFILE: CoachingProfile = {
  version: PROFILE_VERSION,
  style: "encouraging",
  protectedCategories: [],
  updatedAt: null,
};

/** A protection is removed only by naming it in protect.remove. */
export interface ProfileUpdate {
  style?: CoachingStyle;
  protect?: { add?: ProtectedCategory[]; remove?: ProtectedCategory[] };
}

export class ProfileError extends Error {}
