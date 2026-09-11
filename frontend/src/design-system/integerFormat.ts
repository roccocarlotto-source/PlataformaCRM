// ---------------------------------------------------------------------------
// Parseo y formato de cantidades enteras para IntegerInput.tsx (ítem 23 de
// docs/frontend-cambios-pendientes.md): punto cada 3 dígitos y nada más —
// ni coma ni decimales, nunca. Hermano de currencyFormat.ts, con la misma
// división (funciones puras acá, componente aparte) y la misma noción de
// "valor canónico": el string que el formulario ya guardaba en su estado,
// "150000" o "", que Number() convierte tal cual.
//
// A diferencia de un monto, acá no hay separador decimal que reconocer, así
// que el formato "en vivo" y el "en reposo" son el mismo: no hay decimales
// que completar ni separador colgado que preservar.
// ---------------------------------------------------------------------------

const integerFormatter = new Intl.NumberFormat("es-UY", { maximumFractionDigits: 0 });

// Texto libre (tipeado o formateado) → canónico. Todo lo que no sea dígito
// se descarta (puntos de miles, una coma tipeada por costumbre, letras); los
// ceros a la izquierda se van.
export function parseInteger(text: string): string {
  const digits = text.replace(/\D/g, "");
  return digits === "" ? "" : String(Number(digits));
}

// Canónico (o texto libre: parsea primero) → con puntos de miles. "" queda "".
export function formatInteger(text: string): string {
  const canonical = parseInteger(text);
  return canonical === "" ? "" : integerFormatter.format(Number(canonical));
}

// Para el cursor de IntegerInput: solo los dígitos cuentan.
export function isDigit(char: string): boolean {
  return /\d/.test(char);
}
