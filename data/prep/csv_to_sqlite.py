#!/usr/bin/env python3
"""Convert the Junction 2026 S-Pankki CSVs into a per-customer SQLite bundle.

The output database is the personal data store the app ships/loads on-device:
all of one customer's rows across the four source tables.

Usage:
    python3 data/prep/csv_to_sqlite.py --raw data/raw --out data/out [--customer CUST00001]

Requires: pandas (pip install pandas)
Note: the CSVs start with a UTF-8 BOM, so they are read with utf-8-sig.
"""

import argparse
import sqlite3
from pathlib import Path

import pandas as pd


def load_raw(raw: Path) -> dict[str, pd.DataFrame]:
    tables = {
        "transactions": raw / "tx_junction_transactions.csv",
        "customers": raw / "tx_customers_junction.csv",
        "mortgage_events": raw / "mtg_negotiation_history.csv",
        "mortgage_outcomes": raw / "mtg_tx_customer_link_and_final_mtg_infio.csv",
    }
    return {name: pd.read_csv(path, encoding="utf-8-sig") for name, path in tables.items()}


def build_bundle(dfs: dict[str, pd.DataFrame], out: Path, customer_id: str) -> None:
    tx = dfs["transactions"]
    customers = dfs["customers"]
    events = dfs["mortgage_events"]
    outcomes = dfs["mortgage_outcomes"]

    mortgage_ids = outcomes.loc[outcomes["customer_id"] == customer_id, "mortgage_customer_id"]

    bundle = {
        "transactions": tx[tx["customer_id"] == customer_id],
        "customer": customers[customers["customer_id"] == customer_id],
        "mortgage_outcomes": outcomes[outcomes["customer_id"] == customer_id],
        "mortgage_events": events[events["mortgage_customer_id"].isin(mortgage_ids)],
    }

    if bundle["transactions"].empty:
        raise SystemExit(f"No transactions found for {customer_id}")

    out.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(out) as conn:
        for name, df in bundle.items():
            df.to_sql(name, conn, index=False, if_exists="replace")
    print(f"Wrote {out} ({out.stat().st_size / 1e6:.1f} MB)")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--raw", type=Path, required=True, help="Directory with the 4 source CSVs")
    parser.add_argument("--out", type=Path, required=True, help="Output SQLite file")
    parser.add_argument("--customer", default="CUST00001", help="Customer to bundle")
    args = parser.parse_args()

    dfs = load_raw(args.raw)
    build_bundle(dfs, args.out, args.customer)


if __name__ == "__main__":
    main()
