# mydata-finance

A personal finance coach for the S-Pankki "Personal Economic Trainer" challenge at
Junction 2026. People ask questions about their own banking data and get answers
they can inspect, in the spirit of MyData: their data, their questions, not charts
the bank picked for them.

> **Status: proposal.** This README describes a proposed starting direction and the
> options we have. Nothing here is decided. The choices that need all three of us
> are listed under [Open decisions](#open-decisions).

## The challenge in one paragraph

Build a mobile-first AI coach that lets people talk with their own money, using a
synthetic transaction dataset. S-Pankki wants the three spending baskets explained
(regular essentials, unexpected necessities, everyday spending), what-if scenarios,
and safe-to-spend and safe-to-save guidance. Judging is five criteria at 20% each:
impact on financial literacy, originality of the AI integration, clarity of the
mobile experience, feasibility, and potential to integrate into S-mobiili.

## What the data gives us

Profiled from the four CSVs; these facts shape the design.

- 3,626,755 transactions for 5,100 customers, one account each, from 2024-10-01 to
  2026-09-30. Every customer has the full 24 months, about 700 transactions.
- 15 categories and 8 transaction types. Card purchases carry one of 36 merchant
  category codes (MCC) and one of 515 synthetic merchant ids. There is no taxi
  category: taxis are MCC 4121 inside Transportation.
- Salary arrives once a month for everyone. Average income is €3,487 a month and
  average outflow €3,216. 26% of customers spend more than they earn on average,
  and 3,526 customers go below zero at some point.
- Nothing labels the three baskets. Housing is roughly monthly but the amount and
  day vary. Purchases of €500 or more cluster in Home & Tech, Lifestyle, Travel and
  Health.
- Investment deposits (1,500 customers) and salary sweeps (264 customers) are
  outflows but not spending. They should count as saving.
- Customers are 18 to 90 years old and all live in postal codes starting 00, 01 or
  02 (the Helsinki region), so benchmarks by age band and area are possible.
- 200 customers have a mortgage application, all linked to their transactions:
  150 approved and 50 rejected, with a rejection reason and a required monthly
  income for each.
- The data ends on 2026-09-30, so the demo needs a fixed "today". Proposal:
  mid-September 2026, which leaves two weeks of real data to check forecasts against.

## Proposed concept

Make the three baskets the terms of one equation instead of a chart:

```
safe to spend = balance
              − regular essentials still due before payday
              − a buffer for unexpected necessities
              − planned saving
```

Every question, what-if and goal moves that one number, and the coach explains
which term changed and why.

What should set us apart from a chat box on top of a pie chart:

1. **A derived "unexpected necessities" basket.** We detect each customer's large,
   infrequent purchases and turn them into a monthly buffer: "you cannot know when,
   but surprises have cost you about €X a month for two years."
2. **Numbers that are computed, tappable and backtested.** The model picks tools and
   never does arithmetic. Every figure opens the transactions behind it. We hide the
   last months, forecast them, and report how accurate the safe-to-spend rule was
   across all 5,100 customers.
3. **Mortgage readiness as the goal.** "Could I afford this flat, and what would I
   need to change?" uses the mortgage data most teams will ignore.
4. **Answers become the user's own screen.** Each answer is an interactive card
   (a what-if slider, a basket breakdown) that can be pinned to a personal home view.
5. **"What kind of spender am I?" from real cohorts.** Cluster the 5,100 customers
   and show percentiles against the same age band and postal area.
6. **Finnish first, in plain language**, with an English toggle.

Out of scope for now: the multi-bank (PSD2) view, beyond a slide.

## Suggested partitioning

How to turn raw transactions into the three baskets: apply the easiest, most
reliable signal first and let each step handle what the previous one cannot.

1. **Direction of flow.** Split on the sign of `tx_amount_eur`: inflows (salary,
   other income, invest withdrawals) vs outflows. Then split outflows into
   spending vs saving — investment deposits and salary sweeps are saving.
2. **Transaction type.** The 8 types classify almost everything except card
   purchases: `housing_payment` and `utilities_payment` are regular essentials,
   `investment_deposit` and `salary_sweep` are saving, `salary` and
   `other_income` are income. Only `purchase` rows need real classification.
3. **Recurrence on merchant id.** Group each customer's purchases by merchant
   and look for monthly-ish spacing with similar amounts. Recurring payments
   are essentials and subscriptions; large infrequent ones are unexpected
   necessities; the small frequent remainder is everyday spending. Match on
   merchant plus an approximate amount band — even rent varies in amount and day.
4. **Amount band as tiebreaker.** Purchases of €500 or more cluster in Home &
   Tech, Lifestyle, Travel and Health, so amount alone flags most surprises
   when a merchant's history is too thin for recurrence detection.
5. **MCC necessity class as fallback.** Group the 36 MCCs
   (`packages/shared/src/mcc.json`) into needs (groceries, pharmacies, fuel) and
   wants (restaurants, entertainment, travel) for purchases with no usable
   merchant history.
6. **Timing relative to payday.** Salary arrives monthly for everyone, so every
   transaction can be expressed as "day N after payday". Essentials cluster
   right after payday, and this is the basis for the safe-to-spend countdown.

Separate from baskets: partitioning customers into cohorts by age band and
postal area (00/01/02) powers the peer comparison.

The logic lives in data prep, not in the app: assign each transaction its
basket once in the Python stage and store it as a derived column, plus monthly
aggregates per basket, in each SQLite bundle. The app and the model then read
labels instead of computing them — deterministic, testable, and every figure
still opens the transactions behind it.

## Proposed stack

Rings are from the [SOK Tech Radar](https://s-group-dev.github.io/tech-radar/)
(version 2025.5). The radar is SOK's, so S-Pankki may differ, and it has no AI
entries at all.

| Layer | Proposal | Radar | Why |
|---|---|---|---|
| App | Mobile-first web app: Next.js + React + TypeScript | ADOPT | Judges open it on their own phones from a QR code. A web view embeds in S-mobiili whether it is React Native or native. |
| Styling | Styled components or CSS Modules | ADOPT / TRIAL | Tailwind is not on the radar. |
| API | Next.js route handlers in TypeScript, described with OpenAPI | ADOPT | One deployable for app and API. |
| Finance engine | Typed TypeScript functions: `spend_by`, `baskets`, `safe_to_spend`, `what_if`, `compare_to_peers`, `mortgage_readiness` | ADOPT (TypeScript, Node.js) | Deterministic and testable; the model only chooses which to call. |
| Free exploration | A read-only SQL tool, with the query shown to the user | — | Keeps the "every answer shows its work" idea from the first skeleton. |
| Database | PostgreSQL, one read-only role with row-level security per customer | Aurora is ADOPT | SQL written for Postgres ports to Aurora unchanged. |
| AI | One provider interface; model to be decided (see below) | not on radar | Lets us compare models on the same test questions. |
| Data prep | Python | ADOPT | CSV cleaning, recurring-payment detection, baskets, cohorts. |
| Tests | Jest, React Testing Library, ESLint, Prettier | ADOPT | |
| Deploy | One Docker container | ADOPT | Maps to ECS and Fargate. EC2 and Nginx are on HOLD. |

Production path for the pitch, not for the weekend: Lambda or Fargate, Aurora,
DynamoDB for sessions and pinned cards, Kinesis for proactive nudges, CDK, GitLab.
All of these are ADOPT.

## Open decisions

| Decision | Option A (proposed) | Option B | What decides it |
|---|---|---|---|
| App shell | Next.js web app, embedded as a web view | React Native with Expo, as in the first skeleton | Whether one of us has shipped React Native, and whether S-mobiili is React Native (ask the mentors). |
| Where data lives | Server-side Postgres | On the device in SQLite, with a stateless backend, as in the first skeleton | B has the stronger privacy story. A is faster to build, supports cohort benchmarks, and ports to Aurora. A middle path is SQLite in the browser for personal data plus a server for cohorts. |
| Model | Open-weight model hosted in Europe (Verda or NVIDIA Nemotron) | Claude through the Anthropic API | A fits two tech challenges and the "bank data stays in Europe" pitch. B is the safer choice for reliable tool calling. We can build behind one interface and test both. |
| API style | Plain route handlers + OpenAPI | GraphQL with Apollo | GraphQL is ADOPT and Apollo is TRIAL, but it is more setup than we need for a demo. |
| Tech challenges | Verda + Nemotron, ElevenLabs if time allows | Add Aiven and Oxylabs | How much time we have after the core demo works. |

## Tech challenges worth entering

Side challenges can be combined with the S-Pankki challenge. Shortlist:

| Challenge | Prize | Fit |
|---|---|---|
| Verda Compute | $10,000 in credits | Their brief names "open-weight models for a banking coach" as an example. Inference in Europe plus the 5,100-customer backtest as a batch job. |
| NVIDIA Nemotron | 2 × RTX 5080 | The model reads images and documents: photograph a bill or a flat listing and ask "can I afford this?". Free hosted API, about 40 requests a minute. |
| ElevenLabs | Earbuds | A voice mode: the coach speaks its answers. Low effort. |
| Aiven | €1,000 / €750 / €500 | Aiven PostgreSQL as our database. |
| Oxylabs | €1,000 voucher + credits | One live, cited lookup, such as today's Euribor in the mortgage what-if. |

To check at the booths: whether Verda's inference API serves Nemotron (one
integration would then cover both), and how ElevenLabs sounds in Finnish.

## Suggested first steps

A possible split for three people, to adjust when we talk:

1. **Data and finance engine.** Fix the prep script, load Postgres, detect recurring
   payments, assign baskets, compute safe to spend, build cohort aggregates.
2. **AI layer.** Provider interface, tool definitions, a set of test questions with
   known answers, the first model comparison.
3. **App.** Chat, answer cards, the pinned home view, Finnish and English.

First milestone for everyone: one customer asks "how much did I spend on taxis last
month?" and gets a correct number that opens the transactions behind it.

Questions for the S-Pankki mentors:

- Is S-mobiili React Native or native, and can it host an embedded web view?
- Is there any constraint on which model provider or cloud a real version could use?

## Repo layout

Current layout from the first skeleton. If we go with Next.js, `packages/app`
becomes the Next.js app and `packages/backend` the finance engine and AI layer.
`packages/voice` is the ElevenLabs voice service (TTS/STT); its handlers can be
re-exported as Next.js route handlers (`@mydata/voice`).

```
packages/
  app/       # App (empty for now)
  backend/   # Finance engine and AI layer (empty for now)
  voice/     # Voice service: ElevenLabs TTS/STT, standalone HTTP handlers
  infra/     # Infrastructure code (empty for now)
  shared/    # Dataset schema + shared types (the single source of truth)
data/
  raw/       # Local source CSVs (gitignored; see "Data" below)
  out/       # Generated per-customer SQLite bundles (gitignored)
  prep/      # Python: CSV → per-customer SQLite bundle
```

## Data

The source dataset lives in a separate repo:
`git@github.com:hackjunction/Junction-2026-S-pankki.git` (Git LFS required).

Download the four CSVs from there and place them in `data/raw/`. Both `data/raw/`
and the generated bundles in `data/out/` are gitignored. Build a per-customer
bundle with:

```bash
python3 data/prep/csv_to_sqlite.py --raw data/raw --out data/out/CUST00001.sqlite --customer CUST00001
```

The script needs Python 3.10 or newer and no extra packages. It streams the CSVs,
so one customer takes about two seconds. In the bundle:

- Tables are `transactions`, `customer`, `mortgage_outcomes` and `mortgage_events`
  (the last two are empty unless the customer has a mortgage application).
- Identifiers, postal codes and MCC codes are text, so `00990` and `5411` keep
  their form. Amounts are numbers. Blank source values are `NULL`.
- Timestamps are ISO 8601 (`2024-10-03T09:04:04`) instead of the source format
  (`03OCT24:09:04:04`), so they sort correctly.
- Transactions keep the source file order, which is also chronological; the
  running balance follows it.

If you read the CSVs yourself: they start with a UTF-8 BOM, so use `utf-8-sig`.

The meaning of each merchant category code is in `packages/shared/src/mcc.json`
(typed access through `lookupMcc` in `@mydata/shared`; Python can read the JSON
directly).

The enums in `packages/shared/src/schema.ts` (categories, transaction types,
mortgage event types, rejection reasons) have been checked against the data and
match exactly.

## Getting started

```bash
npm install          # installs workspace tooling (typescript)
npm run typecheck    # type-checks packages/shared
```
