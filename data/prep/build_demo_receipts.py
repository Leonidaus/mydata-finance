#!/usr/bin/env python3
"""Build printable demo receipts that match one fixture customer's real card payments.

The dataset is synthetic and ends on 2026-09-30, so a receipt photographed today cannot match
anything in it. For the demo, this prints receipts whose total, date, time (two minutes before the
card payment) and kind of shop fit actual payments of one customer. The matcher in the app is real;
only its input is prepared. Photograph a receipt from the screen or from paper and send it in the
chat.

Writes to data/out/demo-receipts/ (gitignored):
  index.html      the receipts, one per card, thermal-receipt style; print it or show it on a screen
  expected.json   what each receipt says, line by line: compare with what the app read

Picks, for the customer:
  1. the latest grocery payment (MCC 5411) with sweets and soft drinks in it
  2. the latest restaurant payment (5812/5814) with alcohol
  3. the latest fuel-station payment (5542) with fuel and snacks
  4. a grocery receipt dated after the end of the data, to show the "after the data ends" case

Shop and product names are made up. Usage:
    python3 data/prep/build_demo_receipts.py [--customer CUST01700]

No third-party packages are needed.
"""

import argparse
import html
import json
import random
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "packages" / "app" / "public" / "fixtures"
OUT = ROOT / "data" / "out" / "demo-receipts"

# (name, price, subcategory, deposit) per kind of shop. The first ones tell the demo's story.
GROCERY_STORY = [
    ("Maitosuklaa 200g", 3.99, "snacks_sweets", 0),
    ("Irtokarkit 380g", 4.18, "snacks_sweets", 0),
    ("Perunalastut 275g", 3.49, "snacks_sweets", 0),
    ("Cola 1,5l", 2.49, "soft_drinks", 0.40),
    ("Energiajuoma 0,5l", 2.19, "soft_drinks", 0.15),
]
GROCERY_REST = [
    ("Banaani 1,02kg", 1.94, "produce", 0),
    ("Kurkku", 1.49, "produce", 0),
    ("Maito 1l", 1.25, "dairy_eggs", 0),
    ("Juusto 500g", 5.89, "dairy_eggs", 0),
    ("Kananmunat 10kpl", 3.19, "dairy_eggs", 0),
    ("Ruisleipä 6kpl", 2.39, "bread_bakery", 0),
    ("Jauheliha 400g", 4.89, "meat_fish", 0),
    ("Lohifilee 300g", 7.95, "meat_fish", 0),
    ("Spagetti 500g", 1.29, "pantry", 0),
    ("Pakastepizza", 3.89, "ready_meals", 0),
    ("Kahvi 500g", 6.49, "coffee_tea", 0),
    ("Talouspaperi 4rl", 3.95, "household", 0),
    ("Hammastahna", 2.49, "hygiene_beauty", 0),
]
RESTAURANT = [
    ("Hampurilaisateria", 14.90, "meal", 0),
    ("Olut 0,5l", 8.50, "restaurant_alcohol", 0),
    ("Lasi punaviiniä", 9.50, "restaurant_alcohol", 0),
    ("Virvoitusjuoma", 4.50, "restaurant_drinks", 0),
    ("Jälkiruoka", 7.50, "meal", 0),
]
FUEL_SHOP = [
    ("Kahvi iso", 2.90, "cafe_snack", 0),
    ("Korvapuusti", 3.20, "cafe_snack", 0),
    ("Suklaapatukka", 2.19, "snacks_sweets", 0),
    ("Energiajuoma 0,33l", 2.79, "soft_drinks", 0.15),
]

SHOPS = {
    "grocery": ("RUOKAKAUPPA KAMPPI", "5411"),
    "restaurant": ("BISTRO ESPLANADI", "5812"),
    "fuel": ("ASEMA LAUTTASAARI", "5542"),
}


def load_customer(customer_id):
    bundle = json.loads((FIXTURES / f"{customer_id}.json").read_text(encoding="utf-8"))
    fields = bundle["fields"]
    return [dict(zip(fields, row)) for row in bundle["rows"]]


def latest(tx, codes, today):
    """The latest card purchase at one of the merchant codes, on or before today."""
    found = [t for t in tx if t["transaction_type"] == "purchase" and t["tx_amount_eur"] < 0
             and t["mcc_code"] in codes and t["tx_date"] <= today]
    if not found:
        raise SystemExit(f"No card purchase with MCC {', '.join(codes)} for this customer")
    return found[-1]


def fill(total, story, rest, remainder, rng, min_last=1.0):
    """Lines whose amounts (with deposits) add up exactly to total: the story first, then the rest.
    The last line takes what is left, at least min_last (a meal, the fuel)."""
    lines = []
    left = round(total, 2)

    def add(name, price, sub, deposit):
        nonlocal left
        cost = round(price + deposit, 2)
        if cost > left - min_last:
            return False
        lines.append({"name": name, "amount": price, "type": "item", "subcategory": sub})
        if deposit:
            lines.append({"name": "PANTTI", "amount": deposit, "type": "deposit"})
        left = round(left - cost, 2)
        return True

    for item in story:
        add(*item)
    pool = list(rest)
    rng.shuffle(pool)
    for item in pool:
        add(*item)
    name, sub = remainder
    lines.append({"name": name, "amount": round(left, 2), "type": "item", "subcategory": sub})
    return lines


def receipt(kind, t, lines, when=None):
    shop, mcc = SHOPS[kind]
    paid = datetime.fromisoformat(t["tx_timestamp"]) if when is None else when
    printed = paid - timedelta(minutes=2)
    total = round(-t["tx_amount_eur"], 2)
    return {
        "kind": kind,
        "merchant": shop,
        "mcc": mcc,
        "date": printed.strftime("%Y-%m-%d"),
        "time": printed.strftime("%H:%M"),
        "total": total,
        "paidBy": "card",
        "lines": lines,
        "matches": None if when is not None else {"tx_timestamp": t["tx_timestamp"], "amount": total},
    }


def eur(x):
    return f"{x:,.2f}".replace(",", " ").replace(".", ",")


def render(r):
    rows = []
    for line in r["lines"]:
        name = "  PANTTI" if line["type"] == "deposit" else line["name"].upper()
        rows.append(f"<tr><td>{html.escape(name)}</td><td>{eur(line['amount'])}</td></tr>")
    date = datetime.strptime(r["date"], "%Y-%m-%d").strftime("%d.%m.%Y")
    return f"""
<section class="receipt">
  <p class="shop">{html.escape(r['merchant'])}</p>
  <p class="center">Y-tunnus 1234567-8</p>
  <p class="center">{date} {r['time']}</p>
  <hr>
  <table>{''.join(rows)}</table>
  <hr>
  <table><tr class="total"><td>YHTEENSÄ</td><td>{eur(r['total'])}</td></tr></table>
  <hr>
  <p>KORTTIMAKSU&nbsp;&nbsp;DEBIT ****1234</p>
  <p>MAKSETTU {eur(r['total'])} EUR</p>
  <p class="center">KIITOS KÄYNNISTÄ!</p>
  <p class="note">{'Matches the card payment at ' + r['matches']['tx_timestamp'].replace('T', ' ') if r['matches'] else 'Dated after the end of the data: no payment to match'}</p>
</section>"""


PAGE = """<!doctype html>
<html lang="fi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Demo receipts</title>
<style>
  body {{ margin: 0; padding: 24px; background: #ddd; font-family: "Courier New", monospace; }}
  h1 {{ font: 600 16px system-ui, sans-serif; margin: 0 0 16px; }}
  .wrap {{ display: flex; flex-wrap: wrap; gap: 24px; align-items: flex-start; }}
  .receipt {{ width: 300px; background: #fff; padding: 20px 18px; box-shadow: 0 2px 6px rgb(0 0 0 / .2); font-size: 14px; color: #111; }}
  .receipt p {{ margin: 2px 0; }}
  .shop {{ text-align: center; font-weight: 700; font-size: 17px; }}
  .center {{ text-align: center; }}
  table {{ width: 100%; border-collapse: collapse; }}
  td:last-child {{ text-align: right; white-space: nowrap; padding-left: 8px; }}
  .total td {{ font-weight: 700; font-size: 16px; }}
  hr {{ border: 0; border-top: 1px dashed #555; }}
  .note {{ margin-top: 12px !important; font: 11px system-ui, sans-serif; color: #777; }}
  @media print {{ body {{ background: #fff; padding: 0; }} .receipt {{ box-shadow: none; break-inside: avoid; }} .note, h1 {{ display: none; }} }}
</style></head>
<body><h1>Demo receipts for {customer} (data up to {today})</h1><div class="wrap">{receipts}</div></body></html>
"""


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--customer", default=None, help="customer id; default: the first preset")
    parser.add_argument("--out", default=str(OUT))
    args = parser.parse_args()

    index = json.loads((FIXTURES / "index.json").read_text(encoding="utf-8"))
    today = index["today"]
    customer = args.customer or index["presets"][0]["customer_id"]
    tx = load_customer(customer)
    rng = random.Random(customer)

    grocery = latest(tx, {"5411"}, today)
    restaurant = latest(tx, {"5812", "5814"}, today)
    fuel = latest(tx, {"5542"}, today)
    receipts = [
        receipt("grocery", grocery, fill(-grocery["tx_amount_eur"], GROCERY_STORY, GROCERY_REST, ("Hedelmät irto", "produce"), rng)),
        receipt("restaurant", restaurant, fill(-restaurant["tx_amount_eur"], RESTAURANT[:2], RESTAURANT[2:], ("Päivän annos", "meal"), rng, min_last=11.0)),
        receipt("fuel", fuel, fill(-fuel["tx_amount_eur"], FUEL_SHOP, [], ("Polttoaine 95E10", "fuel"), rng, min_last=15.0)),
        receipt("grocery", grocery, fill(-grocery["tx_amount_eur"], GROCERY_STORY[:2], GROCERY_REST, ("Hedelmät irto", "produce"), rng),
                when=datetime(2026, 10, 2, 17, 45)),
    ]
    for r in receipts:
        assert abs(sum(line["amount"] for line in r["lines"]) - r["total"]) < 0.005, r

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    (out / "index.html").write_text(PAGE.format(customer=customer, today=today, receipts="".join(render(r) for r in receipts)), encoding="utf-8")
    (out / "expected.json").write_text(json.dumps({"customer": customer, "today": today, "receipts": receipts}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {len(receipts)} receipts for {customer} to {out / 'index.html'}")
    for r in receipts:
        print(f"  {r['merchant']:<22} {r['date']} {r['time']}  {eur(r['total']):>8} €  {'matches ' + r['matches']['tx_timestamp'] if r['matches'] else 'after the data ends'}")


if __name__ == "__main__":
    main()
