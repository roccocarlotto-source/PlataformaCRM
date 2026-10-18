import { formatAmount } from "../opportunity/format";
import type { OrganizationSettings } from "../organization/types";
import type { Vehicle } from "./types";

// Cómo se nombra y se cotiza una unidad en pantalla. Vivían como funciones
// privadas de VehicleListPage; se extraen acá (mismo criterio que
// features/opportunity/format.ts) porque VehicleSelect —el selector de unidad
// del formulario de Oportunidad— muestra exactamente lo mismo en cada
// resultado, y dos copias divergirían tarde o temprano. En un archivo aparte
// y no exportadas desde el componente: react-refresh solo funciona en
// archivos que exportan únicamente componentes.

// "Toyota Corolla 2020 XEi": marca, modelo, año y versión (si hay) en una
// línea.
export function unitTitle(vehicle: Vehicle): string {
  return [vehicle.make, vehicle.model, String(vehicle.year), vehicle.trim]
    .filter(Boolean)
    .join(" ");
}

// Precio: "Consultar precio" manda sobre cualquier número si la unidad está
// marcada así; si no, el de lista en USD; si no tiene, el de lista en moneda
// local (una unidad publicada solo en pesos: antes mostraba "—", ensayo de la
// demo del 2026-10-17); sin ninguno, "—". El formato es el mismo de
// Oportunidades (formatAmount), no uno propio. La moneda local la sabe la
// organización (monedaLocalDe); sin ella, la misma etiqueta del formulario.
export const ETIQUETA_DE_MONEDA_LOCAL = "(moneda local)";

export function priceCell(vehicle: Vehicle, monedaLocal?: string | null): string {
  if (vehicle.priceOnRequest) return "Consultar precio";
  if (vehicle.priceListUsd !== null) return formatAmount(vehicle.priceListUsd, "USD");
  if (vehicle.priceListLocal !== null) {
    return formatAmount(vehicle.priceListLocal, monedaLocal ?? ETIQUETA_DE_MONEDA_LOCAL);
  }
  return "—";
}

// La moneda del precio de lista "local": la del par con cotización (el mismo
// criterio que el formulario de la unidad, que convierte con
// exchangeRates[0]) o, sin cotización todavía, la moneda distinta de USD que
// tenga configurada la organización. null si no hay ninguna.
export function monedaLocalDe(
  organizacion:
    | Pick<OrganizationSettings, "preferredCurrency" | "alternateCurrency" | "exchangeRates">
    | undefined,
): string | null {
  if (!organizacion) return null;
  const cotizada = organizacion.exchangeRates[0]?.targetCurrency;
  if (cotizada) return cotizada;
  return (
    [organizacion.preferredCurrency, organizacion.alternateCurrency].find(
      (moneda) => moneda !== null && moneda !== "USD",
    ) ?? null
  );
}
