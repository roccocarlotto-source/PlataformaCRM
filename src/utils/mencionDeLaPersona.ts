import { Prisma } from "@prisma/client";

// ---------------------------------------------------------------------------
// ¿Este texto menciona a la persona? Para el borrado a pedido (DAT-03 y DAT-04
// de docs-privados/auditoria-2026-10-21/informe.md, local): lo que un usuario
// escribió sobre ella en el asistente de ayuda o en el agente interno, y los
// eventos de ingesta que nunca llegaron a ser su contacto.
//
// Reglas de Rocco (26/10), y por qué:
//   - nombre COMPLETO (nombre + apellido), email o teléfono. Nunca el nombre de
//     pila solo: "Juan" borraría filas de todos los Juanes;
//   - la organización la pone siempre quien llama, en el mismo WHERE: nunca se
//     busca en otra.
//
// CON LÍMITES DE PALABRA (revisión de #585, 28/10). Un LIKE '%ana lópez%'
// tocaba también lo de "Mariana López", y '%ana@x.com%' lo de
// "juliana@x.com". Por eso cada criterio es una expresión regular:
//   - nombre completo: como palabra entera (ni letra ni número pegados a los
//     costados); entre nombre y apellido, cualquier espacio. Sin distinguir
//     mayúsculas (operador ~*);
//   - email: sin letra, número ni . _ % + - pegados a la izquierda (sería otro
//     email que termina igual), ni un dominio que sigue a la derecha
//     ("ana@x.com.uy" es otro);
//   - teléfono: solo si tiene 8 dígitos o más. Se comparan los últimos 8, con
//     hasta dos separadores entre cada dígito (" ", "-", ".", paréntesis), sin
//     un dígito pegado a la derecha. A la izquierda solo pueden ir dígitos
//     que el número guardado del contacto tiene antes de esos 8, agrupados
//     como sea, y el 0 de larga distancia: para +5491123456789 valen
//     "+54 9 11 2345-6789", "+54 11 2345-6789", "11 2345-6789" y
//     "011 2345-6789" (las reglas exactas, en patronDeTelefono). Un número
//     con OTROS dígitos delante ("+54 99 000 111" para un contacto
//     +59899000111) no es este. Si el texto no trae nada delante, no hay forma
//     de distinguirlo, y se toma como este.
//
// ARGENTINA Y MÉXICO (tanda 2, 2026-10-31): el 9 y el 1 de celular se
// encuentran estén o no en el número guardado y en el texto; el 15 del celular
// argentino escrito en local ("15 2345-6789", "011 15 2345-6789") y el 044/045
// de México también (ver patronDeTelefono).
//
// LÍMITES CONOCIDOS (revisión de #585, 28/10; data-classification.md §5.2):
//   - un nombre completo que sigue o precede a otras palabras sí coincide:
//     borrar a "Ana López" toca lo que dice "Ana López Fernández", "Ana
//     López-García" o "María Ana López" (otra persona, o la misma: el texto no
//     lo distingue);
//   - con un separador que no es de la lista (una barra, un salto de línea) o
//     con más de dos seguidos, los dígitos de delante dejan de verse: "+54 11 /
//     99000111" se toma como el +59899000111.
//
// Las clases de caracteres son explícitas (y no [[:alnum:]]) para no depender
// del locale de la base, y la sintaxis es la común a las expresiones de
// Postgres y de JavaScript: los unitarios prueban el mismo patrón que corre en
// la base.
//
// Es imperfecto a propósito y está documentado (data-classification.md §5.2):
// un apodo o un nombre mal escrito no se encuentran, más los límites de
// arriba.
// ---------------------------------------------------------------------------

export interface PersonaABuscar {
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
}

// Las tres son expresiones regulares (en Postgres, ~* las dos primeras y ~ la
// del teléfono). null si falta el dato: sin nombre o sin apellido no se busca
// por nombre; con menos de 8 dígitos, no se busca por teléfono.
export interface CriteriosDeMencion {
  nombreCompleto: string | null;
  email: string | null;
  telefono: string | null;
}

const DIGITOS_DEL_TELEFONO = 8;
// Letra (también con tilde), número o guion bajo.
const LETRA_O_NUMERO = "0-9A-Za-z_À-ɏ";
const SEPARADOR = "[ ().-]{0,2}";

function literal(valor: string): string {
  return valor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function criteriosDeMencion(persona: PersonaABuscar): CriteriosDeMencion {
  const nombre = persona.firstName.trim();
  const apellido = persona.lastName.trim();
  return {
    nombreCompleto: nombre && apellido ? patronDeNombre(`${nombre} ${apellido}`) : null,
    email: patronDeEmail(persona.email),
    telefono: patronDeTelefono(persona.phone),
  };
}

export function patronDeNombre(nombreCompleto: string): string {
  const palabras = nombreCompleto.trim().split(/\s+/).map(literal);
  return `(?<![${LETRA_O_NUMERO}])${palabras.join("\\s+")}(?![${LETRA_O_NUMERO}])`;
}

export function patronDeEmail(email: string | null): string | null {
  const limpio = email?.trim();
  if (!limpio) return null;
  return `(?<![${LETRA_O_NUMERO}.%+-])${literal(limpio)}(?![${LETRA_O_NUMERO}-])(?!\\.[${LETRA_O_NUMERO}])`;
}

export function patronDeTelefono(phone: string | null): string | null {
  const digitos = (phone ?? "").replace(/\D/g, "");
  if (digitos.length < DIGITOS_DEL_TELEFONO) return null;
  const clave = digitos.slice(-DIGITOS_DEL_TELEFONO).split("").join(SEPARADOR);
  // Lo que va antes de los últimos 8 en el número guardado: el código de país
  // y, según el país, el 9 o el 1 de celular y el código de área
  // (+5491123456789 → 54911). Revisión de #585: escrito agrupado ("+54 9 11")
  // no se encontraba. Ahora, con separadores entre cada dígito:
  //   - con "+" o "00": los dos primeros dígitos del prefijo son obligatorios
  //     (el código de país: +598 no es +58) y los demás pueden faltar, uno por
  //     uno ("+54 11 …" sin el 9, "+52 55 …" sin el 1);
  //   - sin "+": un final del prefijo, entero ("11 2345-6789", el área), con
  //     el 0 de larga distancia opcional ("011 2345-6789"). Sin un "+" justo
  //     antes: "+1 55 …" es otro país aunque "1 55" sea un final de 52155.
  // Los lookbehind impiden que haya otros dígitos antes.
  //
  // Argentina y México (tanda 2): el prefijo se completa con el 9 (AR) o el 1
  // (MX) de celular si el número guardado no lo tiene (un alta por formulario
  // queda +5411…), y como ese dígito es opcional, se encuentra con y sin él.
  // Además, en AR el 15 del celular escrito en local va entre el área y el
  // número local, que tiene 8, 7 o 6 dígitos según el área (2, 3 o 4): puede
  // caer en las tres primeras posiciones de los últimos 8. En MX, el 044 o
  // 045 de celular va donde el 0 de larga distancia.
  const crudo = digitos.slice(0, -DIGITOS_DEL_TELEFONO).replace(/^0+/, "");
  const prefijo =
    crudo.startsWith("54") && crudo.length > 2 && crudo[2] !== "9"
      ? `549${crudo.slice(2)}`
      : crudo.startsWith("52") && crudo.length > 2 && crudo[2] !== "1"
        ? `521${crudo.slice(2)}`
        : crudo;
  const d = (digito: string) => `${digito}${SEPARADOR}`;
  const esMexico = prefijo.startsWith("52");
  const cero = esMexico ? `(?:${d("0")}(?:${d("4")}(?:${d("4")}|${d("5")}))?)?` : `(?:${d("0")})?`;
  const ultimos = digitos.slice(-DIGITOS_DEL_TELEFONO);
  const claveCon15 = prefijo.startsWith("54")
    ? `(?:${[0, 1, 2]
        .map((i) => [...ultimos.slice(0, i), "1", "5", ...ultimos.slice(i)].join(SEPARADOR))
        .join("|")}|${clave})`
    : clave;
  const sinNadaAntes = (antes: string) => `(?<![0-9${antes}]${SEPARADOR})`;
  const sinPais = prefijo
    ? `${cero}(?:(?:${[...prefijo].map((_, i) => prefijo.slice(i).split("").join(SEPARADOR)).join("|")})${SEPARADOR})?`
    : "";
  const formas = [`${sinNadaAntes("+")}${sinPais}${cero}${claveCon15}`];
  if (prefijo) {
    const obligatorios = prefijo.slice(0, 2).split("").map(d).join("");
    const opcionales = [...prefijo.slice(2)].map((digito) => `(?:${d(digito)})?`).join("");
    formas.push(
      `${sinNadaAntes("")}(?:\\+|00)${SEPARADOR}${obligatorios}${cero}${opcionales}${cero}${claveCon15}`,
    );
  }
  return `(?:${formas.join("|")})(?![0-9])`;
}

export function hayCriterios(c: CriteriosDeMencion): boolean {
  return c.nombreCompleto !== null || c.email !== null || c.telefono !== null;
}

// El fragmento SQL "esta columna menciona a la persona". `columna` es SIEMPRE
// un nombre fijo escrito en el código (nunca un dato), por eso va como raw.
// Sin criterios devuelve FALSE: no se toca nada.
export function sqlMenciona(
  columna: string,
  c: CriteriosDeMencion,
  opciones: { porNombre?: boolean } = {},
): Prisma.Sql {
  const col = Prisma.raw(columna);
  const partes: Prisma.Sql[] = [];
  if (opciones.porNombre !== false && c.nombreCompleto) {
    partes.push(Prisma.sql`${col} ~* ${c.nombreCompleto}`);
  }
  if (c.email) {
    partes.push(Prisma.sql`${col} ~* ${c.email}`);
  }
  if (c.telefono) {
    partes.push(Prisma.sql`${col} ~ ${c.telefono}`);
  }
  if (partes.length === 0) return Prisma.sql`FALSE`;
  return Prisma.sql`(${Prisma.join(partes, " OR ")})`;
}
