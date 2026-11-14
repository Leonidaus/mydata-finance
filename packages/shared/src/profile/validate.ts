import { SPENDING_CATEGORIES } from "../engine/util";
import { COACHING_STYLES, DEFAULT_PROFILE, type CoachingProfile, type ProfileUpdate, ProfileError, type ProtectedCategory } from "./types";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const knownCategory = (value: unknown): value is ProtectedCategory => typeof value === "string" && (SPENDING_CATEGORIES as readonly string[]).includes(value);

export function parseCategoryList(value: unknown, name: string): ProtectedCategory[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 10 || !value.every(knownCategory)) {
    throw new ProfileError(`${name} must be a list of categories from: ${SPENDING_CATEGORIES.join(", ")}.`);
  }
  if (new Set(value).size !== value.length) throw new ProfileError(`${name} must not contain a category twice.`);
  return value;
}

/** Parses the deliberately additive profile patch format. */
export function parseProfileUpdate(body: unknown): ProfileUpdate {
  if (!isRecord(body)) throw new ProfileError("Body must be a JSON object");
  for (const key of Object.keys(body)) if (key !== "style" && key !== "protect") throw new ProfileError(`Unknown profile field: ${key}`);
  const update: ProfileUpdate = {};
  if (body.style !== undefined) {
    if (typeof body.style !== "string" || !(COACHING_STYLES as readonly string[]).includes(body.style)) {
      throw new ProfileError(`style must be one of: ${COACHING_STYLES.join(", ")}.`);
    }
    update.style = body.style as ProfileUpdate["style"];
  }
  if (body.protect !== undefined) {
    if (!isRecord(body.protect)) throw new ProfileError("protect must be an object");
    for (const key of Object.keys(body.protect)) if (key !== "add" && key !== "remove") throw new ProfileError(`Unknown protect field: ${key}`);
    const add = parseCategoryList(body.protect.add, "protect.add");
    const remove = parseCategoryList(body.protect.remove, "protect.remove");
    if (add.some((category) => remove.includes(category))) throw new ProfileError("protect.add and protect.remove must not overlap.");
    if (add.length || remove.length) update.protect = { ...(add.length && { add }), ...(remove.length && { remove }) };
  }
  if (!update.style && !update.protect) throw new ProfileError("Profile update must change style or protections.");
  return update;
}

/** Pure additive patch application, with the public category order retained. */
export function applyProfileUpdate(current: CoachingProfile, update: ProfileUpdate, now: string): CoachingProfile {
  const protectedSet = new Set(current.protectedCategories);
  for (const category of update.protect?.add ?? []) protectedSet.add(category);
  for (const category of update.protect?.remove ?? []) protectedSet.delete(category);
  return {
    version: DEFAULT_PROFILE.version,
    style: update.style ?? current.style,
    protectedCategories: SPENDING_CATEGORIES.filter((category): category is ProtectedCategory => protectedSet.has(category)),
    updatedAt: now,
  };
}
