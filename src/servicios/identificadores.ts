// ---------------------------------------------------------------------------
// Matrícula y chasis de un vehículo del cliente (docs/servicios.md §2.2).
//
// Se guardan normalizados: mayúsculas, solo letras y dígitos. Es la misma regla
// que el CHECK customer_vehicles_plate_check de la base (S1), y lo que hace
// confiable la unicidad entre vehículos vigentes: "abc 1234", "ABC-1234" y
// "abc1234" son la misma matrícula.
//
// La matrícula además se guarda como la escribió el usuario (license_plate),
// para mostrarla; el chasis solo normalizado (no tiene una forma "linda").
// ---------------------------------------------------------------------------

/** Mayúsculas, sin nada que no sea letra o dígito. "" si no queda nada. */
export function normalizarIdentificador(texto: string): string {
  return texto.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Número de orden para mostrar (D18): consecutivo por organización, "OS-0042". */
export function formatearNumeroDeOrden(numero: number): string {
  return `OS-${String(numero).padStart(4, "0")}`;
}
