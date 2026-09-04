// Formateo de los dos datos numéricos/temporales de Opportunity. Vivían
// como funciones privadas de OpportunityListPage; se extraen acá porque la
// vista de embudo (OpportunityBoardView) muestra exactamente los mismos
// datos en las tarjetas, y dos copias divergirían tarde o temprano.

// amount siempre llega como string desde la API (Prisma.Decimal, ver
// types.ts) — Number() antes de formatear, nunca .toFixed() directo sobre
// el string crudo.
export function formatAmount(amount: string, currency: string): string {
  return `${Number(amount).toFixed(2)} ${currency}`;
}

// Fecha sola (sin hora) a partir del ISO de la API. Se toma solo la parte
// YYYY-MM-DD y se formatea en UTC: mismo criterio que el slice(0,10) del
// formulario, para que un "2026-08-15T00:00:00.000Z" no se corra al 14 en
// una zona horaria negativa.
export function formatDate(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("es", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

// Suma de montos AGRUPADA POR MONEDA. currency es texto libre ISO 4217 en
// el backend (cualquier código de 3 letras, ver OpportunityFormPage), así
// que sumar 1500 USD con 300 ARS en un solo número sería un dato inventado.
// Devuelve un total por moneda, en orden de primera aparición, y "—" si no
// hay nada que sumar. Number() sobre cada amount: nunca concatenar strings.
export function formatAmountTotals(items: readonly { amount: string; currency: string }[]): string {
  const totals = new Map<string, number>();
  for (const item of items) {
    totals.set(item.currency, (totals.get(item.currency) ?? 0) + Number(item.amount));
  }
  if (totals.size === 0) return "—";
  return Array.from(totals, ([currency, total]) => formatAmount(String(total), currency)).join(
    " · ",
  );
}
