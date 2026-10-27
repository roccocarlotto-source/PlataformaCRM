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
//   - el teléfono, normalizado: se comparan los últimos 8 dígitos, con
//     cualquier separador entre ellos (" ", "-", ".", paréntesis). Así
//     "+598 99 000 111", "099000111" y "99-000-111" son el mismo número;
//   - la organización la pone siempre quien llama, en el mismo WHERE: nunca se
//     busca en otra.
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

export interface CriteriosDeMencion {
  // En minúsculas. null si falta el nombre o el apellido.
  nombreCompleto: string | null;
  email: string | null;
  // Expresión regular de Postgres (operador ~). null si el teléfono tiene
  // menos de 7 dígitos.
  telefono: string | null;
}

const DIGITOS_DEL_TELEFONO = 8;
const MINIMO_DE_DIGITOS = 7;

export function criteriosDeMencion(persona: PersonaABuscar): CriteriosDeMencion {
  const nombre = persona.firstName.trim();
  const apellido = persona.lastName.trim();
  const email = persona.email?.trim().toLowerCase() || null;
  return {
    nombreCompleto: nombre && apellido ? `${nombre} ${apellido}`.toLowerCase() : null,
    email,
    telefono: patronDeTelefono(persona.phone),
  };
}

// Los últimos 8 dígitos, con hasta dos separadores entre cada uno, y que no
// sigan más dígitos después (un número más largo que termina igual no es este).
export function patronDeTelefono(phone: string | null): string | null {
  const digitos = (phone ?? "").replace(/\D/g, "");
  if (digitos.length < MINIMO_DE_DIGITOS) return null;
  const clave = digitos.slice(-DIGITOS_DEL_TELEFONO);
  return `${clave.split("").join("[ ().-]{0,2}")}([^0-9]|$)`;
}

export function hayCriterios(c: CriteriosDeMencion): boolean {
  return c.nombreCompleto !== null || c.email !== null || c.telefono !== null;
}

// Para LIKE: el valor buscado no puede traer comodines propios.
function literalParaLike(valor: string): string {
  return `%${valor.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
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
    partes.push(Prisma.sql`lower(${col}) LIKE ${literalParaLike(c.nombreCompleto)}`);
  }
  if (c.email) {
    partes.push(Prisma.sql`lower(${col}) LIKE ${literalParaLike(c.email)}`);
  }
  if (c.telefono) {
    partes.push(Prisma.sql`${col} ~ ${c.telefono}`);
  }
  if (partes.length === 0) return Prisma.sql`FALSE`;
  return Prisma.sql`(${Prisma.join(partes, " OR ")})`;
}
