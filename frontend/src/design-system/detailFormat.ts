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

// Fecha con hora en su forma corta, para una columna de tabla que no puede
// pagar el ancho de formatDateTime ("29/9/2026, 14:05:33"): "hoy 14:05",
// "ayer 14:05", "29/9 14:05" en el año en curso y "29/9/2025 14:05" fuera de
// él. Hora local, sin segundos. La fecha completa va en el title de la celda
// (formatDateTime), así que acá se puede perder precisión. `now` es
// parámetro solo para que los tests no dependan del reloj.
export function formatShortDateTime(iso: string | null, now: Date = new Date()): string {
  if (!iso) return "";
  const date = new Date(iso);
  const hora = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  const mismoDia = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (mismoDia(date, now)) return `hoy ${hora}`;
  const ayer = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (mismoDia(date, ayer)) return `ayer ${hora}`;
  const diaMes = `${date.getDate()}/${date.getMonth() + 1}`;
  return date.getFullYear() === now.getFullYear()
    ? `${diaMes} ${hora}`
    : `${diaMes}/${date.getFullYear()} ${hora}`;
}
