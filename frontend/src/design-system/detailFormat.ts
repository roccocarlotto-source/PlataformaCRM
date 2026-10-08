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

// Fecha sola, sin hora, en el formato local del navegador: el mismo
// `toLocaleDateString()` que usaban Fuentes y Claves. Junto a formatDateTime
// para que las fechas de toda la app salgan de un solo lugar.
// null → "" para que DetailList lo muestre como dato vacío.
export function formatDateOnly(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString();
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

// "Hace cuánto" pasó algo, para una celda que mide el tiempo transcurrido y
// no el momento ("hace 5 min", "hace 3 h", "hace 2 días"): la columna
// "Escribió" de Consultas sin identificar (ítem 184). La fecha exacta va en el
// title de la celda (formatDateTime), como con formatShortDateTime. Redondea
// hacia abajo salvo en los minutos, y nunca dice "hace 0": lo de hace menos de
// un minuto es "recién". `now` es parámetro por lo mismo que arriba.
export function formatRelativeTime(iso: string | null, now: Date = new Date()): string {
  if (!iso) return "";
  const minutos = Math.round((now.getTime() - new Date(iso).getTime()) / 60_000);
  if (minutos < 1) return "recién";
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `hace ${horas} h`;
  const dias = Math.floor(horas / 24);
  if (dias < 30) return dias === 1 ? "hace 1 día" : `hace ${dias} días`;
  const meses = Math.floor(dias / 30);
  if (meses < 12) return meses === 1 ? "hace 1 mes" : `hace ${meses} meses`;
  const anios = Math.floor(dias / 365);
  return anios <= 1 ? "hace 1 año" : `hace ${anios} años`;
}
