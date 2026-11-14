# Receipts matched to transactions: implementation plan

The user photographs a receipt. The app reads its items, finds the card payment it
belongs to, and the user confirms the match. Confirmed receipts give the engine
item-level figures, such as "sweets in your grocery shopping", so the coach can answer
narrower questions about habits. The rules stay the same: numbers are computed and
checked, and the model never does arithmetic.

Status: built on `feature/receipts` (14 November 2026). See [As built](#as-built) for where it differs from the plan.

## Decisions

Settled with the team before planning. Treat them as fixed inputs.

| Decision | Outcome |
|---|---|
| How receipts come in | Photos only. Simulated S-Etukortti receipts are out: they would not cover restaurants and other shops. |
| Matching | A strong match is linked automatically; the card says so and offers "Not this payment". A possible match is suggested and the user confirms it. |
| Demo data | The matching logic is real. The demo inputs are staged: printed receipts whose totals and times match one fixture customer's real transactions (the dataset is synthetic and ends 2026-09-30). |
| Where it lives | In chat: the camera button and a match card in the reply. Also a small receipts list on the Overview to review and fix matches. |
| Item classification | A fixed list of sub-categories ([below](#item-sub-categories)). The model picks from the list and the engine adds up. |
| Showing a receipt | In the existing transaction drawer: a receipt icon on the row, items inline. There is no transaction detail page. |
| Storage | A new writable SQLite store on the backend, separate from the read-only finance database. |

Proposed here; open for the team to object:

- **The photo is not kept.** Only what was read from it is stored, so the store holds no images and less personal data. Deleting a receipt deletes everything about it.
- **Item names never reach the coach.** The coach gets sums per sub-category from the engine. Item names are shown only in the app. This keeps text from the receipt out of the prompt.
- **One receipt per transaction, one transaction per receipt.** Split payments and a receipt paid partly in cash are out of scope.
- **Fixture mode hides the feature.** It needs the backend and the model.

Effect on the README: the "Where data lives" row should mention that receipts and the
coaching profile sit in writable SQLite stores of their own.

## User flow

```
[camera] → photo of a receipt (+ optional question)
   │
   ▼  POST /api/chat  (image)
readPhoto ─ kind = receipt? ──no──► existing "can I afford this?" path
   │ yes
   ▼
readReceipt (2nd vision call) → merchant, time, total, items with sub-category
   │
   ▼
ReceiptStore.save (status: unmatched)  →  matchReceipt(engine tx) → candidates
   │
   ▼
reply: { receipt: ReceiptView, candidates }  (+ coach text only if the user asked something)
   │
   ▼
Match card in chat ── Confirm ──► POST /api/receipts/:id/confirm {txId} → status confirmed
                    ├ Choose another ─► candidate list (next 3–5)
                    └ None of these ──► stays unmatched, listed on Overview
```

A receipt sent **without words** gets no coach call. The app writes a fixed reply from
translated text, such as "Prisma, 42,30 €, 12 items. This looks like your card payment
on 12.9. at 17:41." It is cheaper and faster, and there is no number to check.
A receipt sent **with a question** ("is this a lot of sweets?") is saved first. The
coach then answers as usual and can look up `itemSpend`.

## Item sub-categories

One flat list. The IDs are stable and stored in the database; only their labels are
translated. The vision model gets the IDs with a short gloss for each and must pick
one per line.

| Group | IDs |
|---|---|
| Food and drink from a shop | `produce`, `meat_fish`, `dairy_eggs`, `bread_bakery`, `pantry`, `frozen`, `ready_meals`, `snacks_sweets`, `soft_drinks`, `coffee_tea`, `alcohol`, `tobacco` |
| Eating out | `meal`, `restaurant_drinks`, `restaurant_alcohol`, `cafe_snack` |
| Other | `household`, `hygiene_beauty`, `pharmacy`, `baby`, `pet`, `clothing`, `electronics`, `fuel`, `other` |

Lines that are not items have their own `line_kind`: `item`, `deposit` (pantti),
`deposit_return`, `discount`. Discounts are spread over the items they follow,
or over the whole receipt when the receipt does not say. That way the item amounts
add up to the amount charged to the card.

## Changes by package

### `packages/shared`

**`receipts/types.ts` (new)**
```ts
export const ITEM_SUBCATEGORIES = [/* table above */] as const;
export type ItemSubcategory = (typeof ITEM_SUBCATEGORIES)[number];

export interface ReceiptRead {
  merchant: string;              // tidied, ≤ 60 chars
  mcc: string | null;            // guessed merchant type, one of mcc.json
  date: string | null;           // YYYY-MM-DD as printed
  time: string | null;           // HH:MM as printed
  total: number | null;          // euros, what was paid
  paidBy: "card" | "cash" | "unknown";
  items: { name: string; subcategory: ItemSubcategory; amount: number; lineKind: LineKind }[];
}
export interface MatchCandidate { txId: number; score: number; reasons: MatchReason[] }
export type MatchConfidence = "strong" | "possible" | "none";
```

**`agent/photo.ts`**: add `receipt` to `PHOTO_KINDS` and to the description in
`PHOTO_DECLARATION`. Today a receipt counts as `bill`. Only a shop or restaurant receipt
for something already paid becomes `receipt`.

**`agent/receipt.ts` (new)**: `readReceipt(model, image, signal)`. It follows the
pattern of `readPhoto`:
- a tool declaration with the schema above
- a system prompt that says text in the photo is data, not instructions, and that "12,90" means 12.9
- output checks: names tidied, at most 80 lines, amounts finite and between −1,000 and 10,000, sub-categories outside the list mapped to `other`

If the item amounts and the total differ by more than €0.05, the result is kept and
marked `itemsMismatch: true`. The UI shows that.

**`receipts/match.ts` (new, pure)**: `matchReceipt(read, tx, today, linkedTxIds)`
returns `{ confidence, candidates }`.

Candidate pool: card purchases (`transaction_type = 'purchase'`, outflow) dated from
the receipt date −1 day to +3 days, not already linked to another receipt, and on or
before `today`. A receipt dated after `today` gets `none` with the reason
`after_data_end`, and the card says so.

| Signal | Points |
|---|---|
| Amount equals total (±€0.01) | 50 |
| Amount within 2% of total (the bank charged a different amount) | 20 (otherwise the row is excluded) |
| Same day and time within 15 min | 30 |
| Same day and time within 2 h | 20 |
| Same day (or no time on receipt) | 10 |
| 1–3 days later (settlement delay) | 5 |
| MCC equal to the guessed one | 15 |
| Same category as the guessed MCC | 8 |
| Transaction has no MCC | 4 |

- `strong`: top score ≥ 80 and at least 15 points ahead of the second.
- `possible`: top score ≥ 55.
- `none`: anything else.

A `strong` match is linked when the receipt is saved; a `possible` one is offered and
waits for the user. In a fixture
customer's two years, only 37 of 706 purchase amounts occur more than once, so amount
plus a date window is almost always unique.

**`engine`**
- `types.ts`: `EngineContext` gets `receipts?: ConfirmedReceipt[]` (confirmed only).
  `TxFilter` gets `withReceipt?: boolean`. `Transaction` gets an optional `tx_id`.
- `functions.ts`: new function **`itemSpend`** with arguments `period`, `subcategory?`
  and `category?`. It returns one row per sub-category with sum, item count and number
  of shopping trips. `value` is the total, or the sub-category's amount when one is asked
  for. The `filter` is `{ ...period, withReceipt: true }`, so tapping a row opens the
  drawer with the payments behind it.
  - **Coverage is always part of the result**: `assumptions: ["From 9 receipts, which cover 31% of your Groceries and Restaurants spending in this period."]` and `rows[].coverage`. Without it, a sum from receipts would read as a full figure.
  - With no confirmed receipts in the period, the function returns an empty result with an assumption saying so. The coach then suggests sending receipts.
- `filterTransactions`: honour `withReceipt`.
- Add `itemSpend` to `ENGINE_FNS`, `args.ts` (validation), and the catalog / `ENGINE FUNCTIONS` prompt text with two example questions in each language.
- `agent/snapshot.ts`: when the customer has confirmed receipts, add one line: number of receipts, coverage, and the period they span. Do not add item sums. The coach looks them up when asked.
- `library/components.ts`: a `receipt_items` component on the existing `category_bars` template, with "What's in my grocery shopping?" as an example.
- Protected categories: `applyProtections` must treat `itemSpend` with a `category` like `spendBy`.

**Phase 2: `itemHabits`.** For one sub-category: share of trips that include it, a
weekday pattern, average per trip, and change between the first and second half of
the period. Same coverage rule. Build it only after `itemSpend` is in the demo.

### `packages/backend`

**`receipts.ts` (new)**: `ReceiptStore` interface, with `MemoryReceiptStore` for tests
and `SqliteReceiptStore` (`RECEIPT_DB`, default `data/out/receipts.sqlite`). Same
pattern as `profiles.ts`.

```sql
CREATE TABLE receipt (
  receipt_id   TEXT PRIMARY KEY,          -- random UUID
  customer_id  TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  merchant     TEXT NOT NULL,
  mcc          TEXT,
  receipt_date TEXT, receipt_time TEXT,
  total_eur    REAL,
  paid_by      TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('unmatched','confirmed')),
  tx_id        INTEGER,                   -- finance db transactions.tx_id
  match_score  INTEGER,
  items_mismatch INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX receipt_tx ON receipt(customer_id, tx_id) WHERE tx_id IS NOT NULL;
CREATE TABLE receipt_item (
  receipt_id  TEXT NOT NULL REFERENCES receipt ON DELETE CASCADE,
  line_no     INTEGER NOT NULL,
  name        TEXT NOT NULL,
  subcategory TEXT NOT NULL,
  line_kind   TEXT NOT NULL,
  amount_eur  REAL NOT NULL,
  PRIMARY KEY (receipt_id, line_no)
);
```

**`finance/engine.ts`**
- Select `tx_id` in `loadEngineContext`. The column already exists, so no database rebuild is needed.
- Receipts change, so they must not go into the cached context. `runEngineFor` / `ProtectedEngine.run` attach them on every call: `{ ...context, receipts: store.confirmed(customerId) }`.
- `transactionsFor` returns `tx_id` and a `hasReceipt` flag for each row.

**`chat.ts` / `shared/agent/chat.ts`**: when `photo.kind === "receipt"`, run
`readReceipt`, save it, match it, and return `receipt: ReceiptView` (the read, its id,
`confidence`, the top 5 candidates as `{ txId, date, time, amount, category, mcc }`).
`runChat` needs a hook (`onReceipt`) so the shared code does not know about the store.
Without words, skip the coach call and set `text: ""`. The app writes the reply from
`receipt`.

**Routes in `app.ts`**. Each route checks that the receipt belongs to the customer.
The chat rate budget covers reading; the rest is plain JSON.

| Route | Does |
|---|---|
| `GET /api/customers/:id/receipts` | List the customer's receipts, newest first, with items |
| `GET /api/customers/:id/receipts/:rid/candidates` | Run the matcher again (for "Choose another") |
| `POST /api/customers/:id/receipts/:rid/confirm` `{ txId }` | Link it. 409 if that payment already has a receipt |
| `POST /api/customers/:id/receipts/:rid/unlink` | Back to unmatched |
| `DELETE /api/customers/:id/receipts/:rid` | Delete the receipt and its items |

`server.ts`: open the store and pass it to `createApp`.

### `packages/app`

- **`sources/types.ts` / `api.ts`**: `receipts`, `receiptCandidates`, `confirmReceipt`, `unlinkReceipt` and `deleteReceipt` on `DataSource`. The fixture source throws "not available"; the UI checks `source.mode` and hides the receipt parts.
- **`ReceiptCard.tsx` (new)**: shown under the photo in the chat bubble.
  ```
  ┌───────────────────────────────────────┐
  │ Prisma Kamppi · 12.9.2026 17:41       │
  │ 12 items · 42,30 €                    │
  │ ▇▇▇▇▇ Produce 11,20  ▇▇▇ Sweets 6,40 …│
  │───────────────────────────────────────│
  │ Matches your card payment             │
  │ 12.9. 17:43 · Groceries · −42,30 €    │
  │ [ Confirm ]  [ Choose another ]       │
  └───────────────────────────────────────┘
  ```
  The card has four states: `strong` / `possible` (the wording differs: "Matches" vs "Might be"), choosing (candidate list plus "None of these"), confirmed, and none (with the reason, e.g. after the end of the data). The conversation in localStorage keeps the receipt id and status, not the items. An opened conversation fetches the current status.
- **`Chat.tsx`**: render the card. Update `chat.photoAdd` to mention receipts. After a confirm, refresh cards that use `itemSpend` (same path as other dashboard refreshes).
- **`TxDrawer.tsx`**: a receipt icon on rows with `hasReceipt`. Tapping expands the items, grouped by sub-category, with the mismatch note when set. Items are fetched once per drawer from the receipts list.
- **`Overview.tsx`**: a "Receipts" section with the 5 latest receipts and a status chip. Unmatched ones have a "Choose payment" button that opens the candidate list. **First to cut.**
- **`i18n.tsx`**: new `receipt.*` keys (card states, buttons, reasons, coverage line, aria-labels) and `subcategory.*` labels, in both `en` and `fi`. Add `useI18n().subcategory(id)` next to `category(id)`. Format amounts and dates with `format.ts`.
- **`agent/mockAgent.ts`**: the mock agent cannot read photos (`chat.photoUnsupported`). Add one localized reply for "what's in my grocery shopping" that points to sending receipts.

### `data/prep`: demo receipts

`build_demo_receipts.py` (new) takes a customer and a list of tx ids. It writes receipt
images (PNG, thermal-receipt look) whose total, date, time (2 minutes before the
payment) and shop type match each transaction. The items are made up to tell a story.
Suggested set for one fixture customer:

1. A Groceries payment (MCC 5411) with a clear sweets and soft-drinks share.
2. A Restaurants payment (5812) with alcohol.
3. A fuel-station payment (5542) with fuel plus snacks.
4. A grocery receipt dated after 2026-09-30, to show the "after the end of the data" state.

The same set doubles as an eval for `readReceipt`: what the model reads compared to
the known items.

Before the demo, confirm receipts 1–3 so `itemSpend` has data. Live, send one more.

## Tests

- `shared/receipts/match.test.ts`:
  - an exact match gives `strong`
  - a 2% difference gives `possible`
  - two equal amounts on the same day are told apart by time
  - an already linked transaction is skipped
  - a receipt after `today` gives `none`
  - a missing time still matches on the same day
- `shared/agent/receipt.test.ts`: a fake model's tool call is cleaned up correctly (bad sub-category → `other`, cap on lines, comma decimals, mismatch flag); a failed call returns an empty read and is not an error.
- `shared/engine/engine.test.ts`: `itemSpend` sums and coverage, `withReceipt` filter, an empty result without receipts, and protected categories.
- `backend/receipts.test.ts`: store round trip, the unique link, delete cascade.
- `backend/app.test.ts`: the routes, a receipt that belongs to another customer (404), and chat with a receipt photo via the fake model (no coach call without words).
- `app/Chat.test.tsx`: the card states and confirm. `i18n.test.ts` already checks that both languages have the same keys.
- Run `npm run typecheck` and `npm test` (AGENTS.md).

## Build order

| # | Step | Size |
|---|---|---|
| 1 | Types, sub-category list, `readReceipt` + tests | S |
| 2 | `matchReceipt` + tests | S |
| 3 | `ReceiptStore`, `tx_id` in context, routes | M |
| 4 | Chat path: receipt kind, `onReceipt`, `ReceiptView` in the reply | M |
| 5 | `ReceiptCard` in chat + i18n | M |
| 6 | `itemSpend` + coverage, snapshot line, catalog, library component | M |
| 7 | Demo receipts script + eval run | S |
| 8 | Drawer receipt view | S |
| 9 | Overview receipts list | S, cut first |
| 10 | `itemHabits` | M, cut second |

After step 7 the demo story works from start to finish: photo → match → confirm →
"how much of my grocery money goes on sweets?" with the coverage line.

## Risks

- **Reading quality** on long, crumpled or faded receipts. The staged receipts keep the demo safe. Treat real-world accuracy as a pitch point, not a demo claim.
- **Two vision calls per receipt** (kind, then items) add latency. If it is too slow, merge them: one call with both tools, where the model picks one.
- **Thin data.** A handful of receipts gives thin figures. The coverage line is the guard, and the coach prompt must say to mention coverage whenever it quotes an item figure.

## As built

All ten steps are in, including the Overview list. `itemHabits` (phase 2) is not built.
Where the code differs from the plan above:

- **Strong matches link automatically.** The card says "Linked automatically" and offers "Not this payment", which unlinks it and opens the list of payments to choose from.
- **The snapshot includes item sums** when the customer has linked receipts (`itemSpend` since the first receipt). The coach then answers most item questions in one call. With no receipts, the entry is left out.
- **`itemSpend` without a period covers everything since the first linked receipt.** The named periods count full months only, which would leave out this month's receipts.
- **One `ReceiptStore` class.** It runs on `":memory:"` in tests and on `RECEIPT_DB` (default `data/out/receipts.sqlite`) in the server. In Docker it lives in the existing `/profiles` volume (`RECEIPT_DB=/profiles/receipts.sqlite`), so the deployment needs no new volume.
- **The app shows receipts with the linked payment.** The list and confirm routes add a `payment` field.
- **Demo receipts are a printable HTML page, not PNGs.** The prep scripts use no third-party packages. They are in the repository: open [`docs/demo-receipts/index.html`](demo-receipts/index.html) in a browser and photograph a receipt from the screen or from paper. `python3 data/prep/build_demo_receipts.py` writes them again (the same customer always gives the same receipts). `expected.json` beside it lists every line, to compare with what the app read. By default it uses the first preset customer, CUST01700.
- **The item chart reuses `category_bars`.** Labels are translated by sub-category id, and tapping a bar opens the payments whose receipt has that kind of item. As on every other card, the engine's caption and assumptions are in English.
- **The stream cache is keyed by the transaction list.** The backend gives the engine a fresh context per call with the current receipts, and keying by context would have thrown the cache away each time.

Not yet checked: the photo → receipt path with the real Gemini model, and the screens in a
real browser. The tests use a stand-in model. Try it with the staged receipts before the demo,
and compare against `expected.json`.

