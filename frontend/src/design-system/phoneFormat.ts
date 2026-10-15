// ---------------------------------------------------------------------------
// Agrupado visual del teléfono de un Contact para PhoneNumber.tsx. Función
// pura, sin React, en archivo aparte (mismo criterio que currencyFormat.ts
// junto a CurrencyInput.tsx) para poder testearla sola.
//
// Desde F5 (docs-privados/prueba-en-vivo-2026-09-29.md (local, no está en GitHub)) el backend guarda todo
// Contact.phone nuevo como "+" y solo dígitos, pero quedan filas viejas en
// texto libre. Acá se reconoce UN solo patrón, el de los datos reales del
// negocio: "+598" seguido de solo dígitos, sin espacios ni guiones ya
// puestos. Con los 8 dígitos de un número uruguayo se agrupa como se dicta
// (2026-10-15): celular "+598 99 777 778" (empieza con 9) y fijo
// "+598 2400 1234" (empieza con 2 o 4). Cualquier otro largo después del
// +598 se parte en grupos de 3 desde la izquierda, como antes (el último
// puede quedar de 1 o 2). Cualquier otro valor — otro
// código de país, espacios, letras, vacío, null — devuelve null y el
// consumidor lo muestra tal cual está guardado: no se inventa formato para
// casos que no se conocen.
//
// Lo que se devuelve son los GRUPOS, no un string con espacios: el espacio
// entre grupos lo pone el CSS (.ds-phone, gap fijo), porque un espacio de
// texto varía con la tipografía y queda más ancho de lo que se quiere.
// ---------------------------------------------------------------------------

const URUGUAY_COUNTRY_CODE = "+598";
const URUGUAY_PATTERN = /^\+598\d+$/;
const GROUP_SIZE = 3;
// Largo del número uruguayo sin el código de país (ver lib/telefono.ts del
// backend, LARGO_NACIONAL).
const URUGUAY_NATIONAL_LENGTH = 8;

export function formatPhoneGroups(value: string | null | undefined): string[] | null {
  if (!value || !URUGUAY_PATTERN.test(value)) return null;
  const digits = value.slice(URUGUAY_COUNTRY_CODE.length);
  if (digits.length === URUGUAY_NATIONAL_LENGTH) {
    if (digits.startsWith("9")) {
      return [URUGUAY_COUNTRY_CODE, digits.slice(0, 2), digits.slice(2, 5), digits.slice(5)];
    }
    if (digits.startsWith("2") || digits.startsWith("4")) {
      return [URUGUAY_COUNTRY_CODE, digits.slice(0, 4), digits.slice(4)];
    }
  }
  const groups: string[] = [URUGUAY_COUNTRY_CODE];
  for (let index = 0; index < digits.length; index += GROUP_SIZE) {
    groups.push(digits.slice(index, index + GROUP_SIZE));
  }
  return groups;
}
