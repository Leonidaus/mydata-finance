# TODO

Feature roadmap for the S-Bank challenge, in priority order.
Analytics run on-device as pure TypeScript functions in `packages/shared`, exposed to the LLM as tools.

## 1. Three-basket classification + recurring detection
- [ ] Detect recurring payments (same merchant/amount at a regular interval)
- [ ] Classify spending into baskets: mandatory regular / mandatory irregular / everyday leakage
- [ ] Handle ambiguous categories (Health, Home & Tech) by frequency and amount, not category alone
- [ ] Explain each classification to the user ("why is this in this basket?")

## 2. Safe-to-spend / safe-to-save
- [ ] Cash-flow forecast to next payday from `balance_after_eur` and salary timing
- [ ] Subtract upcoming fixed costs and a buffer for irregular costs
- [ ] Weekly safe-to-spend figure
- [ ] Safe-to-save suggestion (use `Salary Sweep` as a signal of existing saving)

## 3. What-if simulator
- [ ] `simulate({ category, changePct })` → monthly and 12-month impact
- [ ] Hook up as an LLM tool for questions like "what if I cut dining out by 20%?"

## 4. Peer benchmarks
- [ ] Precompute cohort averages (age band, postal area) from the full dataset in the Python prep step
- [ ] Add Statistics Finland household spending figures
- [ ] Ship as static JSON; compare the user's spending against it

## 5. Conversational savings goals
- [ ] Create goals through chat ("€1,500 for summer, can I make it?")
- [ ] Store goals on-device alongside the transaction data
- [ ] Track progress and feasibility using the safe-to-save figure

## 6. Mortgage readiness (stretch)
- [ ] Use rejection reasons from `mortgage_outcomes` (insufficient income, equity or collateral)
- [ ] "People with your profile were typically rejected for X" insight

## Out of scope
- Investment performance tracking (data has only deposit/withdraw cash flows)
- Net worth (not enough asset/liability data)
- Hard budgets with limits (the brief favours coaching over restrictions)
- Multi-bank PSD2 view (optional bonus; mock it up at most)
