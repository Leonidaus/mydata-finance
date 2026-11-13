#!/usr/bin/env python3
"""Build the demo fixtures the web app reads while there is no backend.

Writes to packages/app/public/fixtures/:
  index.json       preset personas + a pool of random customers
  cohorts.json     average monthly spend per category, by age band (peer benchmarks)
  CUSTxxxxx.json   one file per customer: profile, mortgage outcome, transactions

Transactions are cut at the demo "today" (TODAY below), so the app sees the data a
customer would have on that day. Rows are stored as compact arrays; see ROW_FIELDS.

Usage:
    python3 data/prep/build_fixtures.py --raw data/raw --out packages/app/public/fixtures

No third-party packages are needed.
"""

import argparse
import csv
import json
import random
from collections import defaultdict
from pathlib import Path

from csv_to_sqlite import to_iso_timestamp

TODAY = "2026-09-15"
# Full calendar months used for averages (data starts 2024-10-01).
BENCH_FROM, BENCH_TO = "2024-10-01", "2026-08-31"
BENCH_MONTHS = 23

ROW_FIELDS = ["tx_date", "tx_timestamp", "category", "tx_amount_eur",
              "balance_after_eur", "transaction_type", "merchant_id", "mcc_code"]
INCOME_CATEGORIES = {"Salary", "Other Income"}
SAVING_CATEGORIES = {"Invest Deposit", "Salary Sweep"}
NOT_SPENDING = INCOME_CATEGORIES | SAVING_CATEGORIES | {"Invest Withdraw"}
AGE_BANDS = [(18, 24), (25, 34), (35, 44), (45, 54), (55, 64), (65, 200)]
RANDOM_POOL = 12


def age_band(age: int) -> str:
    for lo, hi in AGE_BANDS:
        if lo <= age <= hi:
            return f"{lo}-{hi}" if hi < 200 else f"{lo}+"
    raise ValueError(age)


def read_csv(path: Path):
    with path.open(encoding="utf-8-sig", newline="") as f:
        yield from csv.DictReader(f)


def none_if_blank(v: str):
    return v if v != "" else None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()

    customers = {r["customer_id"]: {"customer_id": r["customer_id"],
                                    "customer_postal_code": r["customer_postal_code"],
                                    "customer_age": int(r["customer_age"])}
                 for r in read_csv(args.raw / "tx_customers_junction.csv")}
    mortgages = {}
    for r in read_csv(args.raw / "mtg_tx_customer_link_and_final_mtg_infio.csv"):
        mortgages[r["customer_id"]] = {k: (float(v) if k.startswith(("final_property", "final_requested",
                                       "final_equity", "final_collateral", "required", "lfinal")) and v else none_if_blank(v))
                                       for k, v in r.items()}

    # Pass 1: per-customer stats and cohort sums.
    stats = defaultdict(lambda: {"income": 0.0, "spend": 0.0, "saving": 0.0, "housing": 0.0,
                                 "salaries": 0, "min_balance": float("inf")})
    cohort_sum = defaultdict(float)  # (band, category) -> total spend in benchmark window
    band_customers = defaultdict(int)
    for c in customers.values():
        band_customers[age_band(c["customer_age"])] += 1

    tx_path = args.raw / "tx_junction_transactions.csv"
    for r in read_csv(tx_path):
        if r["tx_date"] > TODAY:
            continue
        cid, cat, amt = r["customer_id"], r["category"], float(r["tx_amount_eur"])
        s = stats[cid]
        s["min_balance"] = min(s["min_balance"], float(r["balance_after_eur"]))
        if cat in INCOME_CATEGORIES:
            s["income"] += amt
            s["salaries"] += cat == "Salary"
        if cat == "Housing":
            s["housing"] += -amt
        if cat in SAVING_CATEGORIES:
            s["saving"] += -amt
        elif cat not in NOT_SPENDING and amt < 0:
            s["spend"] += -amt
            if BENCH_FROM <= r["tx_date"] <= BENCH_TO:
                cohort_sum[(age_band(customers[cid]["customer_age"]), cat)] += -amt

    # Choose personas deterministically.
    def pick(pred, key):
        cands = sorted((cid for cid in stats if pred(cid)), key=key)
        if not cands:
            raise SystemExit("no candidate for a persona")
        return cands[0]

    age = lambda cid: customers[cid]["customer_age"]
    ratio = lambda cid: stats[cid]["spend"] / max(stats[cid]["income"], 1)
    # "Typical" personas: steady salary, pays housing, ratio close to a target (not extremes).
    steady = lambda c: stats[c]["salaries"] >= 23 and stats[c]["housing"] > 0
    young = pick(lambda c: steady(c) and 20 <= age(c) <= 27 and 0.8 <= ratio(c) <= 0.95,
                 key=lambda c: (abs(ratio(c) - 0.9), c))
    saver = pick(lambda c: steady(c) and c in mortgages and mortgages[c]["final_decision"] == "approved"
                 and stats[c]["saving"] > 0 and 0.6 <= ratio(c) <= 0.85,
                 key=lambda c: (abs(ratio(c) - 0.75), c))
    over = pick(lambda c: steady(c) and 25 <= age(c) <= 45 and ratio(c) > 1.05 and stats[c]["min_balance"] < 0,
                key=lambda c: (abs(ratio(c) - 1.12), c))
    presets = [
        {"customer_id": young, "label": "Young adult", "blurb": f"{age(young)}, first years of working life"},
        {"customer_id": saver, "label": "Home saver", "blurb": f"{age(saver)}, saving and applied for a mortgage"},
        {"customer_id": over, "label": "Over-spender", "blurb": f"{age(over)}, spends more than they earn"},
    ]
    rng = random.Random(2026)
    others = sorted(set(customers) - {young, saver, over})
    pool = sorted(rng.sample(others, RANDOM_POOL))
    chosen = {p["customer_id"] for p in presets} | set(pool)

    # Pass 2: collect transactions for chosen customers (source order = chronological).
    rows = defaultdict(list)
    for r in read_csv(tx_path):
        if r["customer_id"] in chosen and r["tx_date"] <= TODAY:
            rows[r["customer_id"]].append([
                r["tx_date"], to_iso_timestamp(r["tx_timestamp"]), r["category"],
                float(r["tx_amount_eur"]), float(r["balance_after_eur"]), r["transaction_type"],
                none_if_blank(r["merchant_id"]), none_if_blank(r["mcc_code"]),
            ])

    args.out.mkdir(parents=True, exist_ok=True)
    for cid in sorted(chosen):
        bundle = {"customer": customers[cid], "mortgage": mortgages.get(cid),
                  "fields": ROW_FIELDS, "rows": rows[cid]}
        (args.out / f"{cid}.json").write_text(json.dumps(bundle, separators=(",", ":")))

    cohorts = {
        "source": "Synthetic S-Pankki dataset, all 5,100 customers",
        "window": [BENCH_FROM, BENCH_TO],
        "bands": {
            band: {cat: round(total / (band_customers[band] * BENCH_MONTHS), 2)
                   for (b, cat), total in sorted(cohort_sum.items()) if b == band}
            for band in sorted(band_customers)
        },
    }
    (args.out / "cohorts.json").write_text(json.dumps(cohorts, indent=1))
    (args.out / "index.json").write_text(json.dumps(
        {"today": TODAY, "presets": presets, "pool": pool}, indent=1))
    total_rows = sum(len(rows[c]) for c in chosen)
    print(f"Wrote {len(chosen)} customers ({total_rows} transactions), cohorts and index to {args.out}")
    for p in presets:
        c = p["customer_id"]
        print(f"  {p['label']:13} {c} age {age(c)}  spend/income {ratio(c):.2f}  min balance {stats[c]['min_balance']:.0f}")


if __name__ == "__main__":
    main()
