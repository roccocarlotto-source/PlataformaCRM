// ---------------------------------------------------------------------------
// Ayudas de formato para DetailList.tsx (docs/frontend-cambios-pendientes.md
// §28). Funciones puras, sin React, en archivo aparte —mismo criterio que
// initials.ts junto a Avatar.tsx y currencyFormat.ts junto a CurrencyInput—
// para que DetailList.tsx exporte solo el componente (react-refresh) y estas
// se puedan importar desde los listados sin traer el componente.
// ---------------------------------------------------------------------------

// Lo que se muestra cuando un dato falta. Es el mismo guión que los listados
// ya usan en sus celdas ("—" para un asignado sin resolver, una sucursal
// que no se pudo resolver, un precio sin cargar), no uno nuevo.
export const EMPTY_VALUE = "—";

// Un booleano del registro (Default, Ganada, Acepta permuta…) en solo lectura.
// En el formulario es un checkbox; acá, un "Sí"/"No" explícito: una casilla
// deshabilitada se lee como "no se puede tocar", no como un dato.
export function yesNo(value: boolean): string {
  return value ? "Sí" : "No";
}

// Fecha con hora, en el formato local del navegador: el mismo
// `new Date(iso).toLocaleString()` que ActivityListPage ya usa para
// Vencimiento/Completada y VehicleFormPage para Alta/Última modificación.
// null → "" para que DetailList lo muestre como dato vacío.
export function formatDateTime(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString();
}
