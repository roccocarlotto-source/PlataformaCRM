// Formatos de la vista "Uso de IA" (B4). Fuera del componente para que el
// archivo de la página exporte solo el componente (react-refresh).

export const ENTEROS = new Intl.NumberFormat("es-AR");

const DOLARES = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

// null = ningún turno de la ventana trajo costo (el proveedor no lo informó).
export function formatoDeCosto(costUsd: number | null): string {
  return costUsd === null ? "—" : DOLARES.format(costUsd);
}
