# mydata-finance

A personal finance coach for the S-Pankki "Personal Economic Trainer" challenge at
Junction 2026. People ask questions about their own banking data and get answers
they can inspect, in the spirit of MyData: their data, their questions, not charts
the bank picked for them.

> **Status: working prototype.** The app, the finance engine, the database build and
> the API exist and are tested. The chat still uses keyword rules, not a language
> model. See [Where things stand](#where-things-stand) for what is done and what is
> next.

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

What was built from this: steps 1, 2, 4 and 5 are the rules in
[Basket rules](#basket-rules), assigned in data prep and stored on each transaction
as proposed. Step 3 found nothing in this dataset, since no customer pays one
merchant a steady amount month after month. Step 6 is the payday logic behind safe
to spend; see [Backtest](#backtest) for how well it holds.

## Stack

What the prototype is built with. Rings are from the
[SOK Tech Radar](https://s-group-dev.github.io/tech-radar/) (version 2025.5). The
radar is SOK's, so S-Pankki may differ, and it has no AI entries at all.

| Layer | What we use | Radar |
|---|---|---|
| App | Vite + React + TypeScript, mobile-first, Vega-Lite charts | React and TypeScript are ADOPT; Vite and Vega are not listed |
| Finance engine | Pure TypeScript functions in `packages/shared`, used by both app and backend | ADOPT (TypeScript) |
| API | Hono on Node.js, read-only | Node.js is ADOPT; Hono is not listed |
| Database | One SQLite file with all customers, built by Python | not listed; Aurora would be the ADOPT choice in production |
| Data prep | Python, standard library only | ADOPT |
| Tests | Vitest | not listed; Jest is the ADOPT choice |
| Deploy | One Docker container serving the API and the built app | ADOPT (Docker) |
| AI | Not connected yet; the chat is a keyword mock | not on the radar |

Production path for the pitch, not for the weekend: Lambda or Fargate, Aurora,
DynamoDB for sessions and pinned cards, Kinesis for proactive nudges, CDK, GitLab.
All of these are ADOPT.

## Decisions

Settled:

| Decision | Outcome |
|---|---|
| App shell | Web app (Vite + React), not React Native. S-Pankki said where the feature would live in S-mobiili is not our concern. |
| Where data lives | On the server, in SQLite. S-Pankki said data location and what the model may read are out of scope for the hackathon. The app can also run on 15 bundled fixture customers. |
| Basket rules | One rule set, with groceries as a regular essential. See [Basket rules](#basket-rules). |
| API style | Plain JSON routes, no GraphQL. |
| Branches | Feature branches into `develop`; `main` only from `develop`. |

Still open:

| Decision | Options | What decides it |
|---|---|---|
| Model for the chat | Claude through the Anthropic API, or an open-weight model (NVIDIA Nemotron, Verda) | Which API keys we have and which tech challenges we enter. Planned for 14 November. |
| Interface language | Finnish first with an English toggle, or English only | Time left once the chat works. |
| Tech challenges | Verda + Nemotron, ElevenLabs, Aiven, Oxylabs | Time left after the core demo. |
| Safe-to-spend cushion | Spend down to zero (now), or always keep a fixed cushion | Many customers hold large balances; see [Backtest](#backtest). |

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

## Where things stand

Done:

- Database build with basket labels, monthly summaries and peer cohorts for all
  5,100 customers.
- Finance engine with eleven functions, including safe to spend, safe to save,
  what-if, forecast, peer comparison and goals. Every result carries a filter for
  the transactions behind it, and estimates carry their assumptions.
- API over the database: the engine for any customer, plus spending and summaries.
- App with configurable cards, charts and transaction drill-downs.
- A backtest of the forecast and safe to spend on all customers.

Next, in order:

1. Connect a language model to the chat: a server endpoint that lets the model call
   the engine functions as tools. The engine already checks every argument.
2. Add an app card for safe to save.
3. Deploy (see [Deploy](#deploy)) and test the whole flow on a phone.
4. Stretch: mortgage readiness, the multi-bank view, a voice mode, read-only SQL
   exploration.

Not planned for the hackathon: authentication, per-customer access control and
restricting which origins may call the API. See [Demo boundary](#demo-boundary).

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

## Basket rules

One rule set decides which of the three baskets a spending transaction falls in. It
is applied in data prep (`classify` in `data/prep/build_database.py`), which stores
`flow`, `basket` and `basket_rule` on each transaction in the database and in the
app's fixtures. The finance engine reads that label; for a transaction without one it
applies the same rules in TypeScript (`packages/shared/src/engine/baskets.ts`). A
test checks on every fixture transaction that the two agree. Change both together.

| Transaction | Flow | Basket |
|---|---|---|
| Salary, other income | income | — |
| Investment deposit, salary sweep | saving | — |
| Investment withdrawal | saving withdrawal | — |
| Housing, utilities | spending | regular |
| Groceries | spending | regular |
| Transportation, except taxis | spending | regular |
| Taxis (MCC 4121) | spending | everyday |
| Health under €100 | spending | regular |
| Health of €100 or more | spending | irregular |
| Home & Tech of €500 or more | spending | irregular |
| Home & Tech under €500 | spending | everyday |
| Restaurants, Entertainment, Lifestyle, Travel | spending | everyday |

In the interface the baskets are called regular essentials, unexpected necessities
and everyday spending. Over the last 12 complete months the average customer spends
€1,902 a month on regular essentials, €170 on unexpected necessities and
€844 on everyday spending, and saves €298.

Recurring payments cannot be detected per merchant in this dataset: no customer
pays the same merchant a steady amount month after month. What recurs is visible
from the transaction type alone (housing, utilities, salary, investment deposits).

Related definitions, used the same way everywhere:

- **Net** is income minus spending, before any transfer to or from savings. The
  monthly summary also has `balanceChange`, which includes those transfers.
- **Monthly averages and peer benchmarks** cover the last 12 complete months before
  the demo's today. Peers are the synthetic customers in the dataset, by age band.
- **Safe to spend** is the balance minus bills still due before payday, groceries
  and other regular essentials at the recent daily rate, the usual saving transfer,
  a buffer for unexpected necessities (at least one typical such purchase) and a
  margin in case the salary arrives late. What is left is for everyday spending.
- **Safe to save** is what would remain at payday at the usual pace of everyday
  spending, minus a cushion of one month of regular essentials.

## Backtest

`npm run backtest -w @mydata/backend` replays the forecast and the safe-to-spend
amount on past dates. For every customer and for the 5th, 15th and 25th of each month
from October 2025 to August 2026, the engine sees only the transactions up to that
date, and its output is compared with what happened up to the next salary. Add
`-- --sample 500` for a quick run. The summary is written to `data/out/backtest.json`.

Result on all 5,100 customers (168,133 cases):

| Measure | Result |
|---|---|
| Balance just before the next salary | median error €381 (12% of a salary); 90% of cases within €1,552 |
| Bills due before payday | median error €57; 90% within €198 |
| Payday date | exact in 71% of cases, within two days in 80% |
| Customers whose everyday spending stayed within the amount shown | 92% |
| Of those, went below zero before the salary anyway | 1.5% |
| If the whole amount shown had been spent: balance below zero | 20% of cases |

What it taught us, and what changed because of it:

- **Salaries are not always on time.** They usually arrive on the 15th, but about
  three times in ten at the end of the month instead. The payday guess now expects
  the late date when the usual day has passed without a salary, and safe to spend
  holds back essentials for those extra days. Before this, the payday was within two
  days in 69% of cases and spending the whole amount would have overdrawn in 45%.
- **Unexpected necessities are lumpy.** A monthly average does not cover a single
  €500 purchase, so the buffer is now at least one typical such purchase.
- **The amount is an estimate, not a guarantee.** Spending all of it would still end
  below zero in one case in five, mostly when the salary is late or a large purchase
  lands. The app should present it with its assumptions, which the engine returns.
- **Many customers hold large balances**, so the median amount shown is about
  €4,700. A version that also keeps a fixed cushion may suit those customers better.

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
| `GET /api/customers/:id/summary?months=12` | Month-by-month income, baskets, saving, net and balance |
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
`safeToSave`, `balanceForecast`, `whatIf`, `peerCompare`, `dailySpend`, `recurring`
and `goalProgress`. The app runs the same engine on its 15 fixture customers; for
those customers the backend gives identical results for every function.

Arguments are checked: an unknown argument, a value outside its range or an unknown
period or category answers 400 with the reason, instead of silently falling back to
a default. Estimates carry an `assumptions` list in plain language.

```bash
curl 'http://localhost:8787/api/customers/CUST03004/engine/safeToSpend'
curl 'http://localhost:8787/api/customers/CUST03004/engine/whatIf?category=Restaurants&cutPct=20'
```

SQL data requests (`kind: "sql"`) are not supported yet and answer 501.

The functions behind the endpoints take plain objects and return plain JSON, so
they can be given to the model as tools unchanged.

## Deploy

One Docker image serves the API and the built app from the same address. The
database is not in the image; mount the directory that holds it at `/data`.

```bash
docker build -t mydata-finance .
docker run --rm -p 8787:8787 -v "$PWD/data/out:/data:ro" mydata-finance
# open http://localhost:8787
```

The full database is 663 MB. For a host where that is awkward, build a small one
that keeps only chosen customers' transactions. Peer cohorts are still computed
from all 5,100 customers, so comparisons do not change:

```bash
python3 data/prep/build_database.py --raw data/raw --out deploy/finance.sqlite \
  --keep-customers packages/app/public/fixtures/index.json   # the 15 demo customers, about 2 MB
docker run --rm -p 8787:8787 -v "$PWD/deploy:/data:ro" mydata-finance
```

`--keep-customers` also accepts a comma-separated list of customer ids. The image
reads `PORT`, `FINANCE_DB` and `STATIC_DIR`; the defaults suit the commands above.
Without Docker, the same setup is `npm run build` followed by
`STATIC_DIR=packages/app/dist npm run start -w @mydata/backend`.

## Demo boundary

This is a demo on synthetic data, not a secure banking service:

- The API has no login. Anyone who can reach it can ask for any customer id.
- It accepts requests from any origin, and the database holds every customer.
- The app's fixture files are public static files.

S-Pankki told us that where data lives, what a language model may read and how the
feature fits into S-mobiili are theirs to solve after the hackathon. Before any use
with real customer data, access would have to be tied to a logged-in customer, every
query scoped to that customer, origins restricted, and what reaches the model defined.

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
npm test             # finance engine and backend tests (vitest)
```
