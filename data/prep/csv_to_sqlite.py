#!/usr/bin/env python3
"""Convert the Junction 2026 S-Pankki CSVs into a per-customer SQLite bundle.

The output database is the personal data store for one customer: all of their
rows across the four source tables.

Usage:
    python3 data/prep/csv_to_sqlite.py --raw data/raw --out data/out/CUST00001.sqlite --customer CUST00001

No third-party packages are needed. The CSVs are streamed row by row, so the
346 MB transaction file is never held in memory.

What the bundle guarantees:
  - Identifiers, postal codes and MCC codes are stored as TEXT, so leading zeros
    survive ("00990") and codes do not turn into floats ("5411", not "5411.0").
  - Amounts are REAL and ages are INTEGER.
  - Blank source values are stored as NULL.
  - Timestamps are converted from the source format ("03OCT24:09:04:04") to
    ISO 8601 ("2024-10-03T09:04:04"), which sorts correctly as text.
  - Transactions keep their source file order (SQLite rowid). The running
    balance in `balance_after_eur` follows that order.
"""

import argparse
import csv
import os
import re
import sqlite3
import sys
from pathlib import Path

TEXT, REAL, INTEGER, TIMESTAMP = "TEXT", "REAL", "INTEGER", "TIMESTAMP"

# table name -> (source file, [(column, type), ...]) in source column order
TABLES = {
    "transactions": (
        "tx_junction_transactions.csv",
        [
            ("customer_id", TEXT),
            ("bank_account_id", TEXT),
            ("tx_date", TEXT),
            ("tx_timestamp", TIMESTAMP),
            ("category", TEXT),
            ("tx_amount_eur", REAL),
            ("balance_after_eur", REAL),
            ("transaction_type", TEXT),
            ("merchant_id", TEXT),
            ("mcc_code", TEXT),
        ],
    ),
    "customer": (
        "tx_customers_junction.csv",
        [
            ("customer_id", TEXT),
            ("customer_postal_code", TEXT),
            ("customer_age", INTEGER),
        ],
    ),
    "mortgage_outcomes": (
        "mtg_tx_customer_link_and_final_mtg_infio.csv",
        [
            ("mortgage_customer_id", TEXT),
            ("customer_id", TEXT),
            ("final_decision", TEXT),
            ("rejection_reason", TEXT),
            ("final_property_price_eur", REAL),
            ("final_requested_loan_eur", REAL),
            ("final_equity_amount_eur", REAL),
            ("final_collateral_value_eur", REAL),
            ("required_monthly_income_eur", REAL),
            ("lfinal_loan_to_value", REAL),
        ],
    ),
    "mortgage_events": (
        "mtg_negotiation_history.csv",
        [
            ("mortgage_customer_id", TEXT),
            ("timestamp", TIMESTAMP),
            ("event_type", TEXT),
            ("property_id", TEXT),
            ("property_type", TEXT),
            ("property_price_estimate", REAL),
            ("loan_amount", REAL),
            ("equity_amount", REAL),
            ("collateral_type", TEXT),
            ("collateral_value", REAL),
            ("collateral_status", TEXT),
            ("decision", TEXT),
            ("rejection_reason", TEXT),
            ("expense_type", TEXT),
            ("expense_amount", REAL),
            ("note", TEXT),
        ],
    ),
}

INDEXES = [
    "CREATE INDEX idx_tx_date ON transactions (tx_date)",
    "CREATE INDEX idx_tx_category_date ON transactions (category, tx_date)",
    "CREATE INDEX idx_tx_mcc_date ON transactions (mcc_code, tx_date)",
    "CREATE INDEX idx_mtg_events_time ON mortgage_events (mortgage_customer_id, timestamp)",
]

MONTHS = {
    "JAN": "01", "FEB": "02", "MAR": "03", "APR": "04", "MAY": "05", "JUN": "06",
    "JUL": "07", "AUG": "08", "SEP": "09", "OCT": "10", "NOV": "11", "DEC": "12",
}


SOURCE_TIMESTAMP = re.compile(r"(\d{2})([A-Za-z]{3})(\d{2}):(\d{2}:\d{2}:\d{2})")


def to_iso_timestamp(value: str) -> str:
    """Convert "03OCT24:09:04:04" to "2024-10-03T09:04:04"."""
    match = SOURCE_TIMESTAMP.fullmatch(value)
    month = MONTHS.get(match.group(2).upper()) if match else None
    if month is None:
        raise ValueError(f"unrecognised timestamp {value!r}")
    day, _, year, time_part = match.groups()
    return f"20{year}-{month}-{day}T{time_part}"


CONVERTERS = {
    TEXT: str,
    REAL: float,
    INTEGER: int,
    TIMESTAMP: to_iso_timestamp,
}


def read_rows(
    path: Path, columns: list[tuple[str, str]], key_column: str, keys: set[str] | None
):
    """Yield typed rows from `path` whose `key_column` value is in `keys` (all rows if None)."""
    expected = [name for name, _ in columns]
    converters = [CONVERTERS[kind] for _, kind in columns]
    # utf-8-sig strips the byte order mark the source files start with.
    with open(path, encoding="utf-8-sig", newline="") as handle:
        reader = csv.reader(handle)
        header = next(reader, None)
        if header != expected:
            raise SystemExit(f"{path.name}: unexpected columns {header}, expected {expected}")
        key_index = expected.index(key_column)
        for line_number, row in enumerate(reader, start=2):
            if keys is not None and row[key_index] not in keys:
                continue
            try:
                yield [
                    None if value == "" else convert(value)
                    for value, convert in zip(row, converters, strict=True)
                ]
            except ValueError as error:
                raise SystemExit(f"{path.name} line {line_number}: {error}") from None


def create_table(conn: sqlite3.Connection, table: str, columns: list[tuple[str, str]]) -> None:
    sql_type = {TEXT: "TEXT", REAL: "REAL", INTEGER: "INTEGER", TIMESTAMP: "TEXT"}
    definition = ", ".join(f'"{name}" {sql_type[kind]}' for name, kind in columns)
    conn.execute(f'CREATE TABLE "{table}" ({definition})')


def load(conn: sqlite3.Connection, raw: Path, table: str, key_column: str, keys: set[str]) -> int:
    filename, columns = TABLES[table]
    create_table(conn, table, columns)
    placeholders = ", ".join("?" * len(columns))
    cursor = conn.executemany(
        f'INSERT INTO "{table}" VALUES ({placeholders})',
        read_rows(raw / filename, columns, key_column, keys),
    )
    return cursor.rowcount


def build_bundle(raw: Path, out: Path, customer_id: str) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    # Build next to the target and rename at the end, so a failed run never
    # leaves a half-written bundle behind.
    partial = out.with_name(out.name + ".partial")
    partial.unlink(missing_ok=True)

    conn = sqlite3.connect(partial)
    try:
        counts = {}
        counts["customer"] = load(conn, raw, "customer", "customer_id", {customer_id})
        if counts["customer"] == 0:
            raise SystemExit(f"Customer {customer_id} not found in {TABLES['customer'][0]}")

        counts["mortgage_outcomes"] = load(conn, raw, "mortgage_outcomes", "customer_id", {customer_id})
        mortgage_ids = {
            row[0] for row in conn.execute("SELECT mortgage_customer_id FROM mortgage_outcomes")
        }
        counts["mortgage_events"] = load(
            conn, raw, "mortgage_events", "mortgage_customer_id", mortgage_ids
        )

        counts["transactions"] = load(conn, raw, "transactions", "customer_id", {customer_id})
        if counts["transactions"] == 0:
            raise SystemExit(f"No transactions found for {customer_id}")

        for statement in INDEXES:
            conn.execute(statement)
        conn.commit()
    except BaseException:
        conn.close()
        partial.unlink(missing_ok=True)
        raise
    conn.close()
    os.replace(partial, out)

    summary = ", ".join(f"{count} {table}" for table, count in counts.items())
    print(f"Wrote {out} ({out.stat().st_size / 1e3:.0f} kB): {summary}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--raw", type=Path, required=True, help="Directory with the 4 source CSVs")
    parser.add_argument("--out", type=Path, required=True, help="Output SQLite file")
    parser.add_argument("--customer", default="CUST00001", help="Customer to bundle")
    args = parser.parse_args()

    missing = [name for name, _ in TABLES.values() if not (args.raw / name).is_file()]
    if missing:
        sys.exit(f"Missing in {args.raw}: {', '.join(missing)}")

    build_bundle(args.raw, args.out, args.customer)


if __name__ == "__main__":
    main()
