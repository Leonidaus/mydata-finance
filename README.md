# mydata-finance

A personal finance coach for the S-Pankki "Personal Economic Trainer" challenge at
Junction 2026. People ask questions about their own banking data and get answers
they can inspect, in the spirit of MyData: their data, their questions, not charts
the bank picked for them.

> **Status: working prototype, deployed.** The app, the finance engine, the database
> build, the API and the coach (a language model that answers from the engine's
> figures, with every number checked) exist and are tested. See
> [Where things stand](#where-things-stand) for what is done, and [TODO.md](TODO.md)
> for what is next and how it maps to the judging criteria.

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

What came of it:

- The equation is the safe-to-spend card, with one change: it starts from this pay
  period's money, not from the whole balance. What was on the account before the
  last salary is a reserve and is left out, so savings on the account do not turn
  into "safe to spend 5,000 € this week". The engine also holds back groceries and
  other essentials until payday; see [Backtest](#backtest) for why.
- 1, 2 and 4 are built.
- 3 became a savings plan towards any goal, with saving for a home as the main
  example (see [Saving towards a goal](#saving-towards-a-goal)). The coach explains
  what matters for a mortgage but does not judge whether a loan would be granted.
- 5 is answered from the three baskets and from comparisons by age band, with other
  customers and with Statistics Finland. Customers are not clustered.
- 6: the coach answers in Finnish when asked in Finnish. The interface itself is
  still in English.

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
5. **MCC necessity class as fallback.** Group the MCCs
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
| Deploy | One Docker container serving the API and the built app, behind Caddy on a Verda instance | ADOPT (Docker) |
| AI | Gemini for the coach, run by the backend (prompt, key and checks stay on the server); keyword rules when no key is set | not on the radar |
| Voice | ElevenLabs text to speech and speech to text, called by the backend | not on the radar |

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
| What counts as safe to spend | This pay period's money only. What was on the account before the last salary is a reserve: shown, not counted, and it covers the buffer and a late salary first. See [Basket rules](#basket-rules). |
| Model for the chat | Gemini, run by the backend. The model gets a snapshot of the customer's figures from the finance engine, answers in words and adds a card when a picture helps. It never sees the transaction list and does no arithmetic, and a reply with a number that is not in its figures is not passed on. |

Still open:

| Decision | Options | What decides it |
|---|---|---|
| Interface language | Finnish first with an English toggle, or English only | Time left once the chat works. |
| Tech challenges | Which to submit. The voice mode (ElevenLabs) is built and the demo runs on Verda; Nemotron, Aiven and Oxylabs are not started | Time left after the core demo. |
| Coaching styles | One coach with a style the user picks (encouraging, direct, exploratory), or one fixed style as now | Time; see [TODO.md](TODO.md). |

## Tech challenges worth entering

Side challenges can be combined with the S-Pankki challenge. Shortlist:

| Challenge | Prize | Fit |
|---|---|---|
| Verda Compute | $10,000 in credits | Their brief names "open-weight models for a banking coach" as an example. The demo is hosted on a Verda instance. Still possible: inference in Europe and the 5,100-customer backtest as a batch job. |
| NVIDIA Nemotron | 2 × RTX 5080 | The model reads images and documents: photograph a bill or a flat listing and ask "can I afford this?". Free hosted API, about 40 requests a minute. |
| ElevenLabs | Earbuds | Built: a voice mode in the chat. The coach speaks its answers and listens for the next question. |
| Aiven | €1,000 / €750 / €500 | Aiven PostgreSQL as our database. |
| Oxylabs | €1,000 voucher + credits | One live, cited lookup, such as today's Euribor in the mortgage what-if. |

Checked: in Finnish the default ElevenLabs model misreads amounts (228 came out as
"222"); `ELEVENLABS_TTS_MODEL_ID=eleven_flash_v2_5` with
`ELEVENLABS_TTS_LANGUAGE_CODE=fi` reads them correctly. Not checked: whether Verda's
inference API serves Nemotron, in which case one integration would cover both.

## Where things stand

Done:

- Database build with basket labels, monthly summaries and peer cohorts for all
  5,100 customers.
- Finance engine with sixteen functions, including safe to spend, safe to save,
  the month so far, what-if, forecast, peer comparison, a comparison with Statistics
  Finland's figures, and a savings plan towards a goal with a review of how it is
  going. Every result carries a
  filter for the transactions behind it, and estimates carry their assumptions.
- API over the database: the engine for any customer, plus spending and summaries.
- The coach: a language model behind `POST /api/chat` that gets the engine's figures
  for the customer, answers in words in the user's language, adds a card when a
  picture helps, and can take a savings goal from a target to a plan. Every number
  in a reply is checked against the figures it was shown. See [Backend](#backend).
- App in the look of S-mobiili: one conversation in which each answer carries its
  own cards, charts and animated widgets, a small overview of what the user keeps,
  drill-down to the transactions behind every figure, the coach's face and
  suggested next steps, and a voice mode. See
  [The conversation and the overview](#the-conversation-and-the-overview).
- A backtest of the forecast and safe to spend on all customers, and an evaluation
  of the coach's answers against the engine with the real model.
- CI on every pull request, and deployment to a host with HTTPS on every push to
  `main`.

What is next, in order and against the judging criteria, is in [TODO.md](TODO.md).
The first items there: release the coach and goal planning to the live demo, two
fixes to the savings plan, a test on a real phone, coaching styles, a Finnish
interface, and the demo script.

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

`develop` is the repository's default branch, so GitHub selects it for new pull
requests. CI requires every pull request to target `develop`, except release pull
requests from `develop` into `main`.

Run `/release` to prepare or reuse the `develop` into `main` release pull request.
The skill does not merge it or start a deployment; merging remains manual and starts
the Deploy workflow automatically.

## Repo layout

An npm workspace. The finance engine and the coach live in `packages/shared`, so the
app (on its fixture customers) and the backend (on the database) run the same code.

```
packages/
  app/       # Vite + React web app, mobile-first: cards, chat, voice, widgets
  backend/   # Finance API over the SQLite database; runs the coach and the voice routes
  shared/    # Dataset schema, finance engine, the coach (prompt, tools, checks), card library
  voice/     # ElevenLabs text-to-speech and speech-to-text handlers
  infra/     # Infrastructure code (empty for now)
data/
  raw/       # Local source CSVs (gitignored; see "Data" below)
  out/       # Generated databases (gitignored)
  prep/      # Python: CSV → application database, or a per-customer bundle;
             # fetch_statfin.py refreshes the Statistics Finland snapshot
deploy/      # Compose file and setup steps for the demo host
docs/        # The implementation review and what was done about it
.github/     # CI and deploy workflows
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

The web app also ships demo fixtures (3 personas plus 12 random customers, cut at
the demo "today" 2026-09-15, plus peer averages by age band). They fill the customer
picker, and in fixture mode (`VITE_DATA_SOURCE=fixtures`) the app runs on them
without a backend. They are committed under `packages/app/public/fixtures/`;
rebuild them with:

```bash
python3 data/prep/build_fixtures.py --raw data/raw --out packages/app/public/fixtures
```

If you read the CSVs yourself: they start with a UTF-8 BOM, so use `utf-8-sig`.

Merchant category codes (MCC) are in `packages/shared/src/mcc.json`, read by the
TypeScript engine (`lookupMcc` in `@mydata/shared`) and by the Python prep. The
dataset has 36 codes; the table has all 298 general codes of the public ISO 18245
list, so a bigger dataset with more codes needs no change in the code:

- every code has a label. The 683 codes for individual airlines, car rental firms
  and hotel chains (3000-3999) are answered by range;
- the 36 codes the bank's data has shown also carry the category they appear under.
  For any other code the category comes from the customer's own transactions;
- 61 codes carry a basket hint (see [Basket rules](#basket-rules));
- the coach is told about the dataset's codes and the merchant types this customer
  has actually paid at, not the whole list, and any known code is accepted as an
  argument.

`python3 data/prep/build_mcc_table.py` rebuilds the table from the public list
(https://github.com/greggles/mcc-codes, public domain). When a bigger dataset shows
new codes, add them with their category to `DATASET` in that script.

The enums in `packages/shared/src/schema.ts` (categories, transaction types,
mortgage event types, rejection reasons) have been checked against the data and
match exactly.

## Comparison with Statistics Finland

The "You vs Finland" card (`nationalCompare` in the engine, `finland_compare` in the
card library) puts the customer's monthly average next to what people in Finland in
the same age group spend. It is the only figure in the app that comes from outside
the synthetic dataset, and the card is marked "Statistics Finland".

The figures come from two open tables of Statistics Finland (licence CC BY 4.0):

| Table | What it gives |
|---|---|
| `StatFin/ktutk/14q4.px` | Households' consumption 2022 by age of the household member with the highest income, in euros per month, per household and per consumption unit |
| `StatFin/khi/15b5.px` | Consumer price index per commodity group, monthly |

`python3 data/prep/fetch_statfin.py` fetches them and writes the snapshot
`packages/shared/src/benchmark/statfin.json`, which is committed. The app, the
backend and the tests read that file and never call the API, so nothing needs to be
rebuilt or copied to the demo host. Run the script again to add new price index
months.

How a figure is made (`packages/shared/src/benchmark/statfin.ts`):

1. Take the 2022 figure for the customer's age group.
2. Raise it to the price level of the twelve months the customer's own average
   covers, with the price index of that category (food by food prices, fuel and
   tickets by theirs, and so on).

Five categories have a reasonable counterpart in the survey:

| Bank category | National figure |
|---|---|
| Housing | Rents, upkeep of the home, housing loan interest. For owners it counts an estimated rent, not their loan payments. |
| Utilities | Electricity, heating, water, waste collection. No phone or internet. |
| Groceries | Food and non-alcoholic drinks. The bank sees everything bought in a grocery store. |
| Restaurants | Restaurants, cafés and takeaway. |
| Transportation | Fuel, upkeep of a car and tickets, including flights. Buying a car is left out. |

By default the comparison is with one adult (per consumption unit); the card has a
switch to a whole household for an account that pays for a family. These limits are
in the result's `assumptions`, so the card's "How was this made?" and the coach's
reply both have them. The customers are synthetic, so the card shows how the
feature works, not how real customers spend.

## The conversation and the overview

The app is one scroll. The coach's answer, the card it is about and the next steps
sit together, so an explanation is never in one place and its chart in another.

- **An answer carries its cards.** A card the coach adds or changes is shown under
  that answer, with its controls, "How this is calculated" and the transactions
  behind it. The answer holds its own copy: a follow-up ("and the last 3 months?")
  gives the new answer an updated card, and the earlier answer keeps the figures it
  described.
- **The overview is what the user keeps.** It starts with safe to spend and the
  month so far. A savings plan is saved as soon as it exists, because the coach
  reads the plan from there. Anything else is saved with "Save to overview" on the
  card; the same button takes it out again, or saves a changed version. The overview
  opens the conversation and folds into a bar with each saved card's figure once the
  user starts talking; the bar opens it again from anywhere.
- **"Ask about this"** on a card makes it the subject of the next question, shown
  above the input and above the question once sent.
- **What the coach sees** is unchanged: one list of card definitions. The app builds
  it from the card the user asked about, the latest answer's cards, up to six cards
  from earlier answers and the overview (`contextBlocks` in
  `packages/app/src/conversation.ts`). The first card in the list is what "it" means
  in a follow-up. `applyReply` in the same file turns the coach's card edits into the
  answer's cards and the changes to the overview.
- **Kept in the browser, per customer:** the overview (`mydata.dashboard.v3.<id>`)
  and the last 60 messages with their cards (`mydata.conversation.v1.<id>`). Photos
  are not kept, only what was read from them. "Start a new conversation" clears the
  messages and leaves the overview.

## Saving towards a goal

The coach can take a goal from "I want to buy a home" to a plan. The conversation
follows four steps, and every amount and date in it comes from the engine:

1. **Understand the goal.** The coach asks for the target and for what is already
   set aside. It never invents either. The account cannot tell how much of a
   customer's savings is meant for this goal, so that figure is the customer's own.
2. **A baseline.** `goalPlan` gives what is left to save, the months and the date at
   a monthly amount (the customer's current saving pace unless they choose one), and
   what would still be left over each month after spending and this saving.
3. **Choices.** `savingsOptions` lists where everyday spending could be cut, per
   category, leaving out essentials and whatever the customer wants to keep. The
   coach then asks `goalPlan` again with that amount as `extra`, and says how the
   date moves. A deadline works the other way round (`byMonths`): what it needs a
   month.
4. **The plan.** The "Your savings plan" card is saved to the overview as soon as it
   exists, with a slider for saving more. Its arguments are the plan (target, amount set aside,
   monthly amount, the month it started), so the coach can pick it up again later.
5. **The review.** "Am I on track?" is answered by `goalReview`: month by month
   since the plan started, what the plan asked for next to what was really moved
   from the account to savings. It says whether the customer is on plan or behind
   and by how much, when the target is reached at the agreed amount and at the pace
   so far, and how much was left on the account in those months without being
   moved. The month in progress is shown but not judged.

| Function | Arguments | Gives |
|---|---|---|
| `goalPlan` | `target` (required), `saved`, `monthly`, `extra`, `byMonths`, `label` | One row per scenario: monthly amount, months to go, month reached, months sooner than the first row, what is left over a month, and whether it fits |
| `goalReview` | `target` and `monthly` (required), `saved`, `since` (month the plan started), `label` | One row per month since the start: planned and moved to savings, both added up, what was moved that month, what was left on the account, and whether the month is complete |
| `savingsOptions` | `protect` (categories to keep), `cutPct` (default 20) | One row per everyday-spending category: monthly average, and what the cut frees a month and a year |

A scenario that needs more a month than has been left after spending is marked as
not fitting, and the coach says so and offers a longer timeline or a smaller target.
No interest is assumed. `safeToSave` is a different thing: a one-off amount that can
be moved today, which the coach is told never to present as a monthly amount.

Extra saving that comes from spending less (`extraFrom: spending_cut`) is paid for
by the cut, so it does not count against what is left over.

What the data allows and what it does not: the demo's "today" is fixed, so a plan
made in the demo starts this month and has nothing to review yet. The review shows
its worth when the customer says they started earlier ("I have been saving 300 € a
month since June"), which the 24 months of history can answer. Every transfer to
savings or investments counts towards the goal, because the account cannot tell
what a transfer is for.

Not built: a goal record stored apart from the overview, reminders, and anything
about loans. On a mortgage the coach explains which factors matter and says the bank
assesses that separately.

## The month so far

The overview starts with two cards: safe to spend and "This month so far"
(`monthSoFar`). The second is the balance of the calendar month up to today, with
the three baskets as its lines:

```
money in so far
− regular essentials
− unexpected necessities
− everyday spending
− moved to savings
= left of this month's money so far
```

Each line also carries what it usually is by the same day of the month (the average
of the last three months), and the caption says whether spending is above or below
that. It counts this month's money only, not what was already on the account. When
no salary has arrived yet this month, it says so and when one is expected.

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
| A merchant type with a basket hint | spending | by the hint, see below |
| Health under €100 | spending | regular |
| Health of €100 or more | spending | irregular |
| Home & Tech of €500 or more | spending | irregular |
| Home & Tech under €500 | spending | everyday |
| Restaurants, Entertainment, Lifestyle, Travel | spending | everyday |

A purchase is classified by its merchant type when the code table has a basket hint
for it, and by its category otherwise. The hints are for what a category is too
coarse to say:

| Hint | Merchant types | Basket |
|---|---|---|
| regular | groceries and bakeries, public transport, fuel, parking and tolls, utilities, phone and internet bills, insurance, child care, schools | regular |
| everyday | taxis | everyday |
| health | pharmacies, doctors, dentists, opticians, hospitals, labs | regular under €100, irregular from €100 |
| home | hardware, furniture, appliance and electronics stores | irregular from €500, everyday below |
| repair | car repair, home and appliance repair, contractors, vets | irregular from €100, everyday below |

For the 36 codes in the dataset the hints give exactly what the category rules give:
a rebuild of the database with them produced the same basket and rule on all
3,626,755 transactions, so the rules version did not change. They take effect for
codes a bigger dataset brings. A car repair then counts as an unexpected necessity
and a phone bill as a regular essential, whatever category the bank files them under.

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
- **Safe to spend** is what is left of this pay period's money. It starts from the
  balance and takes off:
  - the reserve: what was on the account just before the last salary came in. The
    data has one account per customer and no savings account, so this is how money
    saved up earlier is told apart from this month's income;
  - bills still due before payday, groceries and other regular essentials at the
    recent daily rate, and the usual saving transfer;
  - two precautions: money kept available for unexpected costs (at least one typical
    such purchase) and an allowance in case the salary arrives late, but only the
    part the reserve does not cover. Precautions are what a reserve is for.

  The precautions are planning allowances, not bills or spending, and they are shown
  that way. Every row of the result has a `kind` (`balance`, `reserve`, `expected`,
  `subtotal`, `precaution`, `result`). The card lists what is recorded and expected
  up to a subtotal, "left of this pay period's money after expected costs", says in
  one sentence that some money is kept available, and shows the allowances and the
  final figure under "How this suggestion was calculated". A low figure is explained
  by its cause: expected costs are more than the account holds (a real shortfall,
  with its size); this period's money is used and more would come from the reserve;
  or the expected costs fit and the rest is kept for the unexpected. Only the first
  is described as a shortfall.

  What is left is for everyday spending. A customer with 20,000 € saved and one with
  nothing saved get the same figure if their month looks the same. The customer can
  also say how much of the account is savings ("5 000 € of this account is savings",
  or "all of it is for spending"): the coach sets that amount on the card (`reserve`)
  and it replaces the one worked out from the last salary.
- **Safe to save** looks at the whole account, reserve included: what would remain at
  payday at the usual pace of everyday spending, minus a cushion of one month of
  regular essentials.

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
| Cases where an amount was shown as safe to spend | 70%; median amount until payday €816 |
| Customers whose everyday spending stayed within the amount shown | 71% |
| Of those, went below zero before the salary anyway | 1.2% |
| If the whole amount shown had been spent: balance below zero | 2.3% of cases |

What it taught us, and what changed because of it:

- **Salaries are not always on time.** They usually arrive on the 15th, but about
  three times in ten at the end of the month instead. The payday guess now expects
  the late date when the usual day has passed without a salary, and safe to spend
  holds back essentials for those extra days. Before this, the payday was within two
  days in 69% of cases and spending the whole amount would have overdrawn in 45%.
- **Unexpected necessities are lumpy.** A monthly average does not cover a single
  €500 purchase, so the buffer is now at least one typical such purchase.
- **Many customers hold large balances.** Half of them have more than two months of
  spending on the account. Counting the whole balance, the median amount shown was
  about €4,700, far more than anyone spends in a pay period, and spending all of it
  would have ended below zero in one case in five. Safe to spend now counts this pay
  period's money only and treats what was there before the last salary as a reserve.
  The median amount shown is €816, and spending all of it would overdraw in 2.3% of
  cases.
- **The amount is now a limit people actually reach.** In 29% of the cases where an
  amount was shown, the customer spent more than it on everyday things, which means
  they dipped into the reserve. In 30% of all cases nothing was shown as safe to
  spend: this period's money was already used or spoken for. That matches the data,
  where about a quarter of customers spend more than they earn.
- **The amount is an estimate, not a guarantee.** The app presents it with its
  assumptions, which the engine returns.

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
| `POST /api/tts` | Text to speech: `{ text, languageCode? }` → MP3 audio (ElevenLabs, from `packages/voice`) |
| `POST /api/stt` | Speech to text: an `audio` form file or a raw audio body → `{ text, languageCode }` |
| `GET/PATCH /api/customers/:id/profile` | Stored coaching style and protected spending categories |
| `POST /api/chat` | The coach: `{ customerId, question, history, blocks, allowProtected?, image? }` → `{ text, ops, mood, suggestions, checked, answeredBy, rejected, picks, blocked, photo? }` |

The spending endpoint takes `period` (`this_month`, `last_month`, `last_30_days`,
`last_3_months`, `last_12_months`, `this_year`, `all`) or `from` and `to`, and the
optional filters `category`, `mcc` and `basket`. `groupBy` (`category`, `mcc`,
`basket`, `month`) adds a breakdown, and `limit` caps the transactions returned.
"How much did I spend on taxis last month?" is:

```bash
curl 'http://localhost:8787/api/customers/CUST04488/spending?mcc=4121&period=last_month'
```

The voice routes need `ELEVENLABS_API_KEY` and the chat route needs `GEMINI_API_KEY`.
Put them in a `.env` file at the repository root (copy `.env.example`), which the
backend reads at startup. Without a key the route answers 503 and everything else
works; `/api/health` reports which services are on. Because these routes spend
credits, each has a request budget across all callers (voice: 30 a minute, 400 an
hour; chat: 20 a minute, 400 an hour) and answers 429 beyond it.

The chat runs on the server. The app sends the question, the conversation so far
and the definitions of the cards on screen; the server builds the prompt and calls
Gemini with its own key. An answer is usually one model call:

1. **A snapshot of the figures.** Before the model is asked, the finance engine
   computes a fixed set of results for the customer (safe to spend, the three baskets,
   spending by category, income, saving and spending per month, bills, the peer
   comparison) and they go into the prompt as text. Totals and rows only: the
   transaction list never goes to the model.
2. **The answer.** The coach replies in words, in the language of the question, with
   a mood for its face and up to three suggested next steps. It adds a card when a
   picture helps. If it needs a figure the snapshot lacks (another period, one
   merchant type, a what-if), it first calls `lookup`, which runs one engine function
   and returns the result to the model, at most twice per answer.
3. **Checks.** Every tool call is validated (engine arguments, card definitions,
   custom views) and sent back once if something is wrong. Every number in the reply,
   years included, must be one the coach was shown, as given or rounded; the coach is
   told not to calculate. When the answer builds a card that changes a figure
   the coach already had (a reserve set, another horizon), the reply may not quote the
   old figure without the card's own. A reply that fails is sent back once, together with the figures of the
   cards it built. If it fails again, a standard sentence with a `{{cardId.value}}`
   placeholder goes out instead, and the answer has `checked: false`.

A question can come with a photo (`image: { mimeType, data }`, a JPEG, PNG or WebP as
base64): a price tag, a bill, a listing. The photo is read in a model call of its own
that sees the picture and nothing about the customer, and can only report the item,
its price and its kind. The coach gets that reading as a line of text, and for a
one-off price the engine's `afford` function works out whether it fits what is safe to
spend until payday (a bill may also use the buffer for unexpected necessities). In the
app the photo waits in the input row and goes out with the user's next message, so
they can ask anything about it. Sent without words (`question` may then be empty) it
means "can I afford this?", and the server adds that card itself. The answer carries
what was read (`photo`) for the app to show under the picture. This path has tests against a
stand-in model; it has not been run with the real model yet.

Views the model writes itself (a Vega-Lite spec or widget code) are checked before
they reach the dashboard: a spec may only read columns the engine function returns
and may not carry data of its own; widget code must parse, read its rows from the
app and load nothing from the network.

The caller cannot supply instructions, pick the model or reach Gemini directly. The
whole conversation logic is in `packages/shared/src/agent` (`chat.ts` for the steps
above, `snapshot.ts`, `figures.ts` for the number check, `viewChecks.ts`); the
backend adds the model and the engine for the customer who is asking.

Coaching preferences are stored separately in a small writable SQLite database. A customer can
choose an encouraging, direct or exploratory style and categories to keep as-is. The server applies
those category protections to savings and what-if lookups, including cards; `allowProtected` only
shows one protected category in one chat answer and never changes the stored profile. This demo API
has no authentication, so profile routes are intentionally open like the rest of the demo API.

The preferences can also be changed in the chat, and the change is saved the same way:

- "Leave my travel alone" or "be more direct with me" is saved straight away, and the coach says
  what it changed.
- When the customer says they would be willing to cut something on their keep-as-is list, the coach
  does not refuse and does not calculate. It asks whether to take that category off the list, with
  a yes and a no under the question. After the yes the category is removed, the coaching settings
  show it, and the coach carries on with the cut that was asked about.
- A category only comes off the list after that question: the coach's first attempt is recorded as
  "to ask", and the removal goes through when the next message arrives with that category marked
  as asked about (`pendingUnprotect` in the chat request; the answer lists what it asked about in
  `proposedUnprotect`). The model cannot remove a protection in one go.

The rules are in `packages/shared/src/agent/preferences.ts`.

Two models share the work. A fast one (`GEMINI_MODEL`) answers most turns in about
two seconds. A stronger one (`GEMINI_STRONG_MODEL`) takes the turns that gain from
it, in six to nine seconds:

- turns the fast model hands over: advice and assessments ("how could I save
  more?"), goals and plans, charts the library does not have;
- every turn that touches the planning functions (`goalPlan`, `savingsOptions`) or a
  plan on the dashboard, whether or not the fast model handed it over;
- second tries, when the fast model's answer was rejected or failed the number check.

If the stronger model fails, the fast one answers after all.
`GEMINI_STRONG_MODEL=off` runs the fast model alone.

Each setting may list several models, comma-separated; the next is tried when one
is overloaded. A name may carry a thinking level after a colon. The defaults are
`gemini-3.5-flash-lite,gemini-3.8-flash:low` for the fast model and the same two in
the other order for the stronger one, chosen from one run of the chat evaluation per
model (11 questions, one customer, 14 Nov 2026):

| Model | Answers right | Seconds per answer (median, longest) |
|---|---|---|
| `gemini-3.5-flash-lite` | 11 of 11 | 2.3, 4.6 |
| `gemini-3.1-flash-lite` | 9 of 11 | 2.1, 3.6 |
| `gemini-3.6-flash:minimal` | 9 of 11 | 4.1, 7.6 |
| `gemini-3.8-flash:low` | 11 of 11 | 6.0, 7.9 |
| `gemini-3.8-flash` | 11 of 11 | 17.1, 23.8 |
| `gemini-4-hydrogen:low` | 11 of 11 | 7.5, 12.8 |
| `gemini-4-hydrogen` | 11 of 11 | 14.1, 21.3 |

The larger models write fuller coaching: they name the amounts and notice, for
example, that a customer spends more than comes in. With their default thinking
they are too slow for a chat, which is why a level is set. Gemini 4 Argon and Carbon
were not tried. With the two models together, the same evaluation passes 11 of 11:
nine questions answered by the fast model and two (the savings plan and "how could I
save more?") by the stronger one.

`npm run eval:chat -w @mydata/backend` asks the challenge's questions with the real
model and compares each answer with the engine: a card with the right function and
arguments or an answer in words, nothing rejected, the reply's numbers checked, and
the engine's figure in the reply.

The engine endpoints run the finance engine from `packages/shared/src/engine` for
any of the 5,100 customers: `spendBy`, `monthlyTrend`, `baskets`, `safeToSpend`,
`safeToSave`, `balanceForecast`, `whatIf`, `peerCompare`, `nationalCompare`,
`dailySpend`, `recurring`, `goalProgress`, `goalPlan`, `savingsOptions`,
`monthSoFar` and `goalReview`. The app runs the same engine on its 15 fixture customers; for
those customers the backend gives identical results for every function.

Arguments are checked: an unknown argument, a value outside its range or an unknown
period or category answers 400 with the reason, instead of silently falling back to
a default. Estimates carry an `assumptions` list in plain language.

`spendBy`, `monthlyTrend` and `whatIf` take an optional `mcc` (merchant category code)
to narrow to one kind of merchant, for example `4121` for taxis. Without it, "how much
did I spend on taxis?" could only be answered with all of Transportation.

```bash
curl 'http://localhost:8787/api/customers/CUST03004/engine/safeToSpend'
curl 'http://localhost:8787/api/customers/CUST03004/engine/whatIf?category=Restaurants&cutPct=20'
```

SQL data requests (`kind: "sql"`) are not supported yet and answer 501.

The functions behind the endpoints take plain objects and return plain JSON. The
coach uses the same functions for its snapshot and its lookups.

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

### Continuous integration and deployment

- **CI** (`.github/workflows/ci.yml`) runs typecheck, tests and the app build on every
  pull request and on pushes to `develop` and `main`.
- **Deploy** (`.github/workflows/deploy.yml`) runs on every push to `main`: it publishes
  the Docker image to GitHub's container registry and, when a host is configured,
  redeploys it there over SSH. `main` is the persistent build.
- The host runs the image behind Caddy, which provides HTTPS; a phone's browser only
  allows microphone use on a secure address. Setup steps: [deploy/README.md](deploy/README.md).
- The backend refuses to start on a database built with other basket rules than the
  code expects, so a deploy cannot silently serve wrong numbers.

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
npm test             # finance engine, backend and app data-layer tests (vitest)
```

### The coach in development

- With `GEMINI_API_KEY` in `.env` at the repository root, the backend answers typed
  questions with the model. Without a key the chat falls back to keyword rules, and
  the suggested-question chips always use those.
- `VITE_DATA_SOURCE=fixtures` with a key in `packages/app/.env.local` runs the coach
  without the backend: the Vite dev server forwards the model calls and adds the key.
- `?dev` in the address opens the component gallery with every card and widget on
  static data.
- The app is light on every device, like S-mobiili, whatever the device is set to.
  `?theme=dark` in the address shows the dark palette.

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
