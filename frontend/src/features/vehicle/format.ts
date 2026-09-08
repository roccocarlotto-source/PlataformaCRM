import { formatAmount } from "../opportunity/format";
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
// marcada así; sin precio de lista y sin esa marca, "—". El formato es el
// mismo de Oportunidades (formatAmount), no uno propio.
export function priceCell(vehicle: Vehicle): string {
  if (vehicle.priceOnRequest) return "Consultar precio";
  if (vehicle.priceListUsd === null) return "—";
  return formatAmount(vehicle.priceListUsd, "USD");
}
