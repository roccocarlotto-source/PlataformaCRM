import { formatAmount } from "../../design-system/currencyFormat";
import type { Quote } from "./types";

// ---------------------------------------------------------------------------
// Importes de la cotización. Funciones puras, sin React (format.test.ts).
//
// Todo pasa por CENTAVOS ENTEROS: el total es el precio más la suma de las
// líneas, y sumar los strings convertidos a float ("0.1" + "0.2") dejaría
// restos que el formato después redondearía de maneras distintas según el
// orden. Los importes del backend traen a lo sumo dos decimales, así que
// Math.round(x * 100) es exacto.
// ---------------------------------------------------------------------------

export function toCents(amount: string): number {
  return Math.round(Number(amount) * 100);
}

// Exportada para el total de pagos (features/payment/totals.ts, §43), que suma
// en centavos por el mismo motivo.
export function centsToCanonical(cents: number): string {
  const abs = Math.abs(cents);
  const integer = Math.floor(abs / 100);
  const decimals = String(abs % 100).padStart(2, "0");
  return `${cents < 0 ? "-" : ""}${integer}.${decimals}`;
}

// Precio del vehículo + accesorios − descuentos, como string canónico con
// dos decimales ("24150.00").
export function quoteTotal(quote: Pick<Quote, "amount" | "lines">): string {
  const cents = quote.lines.reduce(
    (sum, line) => sum + toCents(line.amount),
    toCents(quote.amount),
  );
  return centsToCanonical(cents);
}

// "24.150,00 USD" / "−500,00 USD". formatAmount (el formato uruguayo de
// CurrencyInput) descarta el signo, así que se agrega acá con el signo menos
// tipográfico, que no se confunde con un guión.
export function formatMoney(amount: string, currency: string): string {
  const cents = toCents(amount);
  const sign = cents < 0 ? "−" : "";
  return `${sign}${formatAmount(centsToCanonical(Math.abs(cents)))} ${currency}`;
}

// La unidad cotizada en una línea: "Toyota Corolla XEI 2022 · STK-000123".
export function vehicleLabel(vehicle: NonNullable<Quote["vehicle"]>): string {
  const name = [vehicle.make, vehicle.model, vehicle.trim, String(vehicle.year)]
    .filter(Boolean)
    .join(" ");
  return `${name} · ${vehicle.internalCode}`;
}
