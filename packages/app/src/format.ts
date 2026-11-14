// Amounts and dates as S-mobiili writes them, also in English: "7 320 €", "812,34 €", "15.10.2026".
const eur = new Intl.NumberFormat("fi-FI", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const eurCents = new Intl.NumberFormat("fi-FI", { style: "currency", currency: "EUR", minimumFractionDigits: 2 });
// Intl writes a typographic minus (U+2212); a plain hyphen-minus reads the same and is easier to copy.
const plain = (s: string) => s.replace(/\u2212/g, "-");

export const formatEur = (x: number) => plain(eur.format(Math.round(x) === 0 ? 0 : x));
export const formatEurCents = (x: number) => plain(eurCents.format(x));

export function formatDate(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${Number(d)}.${Number(m)}.${y}`;
}
