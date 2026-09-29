// ---------------------------------------------------------------------------
// LA FORMA ÚNICA DE Contact.phone — F5 de docs/prueba-en-vivo-2026-09-29.md.
//
// La prueba en vivo encontró dos contactos para el mismo número: uno con "+"
// (lo creó el WhatsApp entrante) y otro con los mismos dígitos sin "+"
// (cargado por POST /api/contacts, que guardaba lo que viniera). El entrante
// matchea por dígitos y agarraba cualquiera de los dos. Desde F5 todo teléfono
// de contacto se guarda como "+" seguido SOLO de dígitos —la forma que el alta
// por WhatsApp ya usaba— y TODA escritura pasa por normalizarTelefono: el POST
// y el PATCH de /api/contacts, la promoción de la ingesta (webhook e
// importación) y el alta por WhatsApp.
//
// LA REGLA, igual en todos lados:
//   - Se aceptan dígitos con los separadores que escribe una persona (espacios,
//     guiones, puntos, paréntesis) y un "+" opcional adelante. Cualquier otra
//     cosa —letras, "int. 3", dos "+"— no es un teléfono que se pueda
//     normalizar sin adivinar qué parte es el número.
//   - Con o sin "+" es el mismo número: `59894000111` y `+59894000111` quedan
//     los dos `+59894000111`. Un número sin "+" se toma como internacional
//     (ya trae el código de país), que es lo que manda Meta en el wa_id.
//   - NO SE INVENTA UN CÓDIGO DE PAÍS. Un número cuyos dígitos empiezan con 0
//     es local (`099 123 456`, el 0 de larga distancia): convertirlo exige
//     saber el país. Si la organización declaró uno (F5-b, abajo) se completa
//     con ése; si no, NO se normaliza: se rechaza. Ningún código de país E.164
//     empieza con 0, así que un número internacional válido nunca cae acá.
//   - `00` adelante (sin "+") es el prefijo de salida internacional que se
//     marca en casi todo el mundo: `00598 99 123 456` es `+59899123456`,
//     tenga o no país la organización (F5-b).
//   - Entre 7 y 15 dígitos: 15 es el máximo de E.164 y 7 el número
//     internacional más corto que existe (código de país + abonado).
//
// Lo que NO se puede detectar: un número local sin el 0 (`94000111`) tiene la
// misma forma que uno internacional, y se guarda como `+94000111`. Distinguirlo
// exigiría conocer el país del contacto, que el CRM no tiene.
//
// PAÍS POR DEFECTO — F5-b (pendientes post F1–F5). Organization.
// defaultPhoneCountryCode ("598") completa los números locales: si los
// dígitos (sin "+") empiezan con UN 0, se saca ese 0 y se antepone el código.
// `099 123 456` en una organización con 598 queda `+59899123456`, y choca
// (409) con un `+59899123456` que ya exista. Todo lo demás, igual que antes.
//
// LO QUE ESTE CRITERIO NO CUBRE, y no intenta resolver:
//   - Móviles argentinos: el formato local `011 15 4444-5555` pasa a
//     `+5411154444555`, pero el número internacional de un móvil es
//     `+54 9 11 4444-5555` (se saca el 15 y se agrega un 9). No se reescribe
//     el 15: queda un número que no coincide con el wa_id del mismo cliente.
//   - Países que CONSERVAN el 0 en el formato internacional (Italia:
//     `06 1234 5678` es `+39 06 1234 5678`): sacar el 0 da un número
//     equivocado. Con país por defecto 39 no hay que confiar en este helper.
//   - Un local escrito SIN el 0 (`99 123 456`) sigue pareciendo
//     internacional y se guarda como `+99123456` (ver arriba).
//   - Prefijos de salida que no son 00 (el `011` que se marca desde EE.UU.):
//     se leen como un local con 0.
//   - El país del CONTACTO: se usa el de la organización para todos. Un
//     cliente extranjero cargado en formato local de su país queda mal.
// ---------------------------------------------------------------------------

const MIN_DIGITOS = 7;
const MAX_DIGITOS = 15;

// Dígitos y separadores comunes, con un "+" opcional solo al principio.
const FORMA_ACEPTADA = /^\+?[\d\s\-.()]+$/;

// El 400 de POST/PATCH /api/contacts ante un teléfono no normalizable: ahí
// hay una persona que puede corregirlo. No ecoa el valor. La ingesta ya no lo
// usa: desde F5-a guarda el contacto sin teléfono en vez de fallar la fila
// (ver ingestContact.schema.ts).
export const TELEFONO_NO_NORMALIZABLE =
  "phone tiene que estar en formato internacional, con el código de país y sin el 0 inicial (por ejemplo +59899123456)";

// Solo dígitos. Es el criterio con el que se COMPARAN dos teléfonos (y el que
// espera Meta en el `to` de un envío): `+598 99-123.456` y `59899123456` son
// el mismo número.
export function soloDigitos(valor: string): string {
  return valor.replace(/\D/g, "");
}

// Lo que acepta Organization.defaultPhoneCountryCode: de 1 a 3 dígitos, sin
// "+" y sin 0 inicial (ningún código E.164 empieza con 0). El PATCH de
// /api/organization valida con esto; el helper lo vuelve a chequear para que
// un valor escrito por otra vía no produzca un número inventado.
export const CODIGO_DE_PAIS = /^[1-9]\d{0,2}$/;

// `+<dígitos>`, o null si el valor no se puede normalizar sin adivinar (ver la
// regla arriba). Nunca lanza: cada caller decide qué hace con el null (400 en
// HTTP; en la ingesta, contacto sin teléfono y nota de revisión — F5-a).
//
// `codigoDePais` es el país por defecto de la organización (F5-b); null o
// undefined = sin país, el comportamiento de F5.
export function normalizarTelefono(valor: string, codigoDePais?: string | null): string | null {
  const recortado = valor.trim();
  if (!FORMA_ACEPTADA.test(recortado)) {
    return null;
  }
  const digitos = completarPais(recortado, soloDigitos(recortado), codigoDePais);
  if (digitos.length < MIN_DIGITOS || digitos.length > MAX_DIGITOS || digitos.startsWith("0")) {
    return null;
  }
  return `+${digitos}`;
}

// F5-b: los dos prefijos que se reescriben. Solo sin "+": con "+" el número ya
// se declaró internacional y un 0 detrás es un error, no un prefijo.
function completarPais(
  recortado: string,
  digitos: string,
  codigoDePais: string | null | undefined,
): string {
  if (recortado.startsWith("+")) {
    return digitos;
  }
  if (digitos.startsWith("00")) {
    return digitos.slice(2);
  }
  if (digitos.startsWith("0") && codigoDePais && CODIGO_DE_PAIS.test(codigoDePais)) {
    return codigoDePais + digitos.slice(1);
  }
  return digitos;
}
