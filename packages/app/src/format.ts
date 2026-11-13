const eur = new Intl.NumberFormat("en-FI", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const eurCents = new Intl.NumberFormat("en-FI", { style: "currency", currency: "EUR", minimumFractionDigits: 2 });

export const formatEur = (x: number) => eur.format(Math.round(x) === 0 ? 0 : x);
export const formatEurCents = (x: number) => eurCents.format(x);

export function formatDate(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${Number(d)}.${Number(m)}.${y}`;
}
