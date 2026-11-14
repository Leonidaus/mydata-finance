---
name: clarify-first
description: Interview the user with several rounds of questions before planning or building. Use for any product or feature planning in this project (what the app does, UX, demo story, charts, AI behaviour, data, stack) and before any non-trivial implementation task. Skip for trivial edits (typos, renames, one-line fixes, running a command the user spelled out).
---

# Clarify first

This team wants to be asked a lot before work starts. Decisions made by guessing cost more
at a hackathon than a minute of questions. Ask, then build.

## When it applies

- **Product or feature planning** (new screens, features, AI behaviour, data model, stack
  choices, demo flow): always, with at least two rounds.
- **Any non-trivial implementation** (more than one file, a new dependency, anything that
  changes behaviour users see, or anything touching the team's open decisions in the README):
  at least one round.
- **Skip** for trivial work: typos, renames, formatting, a one-line fix, or a command the
  user already spelled out.

## How to ask

1. Use the `AskUserQuestion` tool, 3–4 questions per round.
2. Run **at least two rounds** for product work: the first round on the big shape (who, what,
   where in the app), the second on details the first round opened up. Stop when answers stop
   changing the plan.
3. Put the recommended option **first**, marked "(Recommended)", and say why in its description.
4. Make every question stand on its own; the user may only see the dialog.
5. Use previews (ASCII mock-ups, code snippets) when comparing layouts or APIs.
6. If the user answers "what is standard?" or seems unsure, explain the industry-standard
   approach in one short paragraph, then ask again with that as the recommended option.
7. Read free-text answers carefully: they often combine or modify options ("both", "spec plus
   option 3"). Follow what they actually said.

## Good topics for this project

- **Users:** which persona (young adult, typical S-mobiili user, home saver, over-spender),
  language (Finnish/English), literacy level.
- **Experience:** where things live on screen (dashboard, chat), what is interactive, what
  the demo story is, what judges will see in the first 30 seconds.
- **Trust and MyData:** what the AI may see, how answers show their work, consent and export.
- **AI behaviour:** what the model may decide versus what is computed, tone, refusals,
  model/provider.
- **Data:** which fields, which date is "today" (data ends 2026-09-30), customer selection.
- **Scope:** what is in the demo versus a pitch slide, and what can be cut if time runs out.
- **The challenge:** S-Pankki's judging criteria (financial literacy, AI originality, mobile
  clarity, feasibility, S-mobiili fit) and the three spending baskets.

## After the interview

- Summarise the decisions in a short list before building, and note any decision that
  conflicts with the README's open-decisions table so the team can see it.
- Write the plan with those decisions as fixed inputs; do not reopen them unless something
  new comes up.
