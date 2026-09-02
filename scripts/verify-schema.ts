import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

// Verifica que una base recién construida quedó COMPLETA: no solo que
// `prisma migrate deploy` no explotó, sino que los objetos que Prisma no
// puede expresar en su DSL (triggers, índices únicos parciales, CHECK
// constraints, políticas RLS, la función current_organization_id) están
// realmente ahí.
//
// Reusa docs/auditoria-2026-08-21-diagnostico.sql, que ya hace esos 18
// chequeos y se escribió para correrse a mano en el SQL Editor de Supabase.
// Acá se ejecuta igual —es una sola sentencia, de solo lectura— y además se
// afirma sobre el subconjunto que tiene una respuesta mecánica: si algo
// falta, este script dice QUÉ faltó y sale con código 1, en vez de dejar que
// el error aparezca tres pasos después como un fallo críptico de Prisma.
//
// Las filas informativas se imprimen pero no se afirman. Desde el 2026-08-28
// ninguna de ellas corresponde ya a un hallazgo abierto: A-6 y A-7 (filas 11 y
// 12) se cerraron con el P0 del roadmap y pasaron a afirmarse. Las que quedan
// sin afirmar describen el ENTORNO, no la construcción de la base — qué roles
// tienen BYPASSRLS, qué tablas no tienen RLS habilitada, si hay filas de
// public.users huérfanas de auth.users— y su valor correcto depende del
// proyecto contra el que se corran.
//
// Sobre qué hace útil a este script: afirmar que un objeto EXISTE es barato y
// pasa casi siempre. Afirmar que hace lo que dice es lo que lo convierte en una
// defensa. Ver el encabezado del .sql para el método y para el límite conocido
// del normalizador de expresiones.

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
//
// Revisión del 2026-08-25: las afirmaciones comparan la DEFINICIÓN de
// cada objeto, no su existencia. Antes casi todas preguntaban "¿hay algo que se
// llame así?", y esa pregunta la contesta que sí un índice recreado sin su
// predicado parcial, un CHECK reescrito para no restringir nada, una política
// de RLS con USING (true) o una FK apuntando al padre equivocado. El detalle de
// qué compara cada fila, y contra qué, está en el encabezado del .sql.
//
// Un efecto buscado del cambio: varias filas pasaron de devolver un CONTEO a
// devolver la LISTA DE DISCREPANCIAS. Un conteo correcto no implica un esquema
// correcto —12 políticas pueden ser 11 buenas y una que abre la base— y cuando
// falla no dice qué falló. Ahora el valor esperado es "ninguna"/"ninguno" y el
// resultado, cuando no lo es, trae el objeto y su definición real.
//
// Cada entrada lleva su descripción además del valor esperado. No es
// decoración: si una fila deja de volver del .sql, su `chequeo` tampoco vuelve,
// y el único lugar de donde se puede sacar el nombre para reportarla como
// ausente es este Map.
interface ChequeoAfirmado {
  descripcion: string;
  esperado: string;
}

const ESPERADO_EXACTO = new Map<number, ChequeoAfirmado>([
  // C-1: vía has_table_privilege, que incluye los GRANT a PUBLIC y la herencia
  // por membresía de rol — los dos invisibles para la vista de
  // information_schema que se consultaba antes.
  [1, { descripcion: "C-1 · anon/authenticated sin escritura sobre public", esperado: "ninguno" }],
  [2, { descripcion: "C-1 · anon/authenticated sin lectura sobre public", esperado: "ninguno" }],
  // Las 18 políticas de RLS comparadas por definición (cmd, permissive, roles,
  // USING y WITH CHECK), con FULL OUTER JOIN para atrapar tanto la que falta
  // como la que sobra: 16 de aislamiento uniforme (10 originales + las 6 del
  // outbox y de agenda que agregó 20260901120000, M-5) más las 2 especiales
  // (organizations solo SELECT, roles lectura para autenticados). api_keys y
  // google_calendar_connections no tienen política a propósito (deny-all).
  [5, { descripcion: "Políticas RLS que faltan, sobran o cambiaron", esperado: "ninguna" }],
  [7, { descripcion: "Los 9 índices únicos parciales, por pg_get_indexdef", esperado: "ninguno" }],
  [8, { descripcion: "Los 11 CHECK constraints, por pg_get_constraintdef", esperado: "ninguno" }],
  [9, { descripcion: "Los 2 triggers de email, por pg_get_triggerdef", esperado: "ninguno" }],
  [
    10,
    {
      descripcion:
        "current_organization_id(): security definer, search_path, tipo de retorno y cuerpo",
      esperado: "conforme",
    },
  ],
  // ALTO-6 y ALTO-7, cerrados el 2026-08-28: las dos filas eran informativas
  // porque los hallazgos estaban abiertos y fallaban a propósito. Al cerrarse,
  // dejarlas sin afirmar era dejar el chequeo apagado justo cuando empezaba a
  // poder decir algo.
  [
    11,
    {
      descripcion: "ALTO-6 · los 6 índices (organization_id, deleted_at, created_at)",
      esperado: "ninguno",
    },
  ],
  [
    12,
    {
      descripcion: "ALTO-7 · pg_trgm y los 9 índices GIN gin_trgm_ops de búsqueda",
      esperado: "ninguno",
    },
  ],
  // C-3: las FKs compuestas por organización son la garantía de aislamiento
  // central del proyecto, y hasta la capa de ingesta nada en CI comprobaba que
  // existieran — la migración que las creó podía perderse en un rebase y los
  // tests de aislamiento por repositorio habrían seguido pasando igual, porque
  // prueban el WHERE de la escritura, no la constraint.
  //
  // Desde el 2026-08-28 la fila 14 ya no es una lista: es un chequeo
  // ESTRUCTURAL sobre pg_catalog. Toda FK cuyas dos tablas tengan
  // organization_id tiene que ser compuesta contra (organization_id, id), con
  // ON UPDATE CASCADE, MATCH SIMPLE y el ON DELETE que la regla de
  // 20260821140200 deriva de si la columna referenciante es NOT NULL. Una tabla
  // nueva queda cubierta por existir, sin que nadie edite nada.
  //
  // La fila 16 es lo único que un chequeo estructural no puede saber: A QUÉ
  // padre debe apuntar cada FK. Una FK compuesta bien formada hacia la tabla
  // equivocada pasa la fila 14 entera. Esa lista sigue existiendo, pero ya no
  // es exhaustiva —una FK nueva no obliga a editarla, de eso se ocupa la 14—
  // así que no reintroduce la fricción que el P0 del roadmap vino a sacar.
  [
    14,
    {
      descripcion:
        "C-3 · toda FK entre tablas con organization_id: compuesta, con las acciones de la regla",
      esperado: "ninguna",
    },
  ],
  // M-13, deliberadamente redundante con la fila 7: guardarraíl con nombre
  // propio para un hallazgo concreto, que falla diciendo M-13.
  [
    15,
    {
      descripcion: "M-13 · contacts_org_email_unique evalúa lower(email) en su 2.ª columna",
      esperado: "sobre lower(email)",
    },
  ],
  [
    16,
    {
      descripcion: "C-3 · las 28 FKs conocidas siguen apuntando a la tabla padre de su diseño",
      esperado: "ninguna",
    },
  ],
  // M-7: los índices parciales NO únicos, que la fila 7 no cubre. Hoy los tres
  // de B-14; el de bookings.google_event_id que la estrenó se volvió UNIQUE con
  // V-4 y pasó a la fila 7.
  [
    17,
    {
      descripcion: "M-7 · los índices parciales no únicos, por pg_get_indexdef",
      esperado: "ninguno",
    },
  ],
  // V-3: lo que las filas 1 y 2 afirman sobre las tablas que existen, sobre
  // las que todavía no — pg_default_acl para postgres (y todo rol dueño de
  // tablas en public) no otorga nada a anon/authenticated/PUBLIC sobre tablas
  // nuevas. Es lo que 20260821140100 y 20260902150000 escribieron, y ninguna
  // otra fila lo miraba.
  [
    18,
    {
      descripcion:
        "V-3 · pg_default_acl: sin grants a anon/authenticated/PUBLIC sobre tablas nuevas de public",
      esperado: "ninguno",
    },
  ],
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
  let evaluados = 0;
  for (const fila of filas) {
    const chequeo = ESPERADO_EXACTO.get(fila.n);
    const afirmado = chequeo !== undefined;
    if (afirmado) evaluados++;
    const ok = !afirmado || fila.resultado === chequeo.esperado;
    if (!ok) fallidos.push(fila);

    const marca = !afirmado ? "·" : ok ? "✔" : "✖";
    console.log(`${marca} ${String(fila.n).padStart(2)}. ${fila.chequeo}`);
    console.log(`      resultado: ${fila.resultado}`);
    console.log(`      esperado:  ${fila.esperado}`);
  }

  console.log(
    `\n(· = informativo, no se afirma: describe el ENTORNO —roles con BYPASSRLS, tablas\n sin RLS, huérfanos de auth.users— no la construcción de la base)\n`,
  );

  // El camino inverso del bucle de arriba, y hace falta.
  //
  // Ese bucle recorre las filas que VOLVIERON y para cada una busca su
  // expectativa. Una expectativa cuya fila dejó de volver —porque alguien borró
  // un `union all` del .sql— nunca se consulta: no entra en `fallidos`, y el
  // script terminaba anunciando "los N chequeos afirmados pasaron", donde N era
  // el tamaño del Map y no la cantidad que se evaluó de verdad. Borrar una fila
  // del .sql desactivaba su chequeo en silencio, que es la peor forma de
  // desactivarlo.
  const devueltas = new Set(filas.map((fila) => fila.n));
  const ausentes = [...ESPERADO_EXACTO.keys()].filter((n) => !devueltas.has(n));

  if (ausentes.length > 0) {
    console.error(
      `El diagnóstico NO devolvió ${ausentes.length} de los ${ESPERADO_EXACTO.size} chequeos afirmados. ` +
        `No fallaron: no se evaluaron.\n`,
    );
    for (const n of ausentes) {
      console.error(`  ⚠ fila ${n} — ${ESPERADO_EXACTO.get(n)?.descripcion}`);
    }
    console.error(
      `\nRevisar ${DIAGNOSTICO}: probablemente se borró o se renumeró el ` +
        `\`union all\` de esas filas. Si la fila se sacó a propósito, sacar ` +
        `también su entrada de ESPERADO_EXACTO — dejarla huérfana hace que el ` +
        `script cuente un chequeo que no existe.`,
    );
    process.exit(1);
  }

  if (fallidos.length > 0) {
    console.error(
      `La base NO quedó completa: fallaron ${fallidos.length} de los ${evaluados} chequeos afirmados que se evaluaron.\n`,
    );
    for (const fila of fallidos) {
      console.error(
        `  ✖ ${fila.chequeo}\n      obtuvo:   ${fila.resultado}\n      requería: ${ESPERADO_EXACTO.get(fila.n)?.esperado}`,
      );
    }
    console.error(
      "\nRevisar prisma/migrations, prisma/sql/manual_constraints.sql y " +
        "prisma/sql/rls_policies.sql: algún objeto no llegó a la base.",
    );
    process.exit(1);
  }

  // `evaluados`, no ESPERADO_EXACTO.size: el número que se reporta tiene que ser
  // el de chequeos que efectivamente se compararon contra una fila real.
  console.log(
    `Esquema completo: se evaluaron ${evaluados} chequeos afirmados y pasaron los ${evaluados}.`,
  );
}

main().catch((err: unknown) => {
  console.error("verify-schema: falló la verificación.");
  console.error(err);
  process.exit(1);
});
