# Repository instructions

## Localization

The product supports English (`en`) and Finnish (`fi`). Any change that adds or changes user-visible text must update both languages in `packages/app/src/i18n.tsx` in the same change.

- Use `useI18n().t(...)` for React UI text, including button text, headings, validation/loading/error messages, placeholders, `aria-label`, and `title` attributes. Do not introduce English or Finnish literals directly in product components.
- Use the locale-aware helpers in `packages/app/src/format.ts` for amounts and dates, and `useI18n().category(...)` for transaction-category labels. Never translate stable domain values, API arguments, database values, or component IDs; only translate their displayed label.
- Text created outside React—chart axes/tooltips, iframe widgets, engine captions, mock-agent replies, and model prompts—must receive the active locale explicitly and provide both languages. Model requests must preserve and forward the selected `language`.
- Add semantic translation keys rather than using an English sentence as a key. The Finnish catalog is typed against the English catalog; keep their key sets identical.
- When changing localization behavior, run `npm run typecheck` and `npm test`.
