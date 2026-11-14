#!/usr/bin/env python3
"""Fetch the Statistics Finland figures behind the "you vs Finland" card.

Two open tables from the PxWeb API (https://pxdata.stat.fi, licence CC BY 4.0):

- StatFin/ktutk/14q4.px  Households' consumption 2022 by age of the reference person:
                         euros per month, per household and per consumption unit.
- StatFin/khi/15b5.px    Consumer price index (2025 = 100), monthly, per commodity group.
                         Used to raise the 2022 figures to current prices.

The result is a small snapshot, packages/shared/src/benchmark/statfin.json, which is
committed: the app, the backend and the tests read that file and never call the API.
Run this again to refresh the price index (it gets a new month every month):

    python3 data/prep/fetch_statfin.py

Standard library only.
"""
from __future__ import annotations

import argparse
import itertools
import json
import urllib.request
from datetime import date
from pathlib import Path

API = "https://pxdata.stat.fi/PXWeb/api/v1/en"
CONSUMPTION_TABLE = "StatFin/ktutk/14q4.px"
PRICE_TABLE = "StatFin/khi/15b5.px"
SURVEY_YEAR = "2022"

# Expenditure groups (COICOP) the card uses; see packages/shared/src/benchmark/statfin.ts.
CONSUMPTION_CODES = ["01", "041", "042", "043", "044", "045", "046", "072", "073", "111"]
# The price index has no series for imputed rents (04.2); actual rents (04.1) stand in for it.
PRICE_CODES = ["01", "041", "043", "044", "045", "046", "072", "073", "111"]
MEASURES = {
    "one_adult": "kulukk_kt_hk_2_1",  # per consumption unit, current prices, per month
    "household": "kulukk_kt_hk_1_1",  # per household, current prices, per month
}

DEFAULT_OUT = Path(__file__).resolve().parents[2] / "packages/shared/src/benchmark/statfin.json"


def post(table: str, query: list[dict]) -> dict:
    body = json.dumps({"query": query, "response": {"format": "json-stat2"}}).encode()
    request = urllib.request.Request(
        f"{API}/{table}", data=body, headers={"content-type": "application/json", "user-agent": "python-urllib"}
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.load(response)


def get(table: str) -> dict:
    request = urllib.request.Request(f"{API}/{table}", headers={"user-agent": "python-urllib"})
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.load(response)


def select(code: str, values: list[str]) -> dict:
    return {"code": code, "selection": {"filter": "item", "values": values}}


def cells(dataset: dict):
    """Yields ({dimension: category code}, value) for every cell of a json-stat2 answer."""
    ids = dataset["id"]
    codes = [
        sorted(dataset["dimension"][i]["category"]["index"], key=dataset["dimension"][i]["category"]["index"].get)
        for i in ids
    ]
    for combo, value in zip(itertools.product(*codes), dataset["value"]):
        yield dict(zip(ids, combo)), value


def variable(meta: dict, prefix: str) -> dict:
    return next(v for v in meta["variables"] if v["code"].startswith(prefix))


def fetch_consumption() -> dict:
    meta = get(CONSUMPTION_TABLE)
    coicop = variable(meta, "coicop")["code"]
    age = variable(meta, "ikaryhma")
    bands = [code for code in age["values"] if code != "SSS"]
    data = post(
        CONSUMPTION_TABLE,
        [
            select("timeperiod_y", [SURVEY_YEAR]),
            select(coicop, CONSUMPTION_CODES),
            select(age["code"], bands),
            select("contentscode", list(MEASURES.values())),
        ],
    )
    by_measure = {name: {band: {} for band in bands} for name in MEASURES}
    names = {code: name for name, code in MEASURES.items()}
    missing = []
    for key, value in cells(data):
        # Statistics Finland leaves out a figure when too few households stand behind it
        # (a small group in the oldest age band). It is stored as null and counts as zero.
        if value is None:
            missing.append(f"{key[coicop]} for {key[age['code']]}")
        by_measure[names[key["contentscode"]]][key[age["code"]]][key[coicop]] = value
    if missing:
        print(f"  not published, stored as null: {', '.join(sorted(set(missing)))}")
    return {
        "table": CONSUMPTION_TABLE,
        "title": "Households' consumption by age of the reference person",
        "updated": data["updated"][:10],
        "year": int(SURVEY_YEAR),
        "unit": "EUR per month at current prices",
        **by_measure,
    }


def fetch_prices() -> dict:
    meta = get(PRICE_TABLE)
    coicop = variable(meta, "coicop")["code"]
    months = [m for m in variable(meta, "timeperiod")["values"] if m >= f"{SURVEY_YEAR}M01"]
    data = post(
        PRICE_TABLE,
        [select("timeperiod_m", months), select(coicop, PRICE_CODES), select("contentscode", ["ip_khi"])],
    )
    index: dict[str, dict[str, float]] = {code: {} for code in PRICE_CODES}
    for key, value in cells(data):
        if value is not None:
            index[key[coicop]][key["timeperiod_m"].replace("M", "-")] = value
    for code, series in index.items():
        missing = [m for m in months[:12] if m.replace("M", "-") not in series]
        if missing:
            raise SystemExit(f"Price index {code} has no figure for {missing}")
    return {
        "table": PRICE_TABLE,
        "title": "Consumer price index (2025 = 100)",
        "updated": data["updated"][:10],
        "index": index,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args()

    snapshot = {
        "source": "Statistics Finland",
        "licence": "CC BY 4.0",
        "fetched": date.today().isoformat(),
        "consumption": fetch_consumption(),
        "prices": fetch_prices(),
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(snapshot, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    prices = snapshot["prices"]["index"]["01"]
    print(f"Wrote {args.out}")
    print(f"  consumption {SURVEY_YEAR}: {len(snapshot['consumption']['one_adult'])} age groups, {len(CONSUMPTION_CODES)} groups")
    print(f"  price index: {min(prices)} to {max(prices)}")


if __name__ == "__main__":
    main()
