# TODO

Everything we have built, decided and still think about for the S-Pankki challenge
(Junction 2026), as of 14 Nov 2026. Open items are ordered by what they do for the
judging, not by how interesting they are to build.

How it fits together: the figures come from pure TypeScript functions in
`packages/shared/src/engine`, run by the app on fixtures and by the backend on the
database. The coach (`packages/shared/src/agent`) gets results of those functions and
never does arithmetic of its own.

## How we are judged

Five criteria, 20% each. What we have for each, and where the gap is:

| Criterion | What we have | Biggest gap |
|---|---|---|
| Impact on financial literacy | Three baskets on every transaction with the rule behind it, safe to spend with its assumptions, what-if, a savings plan with dates, coaching rules in the prompt | The basket rule is not shown in the app; the interface is in English |
| Originality of AI integration | A coach that answers in words from engine figures, with every number checked; cards and animated widgets built on request; voice mode | Coaching styles: the same question in three styles with identical figures would show the design well |
| Clarity of the mobile experience | S-mobiili look, one pinned card, chat with face and next-step chips | Not tested on a real phone; no Finnish; no onboarding |
| Feasibility | 224 tests, a backtest on 168,133 cases, a chat evaluation against the engine, one model call per answer, live deployment | Free-tier model quota (15 requests a minute) during the demo |
| Potential to integrate into S-mobiili | S Group design tokens, a web app that can be embedded, provider-neutral model interface | A short integration note for the pitch: what is ours, what S-Pankki replaces |

## Next, in order

1. [ ] Release `develop` to `main`: the conversational coach (#34) and goal planning
   (#36) are merged but not on the live demo. `/release` prepares the pull request;
   merging it starts the deploy. Check the live site afterwards.
2. [ ] Fix `goalPlan` for funded changes: every scenario is checked against the same
   amount left after spending, so extra saving that comes from a spending cut can be
   marked "does not fit" although the cut pays for it. The function needs to know
   whether the extra is freed by a cut or taken from the existing surplus.
3. [ ] Fix the prompt's limit "no forecast beyond the next payday": it contradicts
   `goalPlan`, which gives dates years ahead. The limit belongs to the balance
   forecast only.
4. [ ] Re-run the chat evaluation (`npm run eval:chat -w @mydata/backend`). The last
   run was before three fixes (two test cases, unfillable placeholders).
5. [ ] Replace the personal free-tier Gemini key with the Junction key
   (`gh secret set GEMINI_API_KEY`, re-run Deploy), then rotate the personal key.
6. [ ] Test on a real phone: chat, voice on, the animated widgets (WebGL), the
   transaction drawer. The app is light on every device now; the dark palette is
   only shown with `?theme=dark`.
7. [ ] Coaching styles and protected categories (see [Coaching profile](#coaching-profile)).
8. [ ] Demo script and pitch (see [Demo and pitch](#demo-and-pitch)).
9. [ ] Finnish voice: set `ELEVENLABS_TTS_MODEL_ID=eleven_flash_v2_5` and
   `ELEVENLABS_TTS_LANGUAGE_CODE=fi`. The default model misreads amounts in Finnish
   (228 came out as "222").

## The coach

Counts towards: originality of AI integration, financial literacy.

### Done
- [x] Server chat endpoint `POST /api/chat`; the browser never holds the model key
- [x] Snapshot of the customer's figures in the prompt, `lookup` for anything else
  (at most two rounds), usually one model call per answer
- [x] Every number in a reply must be one the coach was shown; a failing reply is
  sent back once, then replaced by a standard sentence (`checked: false`)
- [x] Placeholders in a reply must be ones the app can fill
- [x] Mood (the 20 euro note's face) and up to three suggested next steps
- [x] Coaching rules in the prompt: ask before proposing cuts, leave alone what the
  user values, benchmarks are context, safe to save is a one-off, no double counting,
  essentials and the buffer stay untouched
- [x] Stated limits: no shop names, no other banks, no advice on products, no loan
  predictions, cannot move money
- [x] Checks on views the model writes itself (columns, no embedded data, script
  parses, no network)
- [x] Replies follow the language of the question (Finnish or English)
- [x] Chat evaluation with the real model against the engine, 11 questions

### Coaching profile
One coach with configurable behaviour, stored per customer and sent with each chat
request. The figures and the feasibility finding stay the same in every style; only
wording, initiative and the suggested next steps change.

- [ ] Three styles: encouraging, direct, exploratory. "Strict" means holding the user
  to a plan they chose, never shaming
- [ ] Protected categories in the profile, merged into `savingsOptions` by the server.
  Today a category is only left out when the model remembers to pass `protect`
- [ ] A style picker in the app: two taps, skippable, editable later. Goal amounts
  and dates are asked when the user starts a goal, not in onboarding
- [ ] Profile fields are fixed choices and category names only, never free text: the
  profile goes into the system prompt
- [ ] Evaluation case: one question in all three styles, figures must be identical
- [ ] Later: how big a change feels realistic (small, balanced, ambitious), only if
  it sets something concrete such as the default cut in `savingsOptions`
- [ ] Later: change preferences in the chat ("be more direct", "leave my travel
  budget alone"), with a short acknowledgement
- [ ] Keep mood separate from style, and avoid a face that looks disappointed in
  the user

### Trust in the answers
- [ ] Give each figure its meaning (monthly amount, one-off transfer, target, date)
  and check that the reply keeps it. Today a number that appears in the figures
  passes even when the sentence around it is wrong
- [ ] Verify what the prompt promises: a custom view that fails on screen is swapped
  for the standard card. That swap was not found in the renderer
- [ ] Add a multi-turn goal conversation to the evaluation
- [ ] Pace the evaluation for the free-tier quota, or run it with the Junction key
- [ ] Check that the coach explains a concept in plain language when asked
  ("what is a buffer?"); the brief names this explicitly

## Understanding where the money goes

Counts towards: financial literacy.

- [x] Three baskets by one rule set (`engine/baskets.ts`, `data/prep/build_database.py`),
  ambiguous categories decided by amount
- [x] Why each transaction is in its basket (`basket_rule`, `BASKET_RULE_EXPLANATIONS`)
- [ ] Show that explanation in the app's transaction drawer
- [x] Recurring payments (`engine/streams.ts`; in this dataset only housing,
  utilities and saving transfers recur)
- [x] Spending by category and by merchant type (taxis, fast food), trends, calendar
- [x] "What kind of spender am I?" answered from the baskets

## Safe to spend and safe to save

Counts towards: financial literacy, feasibility.

- [x] Forecast to the next payday (`balanceForecast`)
- [x] Safe to spend: balance minus bills, essentials, planned saving, a buffer and a
  late-salary margin, per week or until payday
- [x] Safe to save: a one-off amount that can be moved today
- [x] Backtest on all customers (`npm run backtest -w @mydata/backend`): median
  error 381 €, payday within two days in 80% of cases
- [ ] A library card for safe to save (the coach can only state the figure today)
- [ ] Decide whether safe to spend should always keep a fixed cushion

## What-if and savings goals

Counts towards: financial literacy, originality of AI integration.

- [x] `whatIf`: cutting a category or merchant type, per month and per year
- [x] `goalProgress`: progress counted from the account's own saving transfers
- [x] `goalPlan`: months and date towards a target the user gave, saving more a
  month, meeting a deadline, and whether each fits what is left after spending
- [x] `savingsOptions`: where everyday spending could be cut, without essentials
- [x] The plan card stays pinned, with a slider for saving more
- [x] The coach asks for the target and never invents one
- [ ] Funded changes in `goalPlan` (item 2 above)
- [ ] A goal record stored separately from the dashboard: target and date, savings
  the user confirmed, agreed monthly amount, protected buffer, chosen changes and
  their effects, assumptions, when it was agreed. Today the pinned card's arguments
  are the only record
- [ ] Review progress against the plan: actual transfers since it was agreed, on
  track or not, and help revising it
- [ ] An agreed cash buffer as part of the plan
- [ ] Optional reminders
- [ ] Try the same flow for other goals (emergency fund, a trip, studies)

## Benchmarks

Counts towards: financial literacy. Encouraged by the brief, not mandatory.

- [x] Peers in the dataset by age band (`peerCompare`)
- [x] Statistics Finland: "You vs Finland" for five categories in today's prices
  (`nationalCompare`), with source and limits on the card
- [ ] Use the postal-area cohorts and percentiles that the database already has
- [ ] More categories from the consumption survey (health, clothing, recreation)
- [ ] By household type (table `StatFin/ktutk/14ph.px`) instead of age only
- [ ] Postal-area open data (Paavo)
- [ ] Refresh the price index before the demo (`python3 data/prep/fetch_statfin.py`)

## Mobile experience

Counts towards: clarity of the mobile experience, potential to integrate into S-mobiili.

- [x] S-mobiili look: S Group colours, amounts as `7 320 €`, dates as `15.10.2026`
- [x] Light on every device, like S-mobiili; dark only on request (`?theme=dark`)
- [x] One pinned card by default; answers replace the previous unpinned card
- [x] The coach's face and next-step chips; voice mode with continuous listening
- [x] Animated widgets (savings jar, gauge, money flow, coins)
- [ ] Real phone test (item 6 above)
- [ ] Finnish-first interface with an English toggle. The coach already answers in
  Finnish; buttons, card titles, captions and assumptions are in English
- [ ] The conversation is lost on reload; the dashboard is kept
- [ ] The suggested-question chips are instant keyword answers without the coach;
  decide whether they should go to the coach when a model is available
- [ ] Voice with the new coach: longer replies and amounts read aloud
- [ ] Check the app inside a web view, since that is how it would sit in S-mobiili

## Free exploration (MyData)

Counts towards: originality of AI integration, financial literacy.

- [x] Cards the user configures, pins and removes; drill-down to the transactions
  behind every figure
- [x] The coach builds charts and widgets on request, checked before they are shown
- [ ] Read-only exploration with queries of the user's own (the `sql` data kind is a
  stub)

## Mortgage and housing (stretch)

Counts towards: financial literacy. Must not displace the core.

- [x] The coach explains which factors matter and says the bank assesses a loan
  separately; it never predicts a decision
- [ ] Illustrative ownership-cost scenarios, including running costs, not only the
  loan payment
- [ ] ASP information from a maintained, dated source (the State Treasury's
  guidance). The suggestions we got say the law changed on 1 June 2026; verify that
  before relying on it, and never leave it to the model's memory
- [ ] Rejection reasons from `mortgage_outcomes` as demonstration data only: 200
  synthetic applications are too few to say anything about one person
- [ ] One live, cited lookup such as today's Euribor (also the Oxylabs side challenge)

## Multi-bank view (optional bonus)

Only after the core demo works. Details in the README.

- [ ] A consent screen and a second account at a simulated bank, labelled as simulated
- [ ] A connector interface with a field for which bank a row came from
- [ ] A categoriser for transactions without S-Pankki's categories (MCC table first)
- [ ] Matching transfers between the user's own accounts
- [ ] If a real API is wanted behind it: the Enable Banking sandbox, about half a day

## Feasibility and integration

Counts towards: feasibility, potential to integrate into S-mobiili.

- [x] Monorepo with one engine shared by app and backend; identical results on the
  fixture customers
- [x] CI on every pull request; deploy on every push to `main`
- [x] Request budgets on the chat and voice routes
- [x] The model sits behind one interface (`ChatModel`), so the provider can change
- [ ] Integration note for the pitch: what S-Pankki replaces (login, data access per
  customer, model provider, placement in the app) and what stays (engine, coach,
  cards). S-Pankki told us those are theirs to solve after the hackathon
- [ ] Figures for the pitch: model calls and seconds per answer, cost per answer
- [ ] An open-weight model on Verda as an alternative provider (also the Verda side
  challenge)

## Demo and pitch

- [ ] Pick the demo customers and one path through the app: a simple question, the
  baskets, safe to spend, a what-if, the home-saving conversation, "You vs Finland"
- [ ] Say what the synthetic data means: most demo customers sit well above the
  national figures, which is a property of the dataset, not a finding
- [ ] A fallback when the model is busy: the suggested-question chips answer without it
- [ ] Rehearse on the phone that will be used
- [ ] Find out what Junction wants submitted (video, description, deadline); the
  brief does not say

## Side challenges

Decide which to enter; each needs its own submission.

- [x] ElevenLabs: the voice mode exists
- [x] Verda: the demo runs on a Verda instance
- [ ] Verda: model inference in Europe, the backtest as a batch job
- [ ] NVIDIA Nemotron: photograph a bill or a flat listing and ask "can I afford this?"
- [ ] Aiven: PostgreSQL as the database
- [ ] Oxylabs: one live, cited lookup

## Housekeeping

- [ ] Delete the Verda instance and its volume after the event. It costs 2.171 € an
  hour and the credit lasts until about 18 Nov
- [ ] The Docker image build fails on the CRACI runner (`npm ci` inside the build);
  it runs on GitHub's runner for now
- [ ] Rebuild and re-copy the demo database to the host if the basket rules version
  changes; the backend refuses to start otherwise
- Branch from `develop`, not `main`. CI now fails a pull request that targets
  anything else, except the release from `develop` into `main`

## Out of scope

- Investment performance (the data has only deposits and withdrawals)
- Net worth (not enough data on assets and debts)
- Hard budgets with limits (the brief favours coaching over restrictions)
- Live PSD2 access (a simulated second bank at most)
- Login and per-customer access control, where the data lives, what a model may read
  and where the feature sits in S-mobiili (S-Pankki's to solve after the hackathon)
- Predicting loan decisions, recommending products, moving money
