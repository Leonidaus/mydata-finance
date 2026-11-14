#!/usr/bin/env python3
"""Build the application database: every customer, with labels and summaries.

Usage:
    python3 data/prep/build_database.py --raw data/raw --out data/out/finance.sqlite

The backend opens this file read-only. It holds the four source tables, typed
the same way as the per-customer bundles from csv_to_sqlite.py, plus:

  transactions.flow         income | spending | saving | saving_withdrawal
  transactions.basket       regular | irregular | everyday (spending only)
  transactions.basket_rule  which rule assigned the basket (for explanations)
  transactions.is_large     1 for card purchases of LARGE_PURCHASE_EUR or more
  monthly_summary           per customer and month: income, baskets, saving, balance
  customer_profile          per customer: cohort keys and monthly averages
  customer_category_avg     per customer and category: average monthly spend
  cohort_stats              percentiles of those averages per age band and area
  meta                      demo date, rule thresholds, row counts

The basket rules live in `classify` below. The finance engine applies the same
rules in TypeScript (packages/shared/src/engine/baskets.ts) to transactions that
carry no label; change both together and bump RULES_VERSION.

"Today" for the demo is fixed with --today: summaries ignore later transactions,
and the averages use the last AVERAGE_WINDOW_MONTHS complete months before it,
the same window the engine uses for a customer's own monthly averages.
"""

import argparse
import json
import os
import sqlite3
import sys
import time
from datetime import date, datetime, timezone
from pathlib import Path

from csv_to_sqlite import INTEGER, REAL, TABLES, TEXT, create_table, read_rows

RULES_VERSION = "2"
DEFAULT_TODAY = "2026-09-15"

# A card purchase of this size or more counts as large.
LARGE_PURCHASE_EUR = 500.0
# Health purchases of this size or more count as an unexpected necessity.
HEALTH_IRREGULAR_EUR = 100.0
# Monthly averages and cohort benchmarks cover this many complete months before today.
AVERAGE_WINDOW_MONTHS = 12
TAXI_MCC = "4121"

AGE_BANDS = [(18, 24), (25, 34), (35, 44), (45, 54), (55, 64), (65, 200)]

DERIVED_COLUMNS = [("flow", TEXT), ("basket", TEXT), ("basket_rule", TEXT), ("is_large", INTEGER)]


def classify(transaction_type: str, category: str, mcc_code: str | None, amount: float):
    """Return (flow, basket, basket_rule, is_large) for one transaction.

    The three baskets apply to spending only:
      regular     mandatory and regular (housing, utilities, groceries, getting around,
                  routine health costs)
      irregular   mandatory and irregular, the "unexpected necessities" (a large health
                  or home purchase)
      everyday    everything discretionary, large or small

    This dataset has no recurring payments at merchant level (no customer pays one
    merchant a steady amount month after month), so the rules use transaction
    type, category, MCC and amount only.
    """
    if transaction_type in ("salary", "other_income"):
        return ("income", None, transaction_type, 0)
    if transaction_type == "investment_withdrawal":
        return ("saving_withdrawal", None, transaction_type, 0)
    if transaction_type in ("investment_deposit", "salary_sweep"):
        return ("saving", None, transaction_type, 0)
    if transaction_type == "housing_payment":
        return ("spending", "regular", "housing", 0)
    if transaction_type == "utilities_payment":
        return ("spending", "regular", "utilities", 0)
    if transaction_type != "purchase":
        raise ValueError(f"unknown transaction_type {transaction_type!r}")

    size = -amount
    is_large = int(size >= LARGE_PURCHASE_EUR)
    if category == "Groceries":
        return ("spending", "regular", "groceries", is_large)
    if category == "Transportation":
        if mcc_code == TAXI_MCC:
            return ("spending", "everyday", "taxi", is_large)
        return ("spending", "regular", "transport", is_large)
    if category == "Health":
        if size >= HEALTH_IRREGULAR_EUR:
            return ("spending", "irregular", "health_large", is_large)
        return ("spending", "regular", "health_routine", is_large)
    if category == "Home & Tech":
        if is_large:
            return ("spending", "irregular", "home_large", is_large)
        return ("spending", "everyday", "home_small", is_large)
    return ("spending", "everyday", "discretionary", is_large)


def age_band(age: int) -> str:
    for low, high in AGE_BANDS:
        if low <= age <= high:
            return f"{low}+" if high >= 200 else f"{low}-{high}"
    return "under-18"


def percentile(sorted_values: list[float], fraction: float) -> float:
    """Linear-interpolated percentile of an already sorted, non-empty list."""
    position = (len(sorted_values) - 1) * fraction
    lower = int(position)
    upper = min(lower + 1, len(sorted_values) - 1)
    weight = position - lower
    return sorted_values[lower] * (1 - weight) + sorted_values[upper] * weight


def load_source_tables(conn: sqlite3.Connection, raw: Path) -> dict[str, int]:
    counts = {}

    # transactions: source columns plus the derived label columns, with a stable id
    filename, columns = TABLES["transactions"]
    names = [name for name, _ in columns]
    i_type, i_cat = names.index("transaction_type"), names.index("category")
    i_mcc, i_amount = names.index("mcc_code"), names.index("tx_amount_eur")
    all_columns = columns + DERIVED_COLUMNS
    sql_type = {TEXT: "TEXT", REAL: "REAL", INTEGER: "INTEGER", "TIMESTAMP": "TEXT"}
    definition = ", ".join(f'"{name}" {sql_type[kind]}' for name, kind in all_columns)
    conn.execute(f"CREATE TABLE transactions (tx_id INTEGER PRIMARY KEY, {definition})")

    def labelled_rows():
        for row in read_rows(raw / filename, columns, "customer_id", None):
            yield row + list(classify(row[i_type], row[i_cat], row[i_mcc], row[i_amount]))

    column_list = ", ".join(f'"{name}"' for name, _ in all_columns)
    placeholders = ", ".join("?" * len(all_columns))
    cursor = conn.executemany(
        f"INSERT INTO transactions ({column_list}) VALUES ({placeholders})", labelled_rows()
    )
    counts["transactions"] = cursor.rowcount

    for table, target in (
        ("customer", "customers"),
        ("mortgage_outcomes", "mortgage_outcomes"),
        ("mortgage_events", "mortgage_events"),
    ):
        filename, columns = TABLES[table]
        create_table(conn, target, columns)
        placeholders = ", ".join("?" * len(columns))
        cursor = conn.executemany(
            f'INSERT INTO "{target}" VALUES ({placeholders})',
            read_rows(raw / filename, columns, columns[0][0], None),
        )
        counts[target] = cursor.rowcount

    conn.execute("CREATE INDEX idx_tx_customer_date ON transactions (customer_id, tx_date)")
    conn.execute("CREATE UNIQUE INDEX idx_customers_id ON customers (customer_id)")
    conn.execute("CREATE INDEX idx_outcomes_customer ON mortgage_outcomes (customer_id)")
    conn.execute(
        "CREATE INDEX idx_events_customer_time ON mortgage_events (mortgage_customer_id, timestamp)"
    )
    return counts


def build_monthly_summary(conn: sqlite3.Connection, today: str) -> None:
    current_month = today[:7]
    conn.execute(
        """
        CREATE TABLE monthly_summary AS
        SELECT
            customer_id,
            substr(tx_date, 1, 7) AS month,
            round(sum(CASE WHEN flow = 'income' THEN tx_amount_eur ELSE 0 END), 2) AS income,
            round(-sum(CASE WHEN basket = 'regular' THEN tx_amount_eur ELSE 0 END), 2) AS regular,
            round(-sum(CASE WHEN basket = 'irregular' THEN tx_amount_eur ELSE 0 END), 2) AS irregular,
            round(-sum(CASE WHEN basket = 'everyday' THEN tx_amount_eur ELSE 0 END), 2) AS everyday,
            round(-sum(CASE WHEN flow = 'saving' THEN tx_amount_eur ELSE 0 END), 2) AS saving,
            round(sum(CASE WHEN flow = 'saving_withdrawal' THEN tx_amount_eur ELSE 0 END), 2)
                AS saving_withdrawal,
            -- net: income minus spending, before any transfer to or from savings
            round(sum(CASE WHEN flow IN ('income', 'spending') THEN tx_amount_eur ELSE 0 END), 2) AS net,
            -- balance_change: everything that moved the account balance
            round(sum(tx_amount_eur), 2) AS balance_change,
            round(min(balance_after_eur), 2) AS min_balance,
            max(tx_id) AS last_tx_id,
            count(*) AS transactions,
            CASE WHEN substr(tx_date, 1, 7) = :current_month THEN 1 ELSE 0 END AS is_partial
        FROM transactions
        WHERE tx_date <= :today
        GROUP BY customer_id, substr(tx_date, 1, 7)
        """,
        {"today": today, "current_month": current_month},
    )
    conn.execute("ALTER TABLE monthly_summary ADD COLUMN end_balance REAL")
    conn.execute(
        """
        UPDATE monthly_summary SET end_balance =
            (SELECT balance_after_eur FROM transactions WHERE tx_id = monthly_summary.last_tx_id)
        """
    )
    conn.execute("ALTER TABLE monthly_summary DROP COLUMN last_tx_id")
    conn.execute("CREATE UNIQUE INDEX idx_summary ON monthly_summary (customer_id, month)")


def build_customer_tables(conn: sqlite3.Connection, today: str) -> tuple[int, str, str]:
    """Create customer_profile and customer_category_avg.

    Returns the averaging window: (number of months, first month, last month).
    """
    current_month = today[:7]
    window = [row[0] for row in conn.execute(
        "SELECT DISTINCT month FROM monthly_summary WHERE month < ? ORDER BY month DESC LIMIT ?",
        (current_month, AVERAGE_WINDOW_MONTHS),
    )]
    if not window:
        raise SystemExit(f"No complete months before {today}")
    complete_months, first_month, last_month = len(window), window[-1], window[0]

    conn.create_function("age_band", 1, age_band, deterministic=True)
    # Averages divide by the number of months in the window, not by the months a
    # customer happened to be active, so a quiet month counts as zero.
    conn.execute(
        """
        CREATE TABLE customer_profile AS
        SELECT
            c.customer_id,
            c.customer_age AS age,
            age_band(c.customer_age) AS age_band,
            c.customer_postal_code AS postal_code,
            substr(c.customer_postal_code, 1, 2) AS postal_area,
            EXISTS (SELECT 1 FROM mortgage_outcomes o WHERE o.customer_id = c.customer_id)
                AS has_mortgage_application,
            round(coalesce(sum(m.income), 0) / :n, 2) AS avg_income,
            round(coalesce(sum(m.regular), 0) / :n, 2) AS avg_regular,
            round(coalesce(sum(m.irregular), 0) / :n, 2) AS avg_irregular,
            round(coalesce(sum(m.everyday), 0) / :n, 2) AS avg_everyday,
            round(coalesce(sum(m.saving), 0) / :n, 2) AS avg_saving,
            round(coalesce(sum(m.net), 0) / :n, 2) AS avg_net,
            coalesce(sum(m.min_balance < 0), 0) AS months_below_zero
        FROM customers c
        LEFT JOIN monthly_summary m
            ON m.customer_id = c.customer_id AND m.month BETWEEN :first_month AND :last_month
        GROUP BY c.customer_id
        """,
        {"n": complete_months, "first_month": first_month, "last_month": last_month},
    )
    conn.execute("CREATE UNIQUE INDEX idx_profile ON customer_profile (customer_id)")

    conn.execute(
        """
        CREATE TABLE customer_category_avg AS
        SELECT
            customer_id,
            category,
            round(-sum(tx_amount_eur) / :n, 2) AS monthly_avg,
            count(*) AS transactions
        FROM transactions
        WHERE flow = 'spending' AND substr(tx_date, 1, 7) BETWEEN :first_month AND :last_month
        GROUP BY customer_id, category
        """,
        {"n": complete_months, "first_month": first_month, "last_month": last_month},
    )
    conn.execute(
        "CREATE UNIQUE INDEX idx_category_avg ON customer_category_avg (customer_id, category)"
    )
    return complete_months, first_month, last_month


def build_cohort_stats(conn: sqlite3.Connection) -> int:
    """Percentiles of the per-customer monthly averages, per cohort and for everyone."""
    profiles = conn.execute(
        """SELECT customer_id, age_band, postal_area,
                  avg_income, avg_regular, avg_irregular, avg_everyday, avg_saving
           FROM customer_profile"""
    ).fetchall()
    categories = [row[0] for row in conn.execute(
        "SELECT DISTINCT category FROM customer_category_avg ORDER BY 1"
    )]
    category_avg = {
        (customer_id, category): value
        for customer_id, category, value in conn.execute(
            "SELECT customer_id, category, monthly_avg FROM customer_category_avg"
        )
    }

    # cohort key -> metric -> list of customer values
    cohorts: dict[tuple[str, str], dict[str, list[float]]] = {}
    for customer_id, band, area, income, regular, irregular, everyday, saving in profiles:
        values = {
            "income": income,
            "basket:regular": regular,
            "basket:irregular": irregular,
            "basket:everyday": everyday,
            "saving": saving,
        }
        for category in categories:
            # A customer who never buys in a category counts as zero, not as missing.
            values[f"category:{category}"] = category_avg.get((customer_id, category), 0.0)
        for key in ((band, area), (band, "all"), ("all", area), ("all", "all")):
            metrics = cohorts.setdefault(key, {})
            for metric, value in values.items():
                metrics.setdefault(metric, []).append(value)

    conn.execute(
        """CREATE TABLE cohort_stats (
               age_band TEXT, postal_area TEXT, metric TEXT, customers INTEGER,
               p10 REAL, p25 REAL, p50 REAL, p75 REAL, p90 REAL, mean REAL)"""
    )
    rows = []
    for (band, area), metrics in cohorts.items():
        for metric, values in metrics.items():
            values.sort()
            rows.append((
                band, area, metric, len(values),
                *(round(percentile(values, f), 2) for f in (0.10, 0.25, 0.50, 0.75, 0.90)),
                round(sum(values) / len(values), 2),
            ))
    conn.executemany("INSERT INTO cohort_stats VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", rows)
    conn.execute(
        "CREATE UNIQUE INDEX idx_cohort ON cohort_stats (age_band, postal_area, metric)"
    )
    return len(rows)


def keep_only(conn: sqlite3.Connection, customer_ids: list[str]) -> int:
    """Drop the transactions and per-customer rows of everyone not in `customer_ids`.

    Cohort statistics stay as computed from all customers, so peer comparisons are
    unchanged. Returns the number of customers kept.
    """
    conn.execute("CREATE TEMP TABLE keep (customer_id TEXT PRIMARY KEY)")
    conn.executemany("INSERT OR IGNORE INTO keep VALUES (?)", [(c,) for c in customer_ids])
    (kept,) = conn.execute(
        "SELECT count(*) FROM customers WHERE customer_id IN (SELECT customer_id FROM keep)"
    ).fetchone()
    if kept != len(set(customer_ids)):
        raise SystemExit("--keep-customers names customers that are not in the data")
    conn.execute(
        """DELETE FROM mortgage_events WHERE mortgage_customer_id IN (
               SELECT mortgage_customer_id FROM mortgage_outcomes
               WHERE customer_id NOT IN (SELECT customer_id FROM keep))"""
    )
    for table in ("transactions", "customers", "mortgage_outcomes", "monthly_summary",
                  "customer_profile", "customer_category_avg"):
        conn.execute(f"DELETE FROM {table} WHERE customer_id NOT IN (SELECT customer_id FROM keep)")
    conn.execute("DROP TABLE keep")
    return kept


def build(raw: Path, out: Path, today: str, keep_customers: list[str] | None = None) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    partial = out.with_name(out.name + ".partial")
    partial.unlink(missing_ok=True)

    started = time.monotonic()
    conn = sqlite3.connect(partial)
    try:
        conn.execute("PRAGMA journal_mode = OFF")
        conn.execute("PRAGMA synchronous = OFF")

        counts = load_source_tables(conn, raw)
        print(f"  loaded source tables ({time.monotonic() - started:.0f}s)", flush=True)

        (first_date, last_date) = conn.execute(
            "SELECT min(tx_date), max(tx_date) FROM transactions"
        ).fetchone()
        if not first_date <= today <= last_date:
            raise SystemExit(f"--today {today} is outside the data ({first_date} to {last_date})")

        build_monthly_summary(conn, today)
        window_months, window_first, window_last = build_customer_tables(conn, today)
        cohort_rows = build_cohort_stats(conn)
        print(f"  built summaries and cohorts ({time.monotonic() - started:.0f}s)", flush=True)

        source_customers = counts["customers"]
        if keep_customers:
            counts["customers"] = keep_only(conn, keep_customers)
            (counts["transactions"],) = conn.execute("SELECT count(*) FROM transactions").fetchone()
            for table in ("mortgage_outcomes", "mortgage_events"):
                (counts[table],) = conn.execute(f"SELECT count(*) FROM {table}").fetchone()

        conn.execute("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)")
        meta = {
            "demo_today": today,
            "built_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "rules_version": RULES_VERSION,
            "large_purchase_eur": LARGE_PURCHASE_EUR,
            "health_irregular_eur": HEALTH_IRREGULAR_EUR,
            "first_tx_date": first_date,
            "last_tx_date": last_date,
            "average_window_months": window_months,
            "average_window_first_month": window_first,
            "average_window_last_month": window_last,
            "cohort_customers": source_customers,
            **{f"rows_{table}": count for table, count in counts.items()},
        }
        conn.executemany("INSERT INTO meta VALUES (?, ?)", [(k, str(v)) for k, v in meta.items()])
        conn.commit()
        if keep_customers:
            conn.execute("VACUUM")
        conn.execute("ANALYZE")
        conn.commit()
    except BaseException:
        conn.close()
        partial.unlink(missing_ok=True)
        raise
    conn.close()
    os.replace(partial, out)

    print(
        f"Wrote {out} ({out.stat().st_size / 1e6:.0f} MB) in {time.monotonic() - started:.0f}s: "
        f"{counts['transactions']:,} transactions, {counts['customers']:,} customers "
        f"(cohorts from {source_customers:,}), "
        f"averages over {window_first} to {window_last}, {cohort_rows} cohort rows"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--raw", type=Path, required=True, help="Directory with the 4 source CSVs")
    parser.add_argument("--out", type=Path, required=True, help="Output SQLite file")
    parser.add_argument(
        "--today", default=DEFAULT_TODAY,
        help=f"The demo's fixed current date, YYYY-MM-DD (default {DEFAULT_TODAY})",
    )
    parser.add_argument(
        "--keep-customers", metavar="IDS",
        help="Comma-separated customer ids, or a path to the app's fixtures index.json. "
             "Keeps only their transactions, for a small database to deploy; cohort "
             "statistics are still computed from all customers.",
    )
    args = parser.parse_args()

    keep = None
    if args.keep_customers:
        if Path(args.keep_customers).is_file():
            index = json.loads(Path(args.keep_customers).read_text())
            keep = [p["customer_id"] for p in index["presets"]] + list(index["pool"])
        else:
            keep = [c.strip() for c in args.keep_customers.split(",") if c.strip()]

    try:
        date.fromisoformat(args.today)
    except ValueError:
        sys.exit(f"--today must be YYYY-MM-DD, got {args.today!r}")
    missing = [name for name, _ in TABLES.values() if not (args.raw / name).is_file()]
    if missing:
        sys.exit(f"Missing in {args.raw}: {', '.join(missing)}")

    build(args.raw, args.out, args.today, keep)


if __name__ == "__main__":
    main()
