#!/usr/bin/env python3
"""Build the merchant category code table, packages/shared/src/mcc.json.

The table is read by the TypeScript engine and by build_database.py, so both classify
transactions from the same file. It has three layers:

1. Labels for every general code, from the public list at
   https://github.com/greggles/mcc-codes (public domain). The 683 codes for individual
   airlines, car rental firms and hotel chains (3000-3999) are left out; the code handles
   them as three ranges.
2. The category each code appears under in the bank's data, for the codes the dataset
   has. A code the data has never shown has no category here: it is taken from the
   customer's own transactions.
3. A basket hint per code where the merchant type says more than the category does: a
   pharmacy and a cosmetics shop, a season ticket and a taxi.

Run it again after changing the hints, or when a bigger dataset brings new codes
(add them to DATASET):

    python3 data/prep/build_mcc_table.py

Standard library only. The result is committed.
"""
from __future__ import annotations

import argparse
import json
import re
import urllib.request
from pathlib import Path

SOURCE = "https://raw.githubusercontent.com/greggles/mcc-codes/main/mcc_codes.json"
DEFAULT_OUT = Path(__file__).resolve().parents[2] / "packages/shared/src/mcc.json"

# The codes in the bank's dataset: short label and the category each one appears under.
DATASET = {
    "4111": ("Local and commuter transport, ferries", "Transportation"),
    "4121": ("Taxis and limousines", "Transportation"),
    "4511": ("Airlines", "Travel"),
    "4722": ("Travel agencies and tour operators", "Travel"),
    "5200": ("Home supply warehouse stores", "Home & Tech"),
    "5251": ("Hardware stores", "Home & Tech"),
    "5411": ("Grocery stores, supermarkets", "Groceries"),
    "5422": ("Meat provisioners", "Groceries"),
    "5451": ("Dairy products stores", "Groceries"),
    "5499": ("Convenience stores and specialty food markets", "Groceries"),
    "5541": ("Service stations", "Transportation"),
    "5542": ("Automated fuel dispensers", "Transportation"),
    "5651": ("Family clothing stores", "Lifestyle"),
    "5691": ("Men's and women's clothing stores", "Lifestyle"),
    "5712": ("Furniture and home furnishings", "Home & Tech"),
    "5732": ("Electronics stores", "Home & Tech"),
    "5734": ("Computer software stores", "Home & Tech"),
    "5812": ("Restaurants and eating places", "Restaurants"),
    "5813": ("Bars, taverns, nightclubs", "Restaurants"),
    "5814": ("Fast food restaurants", "Restaurants"),
    "5912": ("Pharmacies", "Health"),
    "5941": ("Sporting goods stores", "Lifestyle"),
    "5942": ("Book stores", "Lifestyle"),
    "5945": ("Hobby, toy and game shops", "Lifestyle"),
    "5999": ("Miscellaneous specialty retail", "Lifestyle"),
    "7011": ("Hotels and lodging", "Travel"),
    "7512": ("Car rental", "Travel"),
    "7523": ("Parking lots and garages", "Transportation"),
    "7832": ("Cinemas", "Entertainment"),
    "7922": ("Theatre and ticket agencies", "Entertainment"),
    "7991": ("Tourist attractions and exhibits", "Entertainment"),
    "7996": ("Amusement parks", "Entertainment"),
    "7999": ("Other recreation services", "Entertainment"),
    "8011": ("Doctors and physicians", "Health"),
    "8021": ("Dentists and orthodontists", "Health"),
    "8099": ("Other medical services", "Health"),
}

# Basket hints: (basket, rule) per code. The baskets are those of build_database.classify:
#   regular   always a regular essential
#   everyday  always everyday spending
#   health    a regular essential under the health threshold, an unexpected necessity from it
#   home      an unexpected necessity from the large-purchase threshold, everyday below it
#   repair    an unexpected necessity from the repair threshold, everyday below it
# The rule is the name stored on the transaction and explained in the app. For the codes in
# DATASET the hint gives exactly what the category rule gave before, so stored labels do not change.
HINTS: dict[str, tuple[str, str | None]] = {}


def hint(basket: str, rule: str | None, *codes: str) -> None:
    for code in codes:
        assert code not in HINTS, code
        HINTS[code] = (basket, rule)


hint("regular", "groceries", "5411", "5422", "5451", "5462", "5499")
hint("regular", "transport", "4111", "4112", "4131", "4784", "5541", "5542", "7523")
hint("everyday", "taxi", "4121")
hint("regular", "utilities", "4900")
hint("regular", "telecom", "4814")
hint("regular", "insurance", "5960", "6300")
hint("regular", "childcare", "8351")
hint("regular", "education", "8211", "8220")
hint("health", None, "5912", "5975", "5976", "8011", "8021", "8031", "8041", "8042", "8043", "8049", "8050", "8062", "8071", "8099")
hint("home", None, "5200", "5211", "5231", "5251", "5712", "5719", "5722", "5732", "5734")
hint("repair", None, "0742", "1520", "1711", "1731", "1740", "1750", "1761", "1771", "1799", "7531", "7534", "7538", "7549", "7622", "7623", "7629", "7692", "7699")


def tidy(description: str) -> str:
    """The list's descriptions as short labels: one line, plain punctuation, no trailing dot."""
    text = re.sub(r"\s+", " ", description).strip().rstrip(".")
    text = text.replace(" – ", ": ").replace("–", "-").replace(" ,", ",").replace("( ", "(").replace(" )", ")")
    return re.sub(r"\s*\((?:Not Elsewhere Classified|previously [^)]*)\)", "", text, flags=re.I).strip()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--source", default=SOURCE, help="URL or local path of mcc_codes.json")
    args = parser.parse_args()

    if re.match(r"https?://", args.source):
        request = urllib.request.Request(args.source, headers={"user-agent": "python-urllib"})
        with urllib.request.urlopen(request, timeout=60) as response:
            listed = json.load(response)
    else:
        listed = json.loads(Path(args.source).read_text(encoding="utf-8"))

    table: dict[str, dict[str, str]] = {}
    for entry in listed:
        code = entry["mcc"]
        if "3000" <= code <= "3999":
            continue  # one airline, car rental firm or hotel chain each: handled as ranges
        table[code] = {"label": tidy(entry["edited_description"])}
    for code, (label, category) in DATASET.items():
        table[code] = {"label": label, "category": category}
    for code, (basket, rule) in HINTS.items():
        if code not in table:
            raise SystemExit(f"Hint for {code}, which is not in the list")
        table[code]["basket"] = basket
        if rule:
            table[code]["rule"] = rule

    ordered = {code: table[code] for code in sorted(table)}
    lines = ",\n".join(f"  {json.dumps(code)}: {json.dumps(info, ensure_ascii=False)}" for code, info in ordered.items())
    args.out.write_text("{\n" + lines + "\n}\n", encoding="utf-8")
    print(f"Wrote {args.out}: {len(ordered)} codes, {len(DATASET)} with a category from the dataset, {len(HINTS)} with a basket hint")


if __name__ == "__main__":
    main()
