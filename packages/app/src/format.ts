import type { Locale } from "./i18n";

const intlLocale = (locale: Locale) => (locale === "fi" ? "fi-FI" : "en-FI");
// Intl writes a typographic minus (U+2212); a plain hyphen-minus reads the same and is easier to copy.
const plain = (s: string) => s.replace(/\u2212/g, "-");

export const formatEur = (x: number, locale: Locale = "en") => plain(new Intl.NumberFormat(intlLocale(locale), { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(Math.round(x) === 0 ? 0 : x));
export const formatEurCents = (x: number, locale: Locale = "en") => plain(new Intl.NumberFormat(intlLocale(locale), { style: "currency", currency: "EUR", minimumFractionDigits: 2 }).format(x));

export function formatDate(iso: string, locale: Locale = "en") {
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number);
  return new Intl.DateTimeFormat(intlLocale(locale), { timeZone: "UTC", year: "numeric", month: "numeric", day: "numeric" }).format(new Date(Date.UTC(year, month - 1, day)));
}
