import { applyProtections, DEFAULT_PROFILE, ProtectedCategoryError, type EngineFn, type EngineResult, type ProtectedCategory } from "@mydata/shared";
import type { FinanceDb } from "../db";
import type { ProfileStore } from "../profiles";
import { runEngineFor } from "./engine";

/** Finance execution bound to a profile store. The shared engine remains profile-free. */
export class ProtectedEngine {
  constructor(private db: FinanceDb, private profiles: ProfileStore) {}

  run(
    customerId: string,
    fn: EngineFn,
    args: Record<string, unknown>,
    options: { allow?: readonly ProtectedCategory[]; onBlocked?: (categories: ProtectedCategory[]) => void } = {},
  ): EngineResult | null {
    try {
      const profile = this.profiles.get(customerId) ?? DEFAULT_PROFILE;
      const safeArgs = applyProtections(fn, args, { protectedCategories: profile.protectedCategories, allow: options.allow });
      return runEngineFor(this.db, customerId, fn, safeArgs);
    } catch (error) {
      if (error instanceof ProtectedCategoryError) options.onBlocked?.(error.categories);
      throw error;
    }
  }
}
