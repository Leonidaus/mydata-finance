# mydata-finance

MyData-style personal finance explorer — Junction 2026, S-Pankki challenge.

Users explore **their own** banking data through a conversational interface instead
of fixed dashboards. Data lives on the user's device (local SQLite); the backend is
a thin, stateless "mailbox". AI translates natural-language questions into SQL the
user can inspect — every answer shows its work.

## Stack (aligned with the [SOK Tech Radar](https://s-group-dev.github.io/tech-radar/))

| Layer | Choice | Radar |
|---|---|---|
| App | React + TypeScript web app (Vite), mobile-first and embeddable in a mobile app | ADOPT (React) |
| On-device data | SQLite in the browser (sql.js, planned) | not on radar |
| Backend | Node.js + TypeScript on AWS Lambda (Middy) | ADOPT |
| API | GraphQL (Apollo), OpenAPI | ADOPT / TRIAL |
| Cohort data | AWS RDS Aurora | ADOPT |
| Consent/audit state | DynamoDB | ADOPT |
| Notes search | ElasticSearch | ADOPT |
| Infra | AWS CDK (TypeScript) | ADOPT |
| CI/CD | GitLab + Docker | ADOPT |

## Repo layout

```
packages/
  app/       # Vite + React web app (mobile-first)
  backend/   # Lambda handlers (Node.js + TypeScript)
  infra/     # AWS CDK stacks — scaffold with: npx cdk init app --language typescript
  shared/    # Dataset schema + shared types (the single source of truth)
data/
  raw/       # Source CSVs (Git LFS; see "Data" below)
  prep/      # Python: CSV → per-customer SQLite bundle
docs/
```

## Data

Source dataset lives in a separate repo:
`git@github.com:hackjunction/Junction-2026-S-pankki.git` (Git LFS required).

Place the four CSVs in `data/raw/` (gitignored), then build a per-customer bundle:

```bash
pip install pandas
python3 data/prep/csv_to_sqlite.py --raw data/raw --out data/out/CUST00001.sqlite --customer CUST00001
```

Note: the CSVs start with a UTF-8 BOM — read them as `utf-8-sig`.

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
npm run typecheck    # type-checks packages/shared and packages/app
npm run build        # production build of the app
```

Scaffold the infra package when ready (command in the layout table above).
