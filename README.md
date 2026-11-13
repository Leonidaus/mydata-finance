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

## Stretch goal: multi-bank view

The challenge lists this as an optional bonus: under PSD2, customers can let their
bank fetch account data from other banks, so how could an AI coach use the full
financial picture? It asks for the idea, not for a live bank connection. We build it
only after the core demo works.

**What we would show.** A "link another bank" consent screen and a second account
at a simulated bank, clearly labelled as simulated. Our data has a natural hook:
every customer has one account, and 1,500 customers make investment deposits and
264 make salary sweeps to somewhere we cannot see. The simulated bank is where that
money lands. With it, the coach can show:

- a true savings rate, because those outflows turn out to be saving, not spending
- a safe-to-spend number that uses balances and upcoming bills across all accounts
- a buffer measured in months of essentials across everything the user owns
- things hidden elsewhere, such as a loan or duplicate subscriptions
- a stronger mortgage-readiness answer, since equity saved elsewhere counts

**What we would build.**

- A connector interface that turns any bank's accounts and transactions into our
  schema, with a field for which bank each row came from. Worth defining early,
  even if only the S-Pankki data sits behind it at first.
- A categoriser for transactions from other banks, which will not carry S-Pankki's
  categories: the MCC table in `packages/shared` first, the model for free text.
- Matching of transfers between the user's own accounts, so they do not count as
  spending.

**What we would not build.** Real PSD2 access needs a licensed account information
provider, consent and strong authentication at each bank, and real accounts on
stage. In production S-Pankki would be the licensed party. If we want a real API
behind the demo, the Finnish aggregator Enable Banking has a sandbox that covers
Finnish banks including S-Pankki; that is about half a day of work. GoCardless
Bank Account Data (formerly Nordigen) is reported closed to new sign-ups.

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

## Branches

- `main` is always demo-ready. It only receives merges from `develop`.
- `develop` is the integration branch. Start new work from it and open pull
  requests into it.
- Work happens on short-lived branches named `feature/<short-name>`, for example
  `feature/safe-to-spend`.

```bash
git switch develop && git pull          # start from the latest develop
git switch -c feature/<short-name>      # do the work, commit
git fetch origin && git rebase origin/develop
git push -u origin feature/<short-name>
gh pr create --base develop             # or open the pull request on GitHub
```

Keep pull requests small and merge them quickly; a teammate's quick look is enough.
We merge `develop` into `main` whenever a demoable milestone works.

Until the repository's default branch is changed to `develop`, GitHub proposes
`main` as the target of a new pull request. Pick `develop` as the base.

## Repo layout

Current layout from the first skeleton. If we go with Next.js, `packages/app`
becomes the Next.js app and `packages/backend` the finance engine and AI layer.

```
packages/
  app/       # Vite + React web app, mobile-first
  backend/   # Finance API: Node + TypeScript server over the SQLite database
  infra/     # Infrastructure code (empty for now)
  shared/    # Dataset schema + shared types (the single source of truth)
data/
  raw/       # Local source CSVs (gitignored; see "Data" below)
  out/       # Generated databases (gitignored)
  prep/      # Python: CSV → application database, or a per-customer bundle
```

## Data

The source dataset lives in a separate repo:
`git@github.com:hackjunction/Junction-2026-S-pankki.git` (Git LFS required).

Download the four CSVs from there and place them in `data/raw/`. Both `data/raw/`
and everything generated in `data/out/` are gitignored.

Build the application database, which the backend reads:

```bash
python3 data/prep/build_database.py --raw data/raw --out data/out/finance.sqlite
```

This takes about 20 seconds and writes a 665 MB file with all 5,100 customers. On
top of the four source tables it adds a basket label on every transaction, a
monthly summary per customer, per-customer averages, and percentiles per cohort
(age band and postal area). `--today` sets the demo's fixed current date (default
`2026-09-15`); the summaries ignore later transactions.

To extract a single customer into a small bundle instead:

```bash
python3 data/prep/csv_to_sqlite.py --raw data/raw --out data/out/CUST00001.sqlite --customer CUST00001
```

Both scripts need Python 3.10 or newer and no extra packages. In a bundle:

- Tables are `transactions`, `customer`, `mortgage_outcomes` and `mortgage_events`
  (the last two are empty unless the customer has a mortgage application).
- Identifiers, postal codes and MCC codes are text, so `00990` and `5411` keep
  their form. Amounts are numbers. Blank source values are `NULL`.
- Timestamps are ISO 8601 (`2024-10-03T09:04:04`) instead of the source format
  (`03OCT24:09:04:04`), so they sort correctly.
- Transactions keep the source file order, which is also chronological; the
  running balance follows it.

The web app currently runs without a backend on demo fixtures (3 personas plus 12 random
customers, cut at the demo "today" 2026-09-15, plus peer averages by age band). They are
committed under `packages/app/public/fixtures/`; rebuild them with:

```bash
python3 data/prep/build_fixtures.py --raw data/raw --out packages/app/public/fixtures
```

If you read the CSVs yourself: they start with a UTF-8 BOM, so use `utf-8-sig`.

The meaning of each merchant category code is in `packages/shared/src/mcc.json`
(typed access through `lookupMcc` in `@mydata/shared`; Python can read the JSON
directly).

The enums in `packages/shared/src/schema.ts` (categories, transaction types,
mortgage event types, rejection reasons) have been checked against the data and
match exactly.

## Basket rules (version 1)

Assigned in one place, `classify` in `data/prep/build_database.py`, and stored on
each transaction as `flow`, `basket` and `basket_rule`. They are a first version,
to adjust when S-Pankki tells us how they define the baskets.

| Transaction | Flow | Basket |
|---|---|---|
| Salary, other income | income | — |
| Investment deposit, salary sweep | saving | — |
| Investment withdrawal | saving withdrawal | — |
| Housing, utilities | spending | essential |
| Groceries | spending | essential |
| Transportation, except taxis | spending | essential |
| Taxis (MCC 4121) | spending | everyday |
| Health under €100 | spending | essential |
| Health of €100 or more | spending | unexpected |
| Home & Tech of €500 or more | spending | unexpected |
| Home & Tech under €500 | spending | everyday |
| Restaurants, Entertainment, Lifestyle, Travel | spending | everyday |

With these rules the average customer spends €1,905 a month on essentials, €170 on
unexpected necessities and €844 on everyday spending, and saves €298.

Recurring payments cannot be detected per merchant in this dataset: no customer
pays the same merchant a steady amount month after month. What recurs is visible
from the transaction type alone (housing, utilities, salary, investment deposits).

## Backend

`packages/backend` is a small read-only API over `data/out/finance.sqlite`. Build
the database first (see Data), then:

```bash
npm install
npm run dev -w @mydata/backend     # http://localhost:8787, restarts on changes
npm test                           # engine and backend tests; the backend ones use a small built-in fixture
```

It uses Node's built-in SQLite driver, which prints an "experimental" warning on
Node 22. `PORT` and `FINANCE_DB` override the port and the database path. All
answers are cut off at the demo's "today", so later transactions never appear.

| Endpoint | Returns |
|---|---|
| `GET /api/health` | Row counts and the demo's today |
| `GET /api/customers?limit=20&mortgage=true` | Customer profiles, for a customer picker |
| `GET /api/customers/:id` | Profile, current balance, monthly averages per basket |
| `GET /api/customers/:id/summary?months=12` | Month-by-month income, baskets, saving and balance |
| `GET /api/customers/:id/spending` | Total spent, with the transactions behind it |
| `GET /api/customers/:id/engine/:fn` | One finance engine function, arguments in the query string |
| `POST /api/data` | A dashboard block's data request: `{ customerId, data: { kind: "engine", fn, args } }` |
| `POST /api/transactions` | The transactions behind an engine result: `{ customerId, filter, limit }` |

The spending endpoint takes `period` (`this_month`, `last_month`, `last_30_days`,
`last_3_months`, `last_12_months`, `this_year`, `all`) or `from` and `to`, and the
optional filters `category`, `mcc` and `basket`. `groupBy` (`category`, `mcc`,
`basket`, `month`) adds a breakdown, and `limit` caps the transactions returned.
"How much did I spend on taxis last month?" is:

```bash
curl 'http://localhost:8787/api/customers/CUST04488/spending?mcc=4121&period=last_month'
```

The engine endpoints run the finance engine from `packages/shared/src/engine` for
any of the 5,100 customers: `spendBy`, `monthlyTrend`, `baskets`, `safeToSpend`,
`balanceForecast`, `whatIf`, `peerCompare`, `dailySpend`, `recurring` and
`goalProgress`. The app runs the same engine on its 15 fixture customers; for those
customers the backend gives identical results for every function.

```bash
curl 'http://localhost:8787/api/customers/CUST03004/engine/safeToSpend'
curl 'http://localhost:8787/api/customers/CUST03004/engine/whatIf?category=Restaurants&cutPct=20'
```

SQL data requests (`kind: "sql"`) are not supported yet and answer 501.

Two basket definitions exist for now and still need to be unified. The engine
(`basketOf` in `packages/shared/src/engine/streams.ts`) uses regular / irregular /
everyday, with groceries and transport as everyday and a per-customer threshold for
irregular purchases. The database labels and the `spending` and `summary` endpoints
use the rules in the section above.

The functions behind the endpoints take plain objects and return plain JSON, so
they can be given to the model as tools unchanged.

## Getting started

Node version is pinned in `.nvmrc` (Node 26 LTS), and `.npmrc` sets `engine-strict` so installs fail fast on an old Node.
Use any version manager that reads `.nvmrc`; [fnm](https://github.com/Schniz/fnm) is recommended (Linux, macOS, Windows):

```bash
curl -fsSL https://fnm.vercel.app/install | bash
# in ~/.bashrc, so fnm switches Node automatically when you cd into the repo:
eval "$(fnm env --use-on-cd --shell bash)"
fnm install            # installs the version from .nvmrc
```

Then:

```bash
npm install
npm run dev          # web app on http://localhost:5173 (add `-- --host` to test on a phone, trusted networks only)
npm run dev -w @mydata/backend   # finance API on http://localhost:8787 (build the database first)
npm run typecheck    # type-checks shared, app and backend
npm run build        # production build of the app
npm test             # finance engine, backend and app data-layer tests (vitest)
```

### Data source modes

The web app reads everything through one data contract (`packages/app/src/sources/types.ts`)
with two implementations, chosen with `VITE_DATA_SOURCE` when Vite starts or builds:

- `api` (default): the backend's `/api`, so all 5,100 customers work and the engine runs on
  the server. It is the default because it is the integrated path the demo uses. Start the
  backend as well; without it the app shows an error with a retry button.
- `fixtures`: the 15 static demo customers with the engine in the browser. No backend or
  database needed: `VITE_DATA_SOURCE=fixtures npm run dev`.

In API mode the app calls `/api` on its own origin, and the Vite dev and preview servers
forward that to `http://localhost:8787` (`API_PROXY_TARGET=http://localhost:9000 npm run dev`
forwards elsewhere). To call a backend directly instead, set `VITE_API_BASE`, for example
`VITE_API_BASE=http://localhost:8787`. Both variables can also go in
`packages/app/.env.local`; see `packages/app/.env.example`. The customer picker lists the
fixture personas and pool in both modes.
