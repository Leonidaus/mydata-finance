# Architecture review and implementation handoff

The current architecture is feasible for the Junction S-Pankki demo. Keep React,
TypeScript, Hono, the shared finance engine and SQLite. The immediate priorities
are consistent financial definitions, frontend integration and actual AI tool
calling. The items below are engineering recommendations for the implementation
agent to consider, rather than additional sponsor requirements.

Challenge reference: [master brief](../../Junction-2026-S-pankki/S_Pankki_Personal_Economic_Trainer_Master_Brief.md).
The brief may be absent when this application repository is cloned on its own.

## Status on 14 November 2026

This review was written on 13 November. Most of it has since been acted on; the
sections below are kept as written, for the reasoning behind the changes.

| Item | Status | Where |
| --- | --- | --- |
| 1 Unify basket classification | Done | #5. One rule set, groceries as a regular essential; engine and database agree for 300 customers over 3 periods. |
| 2 Connect the frontend to the existing API | Done, not yet checked in a real browser | #8. API mode is the default, fixture mode is explicit; the customer-switch race is fixed. |
| 3 Implement chat and validate its outputs | Open | Engine arguments are validated (#5). The chat endpoint and model tool calling wait for the provider decision. |
| 4 Validate financial estimates and argument boundaries | Done | #5 and #6. Net, peer windows and goal targets fixed; safe to save added; backtest on all customers. |
| 5 Data boundary and deployment path | Done for the demo | #7. Docker image, small demo database, "Demo boundary" in the README. Not hosted anywhere yet; no authentication, by agreement with S-Pankki. |
| 6 Scope and documentation | Done | #7. README and TODO match the code. The Finnish-first interface is still a gap. |

Numbers quoted below (for example the `CUST01700` basket table and "44 tests") describe
the state before these changes.

## Current implementation

| Layer | What exists |
| --- | --- |
| Frontend | Vite/React, Vega-Lite template charts, configurable cards, transaction drawers, dashboards persisted in localStorage. Runs on 15 customer fixtures. |
| Finance services | Ten deterministic functions in `packages/shared/src/engine/`, returning structured results and transaction filters for evidence. |
| Backend | Hono, read-only SQLite, customer profiles, monthly summaries and spending routes. Also exposes shared engine functions through `GET /api/customers/:id/engine/:fn`, `POST /api/data`, and evidence through `POST /api/transactions`. |
| Data | Python imports all 5,100 customers and 3,626,755 transactions, classifies transactions and builds summaries and cohorts. Demo today is `2026-09-15`. |
| AI | Browser keyword rules in `packages/app/src/agent/mockAgent.ts`. No model integration or `/api/chat` endpoint. |
| Deployment | `packages/infra` is a placeholder. No Docker or CI deployment configuration was found. |

The frontend still uses fixtures and local calculations even though backend
engine endpoints now exist. Do not recreate those endpoints. SQL requests return
501, and custom chart specs and widget code are deferred in the renderer.

## Resolve before the integrated demo

### 1 Unify basket classification

**Confirmed inconsistency.** Python assigns `essential`, `unexpected`, `everyday`
using categories and fixed thresholds. TypeScript assigns `regular`, `irregular`,
`everyday` using recurring streams and customer-relative thresholds. Groceries and
non-taxi transport generally become everyday spending in the shared engine, but
essentials in the database. Large Lifestyle and Travel purchases can become
unexpected necessities only in the shared engine. Renaming the basket keys alone
will not reconcile these policies.

Observed for `CUST01700`, June through August 2026:

| Basket | Shared engine and frontend | Database spending endpoint |
| --- | ---: | ---: |
| Regular / essential | €2,414.05 | €6,484.34 |
| Irregular / unexpected | €1,474.77 | €277.03 |
| Everyday | €6,093.71 | €3,221.16 |
| Total spending | €9,982.53 | €9,982.53 |

Choose one policy, vocabulary and rule version for transaction classification,
summaries, cards, evidence and planning. Regenerate derived data after changes.
Preserve explanations for ambiguous classifications; amount or recurrence alone
does not establish that a purchase was necessary.

Sources: [Python rules](../data/prep/build_database.py),
[shared rules](../packages/shared/src/engine/streams.ts),
[database spending service](../packages/backend/src/finance/spending.ts).

Acceptance: the same customer and period produce matching basket totals across
all paths, and each basket drill-down reconciles to its displayed total.

### 2 Connect the frontend to the existing API

`packages/app/src/data.ts` fetches static fixtures and runs the shared engine
locally. `BlockCard.tsx` and `TxDrawer.tsx` assume synchronous access to the full
customer context. Move data requests and evidence retrieval behind an async data
adapter using the existing API. Add loading, failure and retry states, cancellation
or stale-response guards, and an explicit API base URL or same-origin routing.
If fixture mode remains useful, make it an explicit mode using the same contract.

There is also a customer-switch race in `App.tsx`: an older `loadContext()` promise
can overwrite the context for the newly selected customer. Clear stale errors and
drawers when switching, and prevent responses or chat operations for one customer
from being applied to another customer's dashboard.

Acceptance: the taxi question, its chart, controls and evidence work against the
backend; rapid customer switching cannot display another customer's stale result.

### 3 Implement chat and validate its outputs

Replace the keyword mock with a backend chat endpoint and one provider adapter.
Keep finance arithmetic in the deterministic engine. Define schemas for tool
arguments, `DataRequest`, `DashboardOp` and saved blocks; TypeScript casts do not
validate model responses, JSON requests or localStorage. The backend currently
checks the engine function name and that args are an object, but does not enforce
each function's argument schema. Use the existing template catalog initially.

Chat currently returns a string synchronously. Adapt it for async replies,
conversation context, pending/error states, bounded tool execution and invalid
model outputs. Produce numerical explanations from verified tool results and
ensure the explanation, card and evidence agree. Keep provider credentials on
the server.

Acceptance: real model calls answer the challenge's taxi, safe-to-spend, spender
profile and restaurant reduction questions using tools, with recoverable provider
errors and no invented financial figures.

### 4 Validate financial estimates and argument boundaries

- **Forecast accuracy:** existing tests check arithmetic and structure, not
  predictive reliability. Backtest at rolling dates using only information known
  at each date, including stream detection and thresholds. Report forecast error
  and cases where a recommended allowance would exhaust the balance. The default
  September 15 cutoff can forecast into October, beyond the September 30 dataset
  end; use earlier cutoffs for complete validation horizons.
- **Planning assumptions:** explain inferred payday, upcoming bills, irregular
  buffer and planned saving. Distinguish the balance before payday income from
  the balance after it; the current forecast does not add salary on its endpoint.
  Safe-to-save is still a feature gap.
- **Goals:** `goalProgress({ target: 0 })` produces a non-finite percentage, which
  serializes as `null`. Reject invalid targets and cover empty or short histories.
  Cumulative net investment/saving transfers assume an opening balance of zero
  and do not establish current assets or money allocated to a particular goal.
  State that assumption or collect an explicit goal balance and allocation.
- **Peer comparison:** personal spending uses 12 full months, while fixture peers
  and current database cohorts use 23. Align windows and zero-spend handling, and
  show the benchmark period and synthetic population. These are synthetic peers,
  not a representative Finnish population benchmark.
- **Net cash flow:** `monthlyTrend(metric: "net")` excludes saving transfers,
  while the database monthly summary sums all signed amounts. Choose a meaning
  for net, label it clearly, and make chart evidence reconcile with that meaning.

Sources: [engine functions](../packages/shared/src/engine/functions.ts),
[fixture benchmark generation](../data/prep/build_fixtures.py),
[database summaries](../data/prep/build_database.py).

Acceptance: finite results for valid inputs, explicit errors for invalid inputs,
matching comparison periods, and measured forecast behavior beyond the three demo
personas. The sponsor supplies no official safe-to-spend formula.

## Resolve for deployment and subsequent work

### 5 Establish the data boundary and deployment path

The current API accepts the requested customer ID without authentication, permits
all origins, and opens the full database read-only. Static fixture files are
public assets. This is a synthetic demo arrangement, not private on-device
storage or production customer isolation. Choose and describe the demo boundary.
Before using real customer data, bind access to authenticated identity, scope all
tools and evidence accordingly, restrict origins, and define what reaches the
model. A read-only database does not enforce customer authorization.

For the demo, one backend deployment with logical finance and chat modules is
sufficient. Provide a reproducible database build/provisioning step, static app
hosting, API routing and backend startup configuration. The SQLite file is about
665 MB decimal / 635 MiB and is intentionally gitignored. Keep `data/raw/` and
`data/out/` ignored while tracking prep scripts. Public synthetic demo fixtures
are currently committed separately under the app.

SQLite handled the sampled workload comfortably. The synchronous Node driver
blocks the event loop during a query, so keep customer queries bounded and measure
concurrency before making scaling claims. PostgreSQL/Aurora is a possible later
choice if deployment or workload requires it; migration is not a demo prerequisite.

### 6 Keep scope and architecture documentation accurate

- Preserve the shared engine, evidence filters and replaceable chart renderer.
  Arbitrary SQL, model-written widget code, live PSD2 and mortgage readiness should
  follow a working core demo. Mortgage data and a down-payment goal exist, but a
  mortgage-readiness service is not implemented.
- Preserve account IDs when replacing fixtures. The fixture adapter currently
  sets `bank_account_id` to an empty string and balance logic assumes one account.
  Multiple accounts need transfer matching and account-aware balances.
- Reconcile `README.md` and `TODO.md` with implementation. They mix Next.js,
  PostgreSQL and on-device proposals with the actual Vite/Hono/SQLite system, and
  mark several implemented calculations as unstarted. Finnish-first UI and the
  proposed English toggle are also still gaps.
- Keep Vega-Lite unless a concrete integration requirement warrants changing it.
  React, TypeScript, Node.js, REST, AWS and Lambda have historical public evidence
  in an S-Pankki digital platform team. Vega, Hono, Vite, Vitest and SQLite have
  not been confirmed as S-Pankki choices. The SOK radar describes SOK's environment;
  it is not proof of every S-Pankki team's stack.

Public references: [SOK vacancy for the S-Pankki platform, approximately four years old](https://fi.linkedin.com/jobs/view/fullstack-engineer-s-pankki-at-sok-2973663776),
[SOK Tech Radar](https://s-group-dev.github.io/tech-radar/),
[SQLite deployment guidance](https://www.sqlite.org/whentouse.html),
[Node SQLite documentation](https://nodejs.org/api/sqlite.html).

## Verification baseline and suggested sequence

The latest architecture-review run passed `npm test` with **44 tests**,
`npm run typecheck`, and `npm run build`. An earlier mixed test-runner failure was
resolved during the review; the backend now uses Vitest. In-process checks against
the real database exercised the spending and shared-engine endpoints. A sample
of 100 sequential spending requests measured about **0.45 ms median / 0.96 ms p95**;
this excludes network latency and concurrent load. Phone usability, deployed
behavior, model quality and forecast accuracy remain to be verified.

Suggested order: unify financial definitions; connect the frontend; implement
validated AI tool calling; backtest planning; deploy and verify the complete flow
on a phone. Add focused regression checks for the inconsistencies above rather
than relying on arithmetic-only tests or the selected personas.
