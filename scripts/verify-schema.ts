import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

// Verifica que una base recién construida quedó COMPLETA: no solo que
// `prisma migrate deploy` no explotó, sino que los objetos que Prisma no
// puede expresar en su DSL (triggers, índices únicos parciales, CHECK
// constraints, políticas RLS, la función current_organization_id) están
// realmente ahí.
//
// Reusa docs/auditoria-2026-08-21-diagnostico.sql, que ya hace esos 14
// chequeos y se escribió para correrse a mano en el SQL Editor de Supabase.
// Acá se ejecuta igual —es una sola sentencia, de solo lectura— y además se
// afirma sobre el subconjunto que tiene una respuesta mecánica: si algo
// falta, este script dice QUÉ faltó y sale con código 1, en vez de dejar que
// el error aparezca tres pasos después como un fallo críptico de Prisma.
//
// Las filas que corresponden a hallazgos ABIERTOS de la auditoría (A-6, A-7)
// se imprimen pero no se afirman: hoy fallan a propósito y no son un defecto
// de la construcción de la base.

const DIAGNOSTICO = "docs/auditoria-2026-08-21-diagnostico.sql";

interface Fila {
  n: number;
  chequeo: string;
  resultado: string;
  esperado: string;
}

// Devuelve la posición del `;` que TERMINA la sentencia, ignorando los que
// están dentro de una cadena entre comillas simples.
//
// La distinción no es teórica: el diagnóstico es un documento escrito para
// humanos y sus textos de `esperado` son prosa entre comillas, donde un `;` es
// un signo de puntuación como cualquier otro. Cortar en el primero partía la
// consulta en medio de una cadena, y Postgres respondía "42601: unterminated
// quoted string" — un error que no menciona ni el archivo ni el literal
// culpable, así que el costo de encontrarlo es alto y no baja con la
// experiencia.
//
// Alcanza con seguir un solo bit de estado: en SQL una comilla simple abre y
// cierra la cadena, y `''` dentro de una cadena es una comilla literal que no
// la cierra. Este archivo no usa dollar quoting ($$…$$) ni cadenas E'' con
// backslash, las dos formas que este barrido no contempla.
function encontrarFinDeSentencia(sql: string): number {
  let enCadena = false;

  for (let i = 0; i < sql.length; i++) {
    const caracter = sql[i];

    if (caracter === "'") {
      if (enCadena && sql[i + 1] === "'") {
        i++; // comilla escapada: se consume el par y se sigue dentro
        continue;
      }
      enCadena = !enCadena;
      continue;
    }

    if (caracter === ";" && !enCadena) return i;
  }

  return -1;
}

// El .sql es un documento para humanos: una sentencia seguida de comentarios
// con instrucciones. Se sacan las líneas de comentario y se corta en el `;`
// que cierra la consulta.
function extraerConsulta(texto: string): string {
  const sinComentarios = texto
    .split("\n")
    .filter((linea) => !/^\s*--/.test(linea))
    .join("\n");

  const fin = encontrarFinDeSentencia(sinComentarios);
  if (fin === -1) {
    throw new Error(
      `${DIAGNOSTICO}: no se encontró el \`;\` que cierra la sentencia. Si el ` +
        `archivo sí tiene uno, probablemente haya una comilla simple sin cerrar ` +
        `antes: el barrido quedó "dentro de una cadena" hasta el final.`,
    );
  }
  return sinComentarios.slice(0, fin);
}

// Chequeos con respuesta mecánica: fila → valor exacto que debe devolver.
const ESPERADO_EXACTO = new Map<number, string>([
  [1, "ninguno"], // C-1: anon/authenticated sin escritura sobre public
  [2, "ninguno"], // C-1: anon/authenticated sin lectura sobre public
  [5, "12"], // 10 de rls_policies.sql + 2 de la capa de ingesta (api_keys
  //           es deny-all a propósito: RLS activa, sin políticas)
  [7, "ninguno"], // los 8 índices únicos parciales, faltantes: ninguno
  [8, "ninguno"], // CHECK constraints faltantes
  [9, "ninguno"], // triggers de email faltantes
  [10, "presente"], // función current_organization_id()
  // C-3: las FKs compuestas por organización son la garantía de aislamiento
  // central del proyecto, y hasta ahora nada en CI comprobaba que existieran
  // — la migración que las creó podía perderse en un rebase y los tests de
  // aislamiento por repositorio habrían seguido pasando igual, porque prueban
  // el WHERE de la escritura, no la constraint.
  [14, "18"], // 15 de 20260821140200 + 3 de la capa de ingesta
]);

async function main() {
  const consulta = extraerConsulta(readFileSync(DIAGNOSTICO, "utf8"));
  const prisma = new PrismaClient();

  let filas: Fila[];
  try {
    filas = await prisma.$queryRawUnsafe<Fila[]>(consulta);
  } finally {
    await prisma.$disconnect();
  }

  console.log(`\nDiagnóstico de esquema (${DIAGNOSTICO}) — ${filas.length} chequeos\n`);

  const fallidos: Fila[] = [];
  for (const fila of filas) {
    const esperado = ESPERADO_EXACTO.get(fila.n);
    const afirmado = esperado !== undefined;
    const ok = !afirmado || fila.resultado === esperado;
    if (!ok) fallidos.push(fila);

    const marca = !afirmado ? "·" : ok ? "✔" : "✖";
    console.log(`${marca} ${String(fila.n).padStart(2)}. ${fila.chequeo}`);
    console.log(`      resultado: ${fila.resultado}`);
    console.log(`      esperado:  ${fila.esperado}`);
  }

  console.log(
    `\n(· = informativo, no se afirma: corresponde a hallazgos abiertos de la auditoría)\n`,
  );

  if (fallidos.length > 0) {
    console.error(
      `La base NO quedó completa: fallaron ${fallidos.length} de los ${ESPERADO_EXACTO.size} chequeos afirmados.\n`,
    );
    for (const fila of fallidos) {
      console.error(
        `  ✖ ${fila.chequeo}\n      obtuvo:   ${fila.resultado}\n      requería: ${ESPERADO_EXACTO.get(fila.n)}`,
      );
    }
    console.error(
      "\nRevisar prisma/migrations, prisma/sql/manual_constraints.sql y " +
        "prisma/sql/rls_policies.sql: algún objeto no llegó a la base.",
    );
    process.exit(1);
  }

  console.log(
    `Esquema completo: los ${ESPERADO_EXACTO.size} chequeos afirmados pasaron.`,
  );
}

main().catch((err: unknown) => {
  console.error("verify-schema: falló la verificación.");
  console.error(err);
  process.exit(1);
});
