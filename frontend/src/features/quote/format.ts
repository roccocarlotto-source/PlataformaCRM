import { centsToCanonical, toCents } from "../../design-system/currencyFormat";
import type { Quote } from "./types";

// ---------------------------------------------------------------------------
// Importes de la cotización. Funciones puras, sin React (format.test.ts).
//
// El total es el precio más la suma de las líneas, en centavos enteros. El
// formato de un importe (formatMoney) y los centavos viven en
// design-system/currencyFormat.ts: son los de todo el sistema.
// ---------------------------------------------------------------------------

// Precio del vehículo + accesorios − descuentos, como string canónico con
// dos decimales ("24150.00").
export function quoteTotal(quote: Pick<Quote, "amount" | "lines">): string {
  const cents = quote.lines.reduce(
    (sum, line) => sum + toCents(line.amount),
    toCents(quote.amount),
  );
  return centsToCanonical(cents);
}

// La unidad cotizada en una línea: "Toyota Corolla XEI 2022 · STK-000123".
export function vehicleLabel(vehicle: NonNullable<Quote["vehicle"]>): string {
  const name = [vehicle.make, vehicle.model, vehicle.trim, String(vehicle.year)]
    .filter(Boolean)
    .join(" ");
  return `${name} · ${vehicle.internalCode}`;
}
