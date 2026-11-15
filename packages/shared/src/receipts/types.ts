/**
 * Receipts the user photographs, matched to the card payment they belong to.
 *
 * A receipt is read once (agent/receipt.ts), stored by the backend, and linked to one bank
 * transaction. Its lines carry a sub-category from a fixed list, so the engine can add up
 * "sweets in my grocery shopping" (engine/items.ts). Only receipts linked to a transaction count:
 * every item figure is backed by a payment the bank has seen.
 */

/** What a receipt line is. Stable IDs: they are stored, and only their labels are translated. */
export const ITEM_SUBCATEGORIES = [
  // food and drink from a shop
  "produce",
  "meat_fish",
  "dairy_eggs",
  "bread_bakery",
  "pantry",
  "frozen",
  "ready_meals",
  "snacks_sweets",
  "soft_drinks",
  "coffee_tea",
  "alcohol",
  "tobacco",
  // eating out
  "meal",
  "restaurant_drinks",
  "restaurant_alcohol",
  "cafe_snack",
  // everything else
  "household",
  "hygiene_beauty",
  "pharmacy",
  "baby",
  "pet",
  "clothing",
  "electronics",
  "fuel",
  "other",
] as const;
export type ItemSubcategory = (typeof ITEM_SUBCATEGORIES)[number];

/** English labels: for the model and for engine rows. The app shows its own translations. */
export const ITEM_SUBCATEGORY_LABELS: Record<ItemSubcategory, string> = {
  produce: "Fruit and vegetables",
  meat_fish: "Meat and fish",
  dairy_eggs: "Dairy and eggs",
  bread_bakery: "Bread and bakery",
  pantry: "Pantry staples",
  frozen: "Frozen food",
  ready_meals: "Ready meals",
  snacks_sweets: "Snacks and sweets",
  soft_drinks: "Soft drinks",
  coffee_tea: "Coffee and tea",
  alcohol: "Alcohol",
  tobacco: "Tobacco and nicotine",
  meal: "Meals out",
  restaurant_drinks: "Drinks out (non-alcoholic)",
  restaurant_alcohol: "Alcohol out",
  cafe_snack: "Café and snacks out",
  household: "Household",
  hygiene_beauty: "Hygiene and beauty",
  pharmacy: "Pharmacy",
  baby: "Baby",
  pet: "Pet",
  clothing: "Clothing",
  electronics: "Electronics",
  fuel: "Fuel",
  other: "Other",
};

/** Glosses for the reading model: what goes where. */
export const ITEM_SUBCATEGORY_HINTS: Record<ItemSubcategory, string> = {
  produce: "fruit, vegetables, berries, herbs",
  meat_fish: "meat, chicken, fish, cold cuts, sausages",
  dairy_eggs: "milk, yoghurt, cheese, butter, eggs, plant-based milk",
  bread_bakery: "bread, rolls, pastries from the bakery",
  pantry: "pasta, rice, flour, cereals, canned food, sauces, spices, oil",
  frozen: "frozen food except ready meals and ice cream",
  ready_meals: "ready meals, pizzas, salads to go, sandwiches from a shop",
  snacks_sweets: "sweets, chocolate, crisps, biscuits, ice cream, energy bars",
  soft_drinks: "soft drinks, energy drinks, juice, bottled water",
  coffee_tea: "coffee and tea to make at home",
  alcohol: "beer, cider, long drinks, wine bought from a shop",
  tobacco: "cigarettes, snus, nicotine pouches, vapes",
  meal: "food at a restaurant, café, fast food or delivery",
  restaurant_drinks: "non-alcoholic drinks at a restaurant or bar",
  restaurant_alcohol: "alcohol at a restaurant or bar",
  cafe_snack: "coffee, buns and snacks bought to eat out",
  household: "cleaning, paper towels, bin bags, batteries, kitchenware",
  hygiene_beauty: "shampoo, toothpaste, cosmetics, razors",
  pharmacy: "medicines, vitamins, plasters",
  baby: "nappies, baby food",
  pet: "pet food and supplies",
  clothing: "clothes, shoes, accessories",
  electronics: "electronics, chargers, games",
  fuel: "petrol, diesel, charging an electric car",
  other: "anything else, including delivery fees and tips",
};

/**
 * Everyday words for a kind of item itself, in English and Finnish: what a user says when they
 * mean the kind ("sweets", "karkkia"), not a product. Receipt lines are printed in the shop's
 * language and carry product names, so a search for such a word usually finds nothing; the engine
 * then answers with the kind (engine/items.ts). An English entry is a whole word (a plural -s is
 * allowed); an entry ending in * is a Finnish stem, which also takes the word's endings. Several
 * words in one entry must all be there. Only words that name one kind are listed: "alcohol" and
 * "drinks" could be bought in a shop or out, and "coffee" at home or in a café.
 */
export const ITEM_TYPE_WORDS: Partial<Record<ItemSubcategory, readonly string[]>> = {
  produce: ["fruit", "vegetable", "hedelm*", "vihannek*"],
  meat_fish: ["meat", "fish", "liha*", "kala*"],
  dairy_eggs: ["dairy", "maitotuot*"],
  bread_bakery: ["bread", "leip*"],
  frozen: ["frozen food", "pakaste*"],
  ready_meals: ["ready meal", "valmisruo*", "eines*"],
  snacks_sweets: ["sweet", "candy", "candies", "karkk*", "karki*", "makeis*", "namu*"],
  soft_drinks: ["soft drink", "soda", "virvoitusjuom*", "limsa*", "limu*"],
  tobacco: ["tobacco", "nicotine", "tupak*", "nikotiini*"],
  hygiene_beauty: ["hygiene", "cosmetic", "hygieni*", "kosmetiik*"],
  pharmacy: ["medicine", "medication", "laak*"],
  clothing: ["clothes", "clothing", "vaat*"],
  electronics: ["electronics", "elektroniik*"],
  fuel: ["fuel", "petrol", "gasoline", "polttoaine*", "bensa*", "bensiini*"],
};

export const isItemSubcategory = (value: unknown): value is ItemSubcategory =>
  typeof value === "string" && (ITEM_SUBCATEGORIES as readonly string[]).includes(value);

/**
 * `item` is something bought (with its deposit and discounts folded in). `deposit_return` is
 * bottle money paid back (pantti), a negative line that is not spending on anything.
 */
export type LineKind = "item" | "deposit_return";

export interface ReceiptLine {
  name: string;
  subcategory: ItemSubcategory;
  /** Euros paid for the line, after discounts. Negative only for a deposit return. */
  amount: number;
  kind: LineKind;
}

export type PaidBy = "card" | "cash" | "unknown";

/** What was read from a receipt photo. Missing fields are null; nothing is guessed. */
export interface ReceiptRead {
  merchant: string;
  /** The merchant type the shop looks like, a four-digit code from mcc.json. */
  mcc: string | null;
  /** As printed: YYYY-MM-DD and HH:MM. */
  date: string | null;
  time: string | null;
  /** What was paid, in euros. */
  total: number | null;
  paidBy: PaidBy;
  lines: ReceiptLine[];
  /** The lines do not add up to the total (by more than a few cents): something was misread. */
  linesMismatch: boolean;
}

export type MatchConfidence = "strong" | "possible" | "none";

/** Why nothing was matched, when nothing was. */
export type NoMatchReason = "no_total" | "no_date" | "cash" | "after_data_end" | "no_candidates";

/** A card payment the receipt may belong to. */
export interface MatchCandidate {
  txId: number;
  date: string;
  timestamp: string;
  /** Euros out, positive. */
  amount: number;
  category: string;
  mcc: string | null;
  score: number;
}

export interface MatchResult {
  confidence: MatchConfidence;
  /** Best first; at most a handful. */
  candidates: MatchCandidate[];
  reason?: NoMatchReason;
}

export type ReceiptStatus = "unmatched" | "confirmed";

/** A stored receipt as the app gets it. */
export interface ReceiptView extends ReceiptRead {
  id: string;
  createdAt: string;
  status: ReceiptStatus;
  /** The payment it is linked to, when confirmed. */
  txId: number | null;
  /** The link was made by the app (a strong match), not by the user. */
  autoMatched: boolean;
  /** The outcome of matching when the receipt was saved. Not stored: recomputed on demand. */
  match?: MatchResult;
  /** The linked payment, for showing it. */
  payment?: MatchCandidate;
}

/** What the engine gets of a linked receipt. */
export interface LinkedReceipt {
  txId: number;
  /** The shop as printed on the receipt: the bank data has no shop names. */
  merchant: string;
  lines: ReceiptLine[];
}
