# TODO

Feature roadmap for the S-Bank challenge. Analytics are pure TypeScript functions in
`packages/shared/src/engine`, run by the app on fixtures and by the backend on the
database, and meant to be exposed to the language model as tools.

## 1. Three-basket classification + recurring detection
- [x] Classify spending into baskets: regular essentials / unexpected necessities / everyday spending (one rule set, `engine/baskets.ts` and `data/prep/build_database.py`)
- [x] Handle ambiguous categories (Health, Home & Tech) by amount, not category alone
- [x] Detect recurring payments (`engine/streams.ts`; in this dataset only housing, utilities and saving transfers recur)
- [x] Store why each transaction is in its basket (`basket_rule`, `BASKET_RULE_EXPLANATIONS`)
- [ ] Show that explanation in the app's transaction drawer

## 2. Safe-to-spend / safe-to-save
- [x] Cash-flow forecast to next payday from `balance_after_eur` and salary timing (`balanceForecast`)
- [x] Subtract upcoming bills, essentials, a buffer for unexpected costs and a late-salary margin (`safeToSpend`)
- [x] Weekly safe-to-spend figure
- [x] Safe-to-save figure (`safeToSave`)
- [x] Backtest on all customers (`npm run backtest -w @mydata/backend`)
- [ ] App card for safe to save
- [ ] Decide whether safe to spend should always keep a fixed cushion

## 3. What-if simulator
- [x] `whatIf({ category, cutPct })` → monthly and 12-month impact
- [ ] Hook up as a model tool for questions like "what if I cut dining out by 20%?"

## 4. Peer benchmarks
- [x] Precompute cohort averages and percentiles (age band, postal area) from the full dataset in the Python prep step
- [x] Compare the user's spending against their age band (`peerCompare`)
- [ ] Use the postal-area cohorts and percentiles in the app
- [ ] Add Statistics Finland household spending figures

## 5. Chat with a language model
- [ ] Server chat endpoint with the engine functions as tools (provider to be chosen)
- [ ] Replace the keyword mock in `packages/app/src/agent/mockAgent.ts`
- [ ] Test questions with known answers: taxis last month, safe to spend, spender profile, cutting restaurants by 20%

## 6. Conversational savings goals
- [x] Goal progress from saving transfers (`goalProgress`)
- [ ] Create goals through chat ("€1,500 for summer, can I make it?")
- [ ] Track feasibility using the safe-to-save figure

## 7. Mortgage readiness (stretch)
- [ ] Use rejection reasons from `mortgage_outcomes` (insufficient income, equity or collateral)
- [ ] "People with your profile were typically rejected for X" insight

## 8. Deployment
- [x] Docker image serving the API and the built app
- [ ] Deploy to a host and test on a phone
- [ ] Finnish-first interface with an English toggle

## Out of scope
- Investment performance tracking (data has only deposit/withdraw cash flows)
- Net worth (not enough asset/liability data)
- Hard budgets with limits (the brief favours coaching over restrictions)
- Live multi-bank PSD2 access (optional bonus; a simulated second bank at most)
- Authentication and per-customer access control (S-Pankki handles this after the hackathon)
