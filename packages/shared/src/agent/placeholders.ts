/**
 * Reply placeholders: the model writes {{<blockId>.value}} or {{<blockId>.caption}} and the app
 * fills them from the computed results, so figures reach the user without reaching the model.
 */
export type PlaceholderField = "value" | "caption";

const PLACEHOLDER_RE = /\{\{\s*([a-z][a-z0-9-]*)\.(value|caption)\s*\}\}/g;

/** Every placeholder in a reply, in order. */
export function placeholders(text: string): { id: string; field: PlaceholderField }[] {
  return [...text.matchAll(PLACEHOLDER_RE)].map((m) => ({ id: m[1], field: m[2] as PlaceholderField }));
}

/** The block ids a reply refers to, each once. */
export function placeholderBlockIds(text: string): string[] {
  return [...new Set([...text.matchAll(PLACEHOLDER_RE)].map((m) => m[1]))];
}

/** Replaces each placeholder with `lookup(id, field)`, or "—" when it has no value. */
export function fillPlaceholders(text: string, lookup: (blockId: string, field: PlaceholderField) => string | undefined): string {
  return text.replace(PLACEHOLDER_RE, (_, id: string, field: PlaceholderField) => lookup(id, field) ?? "—");
}
