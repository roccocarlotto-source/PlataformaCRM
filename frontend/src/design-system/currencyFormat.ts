// ---------------------------------------------------------------------------
// Parseo y formato de montos estilo Uruguay para CurrencyInput.tsx (ítem 18.A
// de docs/frontend-cambios-pendientes.md): punto cada 3 dígitos de la parte
// entera y coma para los decimales. Funciones puras, sin React, en archivo
// aparte (mismo criterio que initials.ts junto a Avatar.tsx) para que
// CurrencyInput.tsx exporte solo el componente y se puedan testear solas.
//
// "Valor canónico" en todo este archivo es el string que los formularios ya
// guardaban en su estado: "20000.5", "20000" o "" — punto decimal, sin
// separador de miles, que Number() convierte tal cual.
// ---------------------------------------------------------------------------

export const DECIMAL_SEPARATOR = ",";
const MAX_DECIMALS = 2;

const integerFormatter = new Intl.NumberFormat("es-UY", { maximumFractionDigits: 0 });

interface SplitAmount {
  integer: string;
  decimals: string;
  hasSeparator: boolean;
}

// Descompone un texto en parte entera y decimales según el separador
// decimal indicado. Dos gramáticas distintas, y NO se mezclan:
//
// - Lo que se ve/tipea (splitDisplay): la coma es el decimal y el punto es
//   SIEMPRE de miles. "20.000" es veinte mil, nunca "20,00" — un punto solo
//   es exactamente lo que el propio formato deja al borrar los decimales.
//   Un punto tipeado a mano lo convierte CurrencyInput en coma antes de
//   llegar acá.
// - El canónico del formulario (splitCanonical): "20000.5", con punto
//   decimal y sin miles. Solo entra por formatAmount.
//
// Todo lo que no sea dígito se descarta; los decimales se truncan a 2.
function split(text: string, separator: string): SplitAmount {
  const separatorIndex = text.indexOf(separator);
  const rawInteger = separatorIndex === -1 ? text : text.slice(0, separatorIndex);
  const rawDecimals = separatorIndex === -1 ? "" : text.slice(separatorIndex + 1);
  return {
    integer: rawInteger.replace(/\D/g, ""),
    decimals: rawDecimals.replace(/\D/g, "").slice(0, MAX_DECIMALS),
    hasSeparator: separatorIndex !== -1,
  };
}

function splitDisplay(text: string): SplitAmount {
  return split(text, DECIMAL_SEPARATOR);
}

function splitCanonical(canonical: string): SplitAmount {
  return split(canonical, ".");
}

function formatInteger(integer: string): string {
  return integer === "" ? "0" : integerFormatter.format(Number(integer));
}

// Texto libre (tipeado o formateado) → valor canónico. Un separador sin
// decimales ("20.000,") es el número entero: el separador colgado vive solo
// en el texto que se ve, no en el valor. Los ceros a la izquierda se van.
export function parseAmount(text: string): string {
  const { integer, decimals } = splitDisplay(text);
  if (integer === "" && decimals === "") return "";
  const normalizedInteger = integer === "" ? "0" : String(Number(integer));
  return decimals ? `${normalizedInteger}.${decimals}` : normalizedInteger;
}

// Formato "en vivo", mientras se tipea: miles con punto, decimales tal cual
// se escribieron (sin completar a 2) y el separador colgado preservado, para
// que borrar hacia atrás no pelee con el relleno.
export function formatAmountWhileTyping(text: string): string {
  const { integer, decimals, hasSeparator } = splitDisplay(text);
  if (integer === "" && decimals === "" && !hasSeparator) return "";
  const formattedInteger = formatInteger(integer);
  return hasSeparator ? `${formattedInteger}${DECIMAL_SEPARATOR}${decimals}` : formattedInteger;
}

// Formato "en reposo" (valor cargado, o al salir del campo): siempre con 2
// decimales, como se muestra un importe. "" queda "".
export function formatAmount(canonical: string): string {
  if (canonical === "") return "";
  const { integer, decimals } = splitCanonical(canonical);
  return `${formatInteger(integer)}${DECIMAL_SEPARATOR}${decimals.padEnd(MAX_DECIMALS, "0")}`;
}

// Cursor. Los puntos de miles van y vienen con el formato, así que la
// posición del cursor se conserva contando solo los caracteres
// "significativos" que quedan a su izquierda. Cuáles son significativos lo
// decide el predicado: para un monto, dígitos y la coma (el default); para
// un entero (IntegerInput.tsx, ítem 23) solo dígitos, así una coma tipeada
// por costumbre se descarta sin correr el cursor.
export type SignificantChar = (char: string) => boolean;

function isAmountChar(char: string): boolean {
  return /\d/.test(char) || char === DECIMAL_SEPARATOR;
}

export function countSignificantBefore(
  text: string,
  position: number,
  isSignificant: SignificantChar = isAmountChar,
): number {
  let count = 0;
  for (const char of text.slice(0, position)) {
    if (isSignificant(char)) count += 1;
  }
  return count;
}

// Posición en `text` justo después del n-ésimo carácter significativo (0 →
// el principio; más de los que hay → el final).
export function positionAfterSignificant(
  text: string,
  count: number,
  isSignificant: SignificantChar = isAmountChar,
): number {
  if (count === 0) return 0;
  let seen = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (isSignificant(text[index])) {
      seen += 1;
      if (seen === count) return index + 1;
    }
  }
  return text.length;
}
