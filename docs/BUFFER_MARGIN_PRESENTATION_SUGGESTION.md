# Suggested presentation of buffers and salary timing margins

## Product direction

Remove precautionary buffer and late-salary margin deductions from the main customer charts. Continue considering them when the coach recommends how much to spend or save, and make their effect available through an explanation.

A precaution is money the app recommends keeping available. It is not a transaction, a bill, or evidence that the customer has spent more than they earn. The interface should make that distinction clear without making the recommendations less cautious.

This suggestion follows the customer's concern about rows such as **Buffer for unexpected necessities −204 €** and **Margin in case your salary arrives late −157 €**. It supplements `COACH_UI_CLARITY_REVIEW.md` and can be considered independently of the wider layout changes.

## The customer problem

Showing these amounts beside rent, groceries and other outgoings makes all the rows look like expenses. The customer can interpret the resulting low or negative total as a cash-flow problem, even when the extra deductions are only precautions chosen by the app.

The current engine already distinguishes recorded activity from planning. `monthSoFar` uses recorded income, spending and savings transfers; it does not deduct these precautions. `safeToSpend` makes a conservative recommendation after allowing for them. The presentation needs to preserve this distinction across headlines, charts, captions and coach replies.

There is also a wording issue to inspect: `safeToSpend` can say that “commitments exceed your balance” when `p.available <= 0`, even though `p.available` already subtracts the buffer and late-salary margin. A shortfall caused only by precautions should not be described as uncovered commitments.

## Suggested customer experience

### Recorded income and spending

Use transaction-based amounts for weekly and monthly activity charts: money in, recorded spending, and savings transfers shown separately. Keep the period explicit and distinguish the period's net result from the current account balance.

Do not add buffer or late-salary amounts to recorded spending, category totals or a historical cash-flow chart. If an actual unexpected purchase happens, include that transaction normally. Removing the precautionary allowance from a chart must not remove the real purchase.

### Expected activity before payday

Show expected bills and ordinary living costs as estimates, separately from recorded activity. Label the baseline balance forecast as an estimate based on expected activity. A late-salary scenario or a possible unexpected expense should be an additional scenario, rather than a deduction that looks like an event that has already happened or will certainly happen.

Keep the calculation in the engine. If the current forecast mixes expected activity and precautionary deductions, give the renderer separate structured results before changing the chart. Do not produce a more optimistic line by deleting rows or adjusting amounts in the browser.

### Coach recommendations

Keep a compact recommendation such as **Suggested everyday spending until payday**, clearly labelled as an estimate. The coach can still allow for unexpected costs and salary timing when deciding what to suggest.

Replace the two negative precaution rows in the default view with a short explanation:

> This suggestion leaves some money available for unexpected costs and possible changes in payday.

Offer **How this suggestion was calculated** for the full breakdown. In that view, describe the amounts as **Money kept available for unexpected costs** and **Extra allowance for a later payday**. Explain that these are planning assumptions, not charges or payments. The detail view should show how they affect the recommendation, including any amount already covered by an existing reserve.

If a visible breakdown stops before these precautions, label its subtotal accurately and link to the recommendation calculation. Do not show a final recommendation that appears to be the sum of the visible rows when additional deductions are hidden.

## Explain low recommendations without suggesting false financial distress

Use different messages for different underlying conditions:

| Condition | Suggested explanation |
| --- | --- |
| Recorded spending exceeds recorded income for the selected period | Explain the actual difference and dates. Check salary timing before describing a continuing problem. |
| Expected bills and ordinary living costs exceed the available funds | Explain the estimated shortfall and which expected costs contribute to it. |
| Expected costs fit, but the extra precautions leave no recommended spending allowance | “Your expected costs fit within the available money. I suggest keeping the remainder available for unexpected costs.” |
| Money from earlier pay periods is excluded as an inferred reserve | Explain that the estimate leaves that money untouched and let the customer clarify how much is genuinely set aside. |

Avoid red deficit styling, “negative cash flow”, “you are overspending”, or “you will run out” when the only shortfall is in an additional precautionary allowance. Continue showing genuine recorded deficits and forecast shortfalls accurately; do not clamp them to zero to improve their appearance.

The recommendation itself may be zero when there is no extra spending room after precautions. Describe it as a recommendation rather than a negative account balance or a negative spending budget.

## Illustrative example

These invented figures describe one period ending at payday, with no additional reserve adjustment:

| Measure | Amount | Customer meaning |
| --- | --- | --- |
| Estimated money remaining after expected bills and ordinary costs | 500 € | A baseline forecast, before extra precautions |
| Extra money kept available for unexpected costs | 204 € | A planning allowance |
| Extra money kept available for a possible later salary | 157 € | A planning allowance |
| Suggested everyday spending until payday | 139 € | The conservative recommendation after both allowances |

The main view could show **Suggested everyday spending until payday: 139 €**, with the short explanation and calculation link. It should not say the customer spent an additional 361 €, or label the 139 € as their forecast account balance.

The amounts above illustrate presentation only. In the actual engine, an existing reserve can already cover some or all of the precautions, so their full values must not automatically be deducted again.

## Implementation suggestions for the agent

1. Keep recorded activity, expected activity and coach recommendations as distinct measures. Share their definitions between the UI and coach so the same number receives the same meaning everywhere.
2. Remove the precautionary deduction rows from the default card and chart presentation, while retaining their effect in the recommendation and their explanation in the detail view.
3. Prefer structured fields for expected costs, precaution amounts, reserve coverage and recommendations. Avoid filtering English row labels to determine financial meaning. Preserve existing consumers if the data contract is extended.
4. Check `safeToSpend`, `safeToSave`, balance forecasts, goal feasibility and purchase advice for wording or visuals that treat a precautionary shortfall as an actual financial shortfall. Preserve their existing protective calculations unless a separate engine change is agreed.
5. Calculate the precautions for their intended planning period once. Weekly and monthly presentations should not each imply a new bill or apply the full allowance repeatedly. Keep the existing treatment of reserve coverage and avoid counting it twice.
6. Give the coach the relevant engine results and reason for a low recommendation. It should explain which condition applies instead of inferring distress from a negative intermediate value. It must not calculate new financial figures itself.
7. Keep the same treatment for template charts, generated charts and widgets. A custom visual must not reintroduce precaution amounts as recorded spending.

Relevant starting points are `packages/shared/src/engine/functions.ts` (`plan`, `safeToSpend`, `safeToSave`, `balanceForecast`, `monthSoFar` and purchase advice), `packages/shared/src/library/catalog.ts`, `packages/app/src/BlockCard.tsx`, and the shared agent snapshot and prompt code. Inspect the current versions before changing them, as other implementation work may already address some of this.

## Acceptance checks

- Main spending charts contain actual transactions, with no extra buffer or late-salary expense categories.
- The coach still considers both precautions when making spending and saving recommendations.
- A customer can discover why the recommendation is lower than the baseline amount and reconcile the full calculation.
- A positive baseline with insufficient extra precautionary headroom does not become an “overspending” or “negative cash flow” message.
- Actual deficits and estimated uncovered bills remain visible and are described accurately.
- A zero recommendation is understandable without implying that the bank account is empty.
- Reserve coverage and weekly versus monthly allocation do not cause the same precaution to be counted twice.
- Existing controls, customer preferences, protected categories and transaction evidence continue working.

Only the documentation changes with this suggestion. The application and its financial calculations are unchanged.

## Status

Added when the suggestion was implemented (14 Nov 2026). The text above is the suggestion as it was written; its last line described the state before this change.

| Point | What was done |
|---|---|
| Precautions out of the default view | The safe-to-spend card lists recorded and expected amounts up to a subtotal, "Left of this pay period's money after expected costs". A sentence says some money is kept available. The two allowances and the final figure are under "How this suggestion was calculated", with a line saying they are planning assumptions, not charges. |
| Structured fields, no label matching | Every row of `safeToSpend` and `safeToSave` has a `kind` (`balance`, `reserve`, `expected`, `subtotal`, `precaution`, `result`). A precaution row also has `planned` and `coveredByReserve`. The card and the coach go by `kind`. |
| Names | "Money kept available for unexpected costs" and "Extra allowance for a later payday", also in purchase advice. |
| Low figures explained by cause | Four captions: expected costs exceed the account (a real shortfall, with its size); this period's money is used and more would come from the reserve; expected costs fit and the rest is kept for the unexpected; room to spend. "Commitments exceed your balance" is gone. |
| Reserve coverage, no double counting | Unchanged in the calculation. Each precaution row says how much of it the reserve covers, and the card shows that. |
| The coach | Told that precaution rows are planning allowances, never bills or spending, that a zero suggestion does not mean an empty account, and to say which of the causes applies. |
| Charts | Nothing to change: `monthSoFar` and the spending charts use recorded transactions only, and the balance forecast is a best estimate without the precautions. |

Not done:

- The card is still called "Safe to spend", not "Suggested everyday spending". That is the challenge brief's own term ("What is safe for me to spend this week?"); the card carries the "Estimate" badge.
- No separate late-salary or unexpected-expense scenario line in the balance forecast.
- The engine's row labels and captions are in English only. The card's own new texts are in English and Finnish.
- The animated widgets that walk through the calculation list every row, including the allowances, under their new names.

The figures did not change: the same amounts come out for every customer as before.
