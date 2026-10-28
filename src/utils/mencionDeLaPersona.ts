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
//     un dígito pegado a la derecha. A la izquierda puede ir el código de país
//     del contacto (+598, 00598) y/o el 0 de larga distancia, y nada más: un
//     número con OTRO código de país y los mismos últimos dígitos ("+54 99 000
//     111") no es este. Si el texto no trae código de país, no hay forma de
//     distinguirlo, y se toma como este.
//
// Las clases de caracteres son explícitas (y no [[:alnum:]]) para no depender
// del locale de la base, y la sintaxis es la común a las expresiones de
// Postgres y de JavaScript: los unitarios prueban el mismo patrón que corre en
// la base.
//
// Es imperfecto a propósito y está documentado (data-classification.md §5.2):
// un apodo o un nombre mal escrito no se encuentran.
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
  // si está en formato internacional (+59899000111 → 598).
  const prefijo = digitos.slice(0, -DIGITOS_DEL_TELEFONO).replace(/^0+/, "");
  const conPais = prefijo ? `(?:(?:\\+|00)?${SEPARADOR}${prefijo}${SEPARADOR})?` : "";
  return `(?<![0-9]${SEPARADOR})${conPais}(?:0${SEPARADOR})?${clave}(?![0-9])`;
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
