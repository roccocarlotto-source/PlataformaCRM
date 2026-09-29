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
//     es local (`099 123 456`, el 0 de larga distancia) o usa un prefijo de
//     salida (`00598…`) que cambia según el país desde el que se marca; en los
//     dos casos convertirlo exige suponer un país, así que NO se normaliza: se
//     rechaza. Ningún código de país E.164 empieza con 0, así que un número
//     internacional válido nunca cae acá.
//   - Entre 7 y 15 dígitos: 15 es el máximo de E.164 y 7 el número
//     internacional más corto que existe (código de país + abonado).
//
// Lo que NO se puede detectar: un número local sin el 0 (`94000111`) tiene la
// misma forma que uno internacional, y se guarda como `+94000111`. Distinguirlo
// exigiría conocer el país del contacto, que el CRM no tiene.
// ---------------------------------------------------------------------------

const MIN_DIGITOS = 7;
const MAX_DIGITOS = 15;

// Dígitos y separadores comunes, con un "+" opcional solo al principio.
const FORMA_ACEPTADA = /^\+?[\d\s\-.()]+$/;

// El mensaje de error de los tres caminos que pueden recibir un teléfono no
// normalizable (HTTP, webhook, importación). No ecoa el valor: en la ingesta
// termina en IngestionEvent.errorMessage (ver D2-7 en ingestContact.schema.ts).
export const TELEFONO_NO_NORMALIZABLE =
  "phone tiene que estar en formato internacional, con el código de país y sin el 0 inicial (por ejemplo +59899123456)";

// Solo dígitos. Es el criterio con el que se COMPARAN dos teléfonos (y el que
// espera Meta en el `to` de un envío): `+598 99-123.456` y `59899123456` son
// el mismo número.
export function soloDigitos(valor: string): string {
  return valor.replace(/\D/g, "");
}

// `+<dígitos>`, o null si el valor no se puede normalizar sin adivinar (ver la
// regla arriba). Nunca lanza: cada caller decide qué hace con el null (400 en
// HTTP, fila FAILED en la ingesta).
export function normalizarTelefono(valor: string): string | null {
  const recortado = valor.trim();
  if (!FORMA_ACEPTADA.test(recortado)) {
    return null;
  }
  const digitos = soloDigitos(recortado);
  if (digitos.length < MIN_DIGITOS || digitos.length > MAX_DIGITOS || digitos.startsWith("0")) {
    return null;
  }
  return `+${digitos}`;
}
