# mydata-finance

MyData-style personal finance explorer — Junction 2026, S-Pankki challenge.

Users explore **their own** banking data through a conversational interface instead
of fixed dashboards. Data lives on the user's device (local SQLite); the backend is
a thin, stateless "mailbox". AI translates natural-language questions into SQL the
user can inspect — every answer shows its work.

## Stack (aligned with the [SOK Tech Radar](https://s-group-dev.github.io/tech-radar/))

| Layer | Choice | Radar |
|---|---|---|
| App | React Native + TypeScript (Expo) | ADOPT |
| On-device data | SQLite | not on radar (mobile-embedded) |
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
  app/       # React Native app — scaffold with: npx create-expo-app packages/app --template
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

```bash
npm install          # installs workspace tooling (typescript)
npm run typecheck    # type-checks packages/shared
```

Scaffold the app and infra packages when ready (commands in the layout table above).
