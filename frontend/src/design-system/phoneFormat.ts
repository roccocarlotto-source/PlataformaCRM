// ---------------------------------------------------------------------------
// Agrupado visual del teléfono de un Contact para PhoneNumber.tsx. Función
// pura, sin React, en archivo aparte (mismo criterio que currencyFormat.ts
// junto a CurrencyInput.tsx) para poder testearla sola.
//
// Contact.phone es texto libre (VarChar(30), sin validación de formato en el
// backend). Acá se reconoce UN solo patrón, el de los datos reales del
// negocio: "+598" seguido de solo dígitos, sin espacios ni guiones ya
// puestos. Ese se parte en el código de país y grupos de 3 dígitos desde la
// izquierda (el último puede quedar de 1 o 2). Cualquier otro valor — otro
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

export function formatPhoneGroups(value: string | null | undefined): string[] | null {
  if (!value || !URUGUAY_PATTERN.test(value)) return null;
  const digits = value.slice(URUGUAY_COUNTRY_CODE.length);
  const groups: string[] = [URUGUAY_COUNTRY_CODE];
  for (let index = 0; index < digits.length; index += GROUP_SIZE) {
    groups.push(digits.slice(index, index + GROUP_SIZE));
  }
  return groups;
}
