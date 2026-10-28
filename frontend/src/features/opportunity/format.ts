import { centsToCanonical, formatMoney, toCents } from "../../design-system/currencyFormat";

// Formateo de los dos datos numéricos/temporales de Opportunity. Vivían
// como funciones privadas de OpportunityListPage; se extraen acá porque la
// vista de embudo (OpportunityBoardView) muestra exactamente los mismos
// datos en las tarjetas, y dos copias divergirían tarde o temprano.

// "23.000 USD": el formato de montos de todo el sistema (formatMoney, en
// design-system/currencyFormat.ts). Antes era propio —"23000.00 USD"— y el
// inicio, el embudo y el stock se leían distinto que la cotización y los
// pagos (UX-09 de docs-privados/auditoria-2026-10-21/informe-etapa-2.md,
// local). Se conserva el nombre para no tocar a los que lo importan.
export function formatAmount(amount: string, currency: string): string {
  return formatMoney(amount, currency);
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

// Suma de montos AGRUPADA POR MONEDA. currency es cualquier código ISO 4217
// de 3 letras para el backend (el formulario lo acota a USD/UYU desde el
// ítem 18.B de docs/frontend-cambios-pendientes.md, pero lo persistido o
// cargado por API puede traer otros), así que sumar 1500 USD con 300 ARS
// en un solo número sería un dato inventado.
// Devuelve un total por moneda, en orden de primera aparición, y "—" si no
// hay nada que sumar. La suma es en centavos enteros (toCents): sumar floats
// dejaba restos que el formato truncaba distinto según el orden.
export function formatAmountTotals(items: readonly { amount: string; currency: string }[]): string {
  const totals = new Map<string, number>();
  for (const item of items) {
    totals.set(item.currency, (totals.get(item.currency) ?? 0) + toCents(item.amount));
  }
  if (totals.size === 0) return "—";
  return Array.from(totals, ([currency, cents]) =>
    formatAmount(centsToCanonical(cents), currency),
  ).join(" · ");
}
