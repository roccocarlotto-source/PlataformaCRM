import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { prisma } from "./prisma";

// Tests NEGATIVOS del diagnóstico de esquema
// (docs/auditoria-2026-08-21-diagnostico.sql, afirmado por
// scripts/verify-schema.ts).
//
// El CI ya prueba el lado positivo: `npm run verify:schema` corre las 16 filas
// contra la base recién construida y falla si alguna de las 12 afirmadas no da
// su valor. Lo que eso NO prueba es lo único que importaba en la revisión del
// 2026-08-25: que la afirmación FALLE cuando el esquema está mal. Un chequeo
// que pasa siempre también pasa contra una base recién construida.
//
// Cada caso de acá toma la definición REAL del objeto, la compara contra una
// definición ROTA pero plausible —la que tendría el esquema si alguien
// revirtiera la decisión que el chequeo protege— y afirma que el normalizador
// las distingue. Y compara la real contra la esperada, para que "distingue" no
// se confunda con "no matchea nada".
//
// POR QUÉ NO SE ROMPE LA BASE DE VERDAD. La prueba más directa sería, dentro de
// una transacción que después se revierte: DROP INDEX + CREATE INDEX con la
// definición vieja, correr el chequeo, verificar que falla, ROLLBACK. En
// Postgres el DDL es transaccional, así que la base quedaría intacta. Se
// descartó igual: DROP INDEX toma un ACCESS EXCLUSIVE sobre `contacts`, y el
// runner de Node corre los archivos de integración EN PARALELO — al menos
// tenant-isolation y contact-email-uniqueness escriben esa misma tabla. Un lock
// exclusivo sobre una tabla compartida durante una suite paralela cambia un
// test determinista por uno que a veces bloquea a otros, y el costo de
// diagnosticar eso en CI es alto.
//
// Comparar el normalizador contra la definición rota prueba exactamente la
// misma propiedad —la comparación discrimina— sin tocar un solo objeto.
//
// LA EXCEPCIÓN, agregada el 2026-08-28: los tests de la fila 14 SÍ crean
// objetos, y el párrafo de arriba no los alcanza. Lo que se descartó ahí era
// DROP INDEX sobre `contacts`, que toma un ACCESS EXCLUSIVE sobre una tabla
// compartida; esos tests crean tablas NUEVAS dentro de una transacción que
// después se revierte, sin tocar ninguna existente, así que no bloquean a
// nadie. Y no hay alternativa: la fila 14 no pregunta por un objeto con
// nombre sino por todo el esquema a la vez, y una afirmación universal solo se
// prueba falsable con un contraejemplo. Ver el comentario de esa sección.

const DIAGNOSTICO = "docs/auditoria-2026-08-21-diagnostico.sql";

// La cola del normalizador tal como aparece en el .sql. Se afirma más abajo que
// las 11 copias del archivo son idénticas a ésta y que no hay ninguna otra
// variante: si alguien afloja el normalizador —agrega un tipo a la lista de
// casts, saca un paso— este test deja de estar probando lo que el diagnóstico
// hace de verdad, y tiene que enterarse.
//
// String.raw a propósito: así el texto entre backticks es byte por byte el
// mismo que está en el .sql, y la aserción compara lo que parece que compara.
// Con un template literal común habría que escribir `\\.` para obtener `\.`, y
// el texto fuente dejaría de coincidir con el del .sql aunque el valor en
// runtime sí coincida.
const COLA_NORMALIZADOR = String.raw`'::(character varying|text|numeric|bpchar|uuid|integer|bigint|boolean|date|jsonb|"[^"]+")', '', 'g'), 'public\.', '', 'gi'), '[\s()]', '', 'g')`;

const CABEZA_NORMALIZADOR = "lower(regexp_replace(regexp_replace(regexp_replace(";

// Cuántas veces aparece el normalizador completo en el .sql. Es un número
// exacto a propósito: `includes()` devolvía true con UNA coincidencia, así que
// la versión anterior de este test pasaba aunque 10 de las 11 copias hubieran
// divergido — y de hecho una había divergido en el mismo commit que introdujo
// el test. Contar es lo que convierte la aserción en una que no puede pasar sin
// la propiedad.
//
// 11 = 5 comparaciones con dos lados (filas 5, 7, 8, 9 y 10) + la fila 15, que
// compara un solo lado contra un literal ya normalizado.
const COPIAS_ESPERADAS = 11;

// Los únicos regexp_replace del archivo que NO son parte del normalizador: las
// filas 14 y 16 sacan la calificación de esquema de conrelid/confrelid para
// poder comparar contra una firma escrita sin ella. La lista blanca no lleva
// cuenta de cuántas veces aparece cada forma —se quitan todas— porque la
// propiedad que interesa es que no haya VARIANTES, no cuántas copias hay.
//
// Van en una lista blanca explícita para que un regexp_replace nuevo en
// cualquier otro lado haga fallar el test en vez de pasar por "no es del
// normalizador".
const REGEXP_REPLACE_PERMITIDOS = [
  String.raw`regexp_replace(c.conrelid::regclass::text, '^public\.', '')`,
  String.raw`regexp_replace(c.confrelid::regclass::text, '^public\.', '')`,
];

// COLA_NORMALIZADOR termina cerrando el regexp_replace más externo; el `)` del
// final cierra el lower().
function normalizar(expresionSql: string): string {
  return `lower(regexp_replace(regexp_replace(regexp_replace(${expresionSql}, ${COLA_NORMALIZADOR})`;
}

async function norm(expresionSql: string): Promise<string> {
  const filas = await prisma.$queryRawUnsafe<{ v: string | null }[]>(
    `select ${normalizar(expresionSql)} as v`,
  );
  const valor = filas[0]?.v;
  assert.ok(valor, `la expresión no devolvió nada: ${expresionSql}`);
  return valor;
}

// Igual que norm() pero SIN normalizador, para las filas que comparan cadenas
// que el catálogo devuelve tal cual: la firma de la fila 16 se arma
// concatenando attname, sin un solo cast ni calificación de esquema que
// normalizar. Pasarla igual por el normalizador escondería una diferencia de
// mayúsculas o de paréntesis que en ESE formato sí importa.
async function escalar(expresionSql: string): Promise<string> {
  const filas = await prisma.$queryRawUnsafe<{ v: string | null }[]>(`select ${expresionSql} as v`);
  const valor = filas[0]?.v;
  assert.ok(valor, `la expresión no devolvió nada: ${expresionSql}`);
  return valor;
}

// Literal SQL a partir de un string de TS, escapando comillas simples.
function lit(texto: string): string {
  return `'${texto.replace(/'/g, "''")}'`;
}

// real === esperada (el chequeo pasa por la razón correcta) y real !== rota
// (el chequeo distingue). Las dos mitades juntas: sin la primera, "distingue"
// podría significar que no matchea nada; sin la segunda, "matchea" podría
// significar que matchea todo.
async function assertDiscrimina(
  etiqueta: string,
  expresionReal: string,
  esperada: string,
  rota: string,
) {
  const real = await norm(expresionReal);
  const ok = await norm(lit(esperada));
  const mal = await norm(lit(rota));

  assert.equal(
    real,
    ok,
    `${etiqueta}: la definición real no coincide con la esperada por el diagnóstico`,
  );
  assert.notEqual(
    real,
    mal,
    `${etiqueta}: el normalizador NO distingue la definición rota — el chequeo es vacío`,
  );
}

function escaparParaRegex(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Las 11 copias del normalizador en el .sql son idénticas entre sí, idénticas a
// la que usa este test, y no hay ninguna otra variante en el archivo.
//
// Las tres aserciones son distintas y hacen falta las tres:
//   - contar las canónicas atrapa que se agregue o se saque una copia;
//   - que no sobre ningún regexp_replace atrapa que se MODIFIQUE una (deja de
//     matchear la forma canónica y queda como residuo) y que se invente una
//     variante nueva;
//   - la lista blanca atrapa que alguien meta un regexp_replace ajeno al
//     normalizador sin declararlo.
//
// La versión anterior era `archivo.includes(COLA)`, que devuelve true con una
// sola coincidencia: pasaba con 10 copias buenas y 1 divergente, que es
// exactamente lo que había.
test("las 11 copias del normalizador en el .sql son idénticas y no hay variantes", () => {
  // Se sacan las líneas de comentario con el mismo criterio que extraerConsulta
  // en scripts/verify-schema.ts: la propiedad es sobre el SQL que se le manda a
  // Postgres, no sobre la prosa que lo explica. Sin esto, mencionar
  // "regexp_replace" en un comentario del encabezado hace fallar el test — pasó
  // al escribirlo.
  const archivo = readFileSync(DIAGNOSTICO, "utf8")
    .split("\n")
    .filter((linea) => !/^\s*--/.test(linea))
    .join("\n");

  const canonico = new RegExp(
    escaparParaRegex(CABEZA_NORMALIZADOR) + "[\\s\\S]*?" + escaparParaRegex(COLA_NORMALIZADOR),
    "g",
  );
  const encontradas = archivo.match(canonico) ?? [];

  assert.equal(
    encontradas.length,
    COPIAS_ESPERADAS,
    `${DIAGNOSTICO}: se esperaban ${COPIAS_ESPERADAS} copias del normalizador canónico y hay ${encontradas.length}. ` +
      `Si se agregó una comparación nueva, actualizá COPIAS_ESPERADAS; si una copia divergió, unificala — nunca al revés.`,
  );

  // Se sacan del texto las copias canónicas y los regexp_replace declarados.
  // Lo que quede mencionando regexp_replace es una variante no declarada.
  let residuo = archivo.replace(canonico, "");
  for (const permitido of REGEXP_REPLACE_PERMITIDOS) {
    const antes = residuo;
    residuo = residuo.split(permitido).join("");
    assert.notEqual(
      residuo,
      antes,
      `${DIAGNOSTICO}: el regexp_replace declarado en la lista blanca ya no está en el archivo: ${permitido}`,
    );
  }

  const sobrantes = residuo.split("regexp_replace").length - 1;
  assert.equal(
    sobrantes,
    0,
    `${DIAGNOSTICO}: quedaron ${sobrantes} usos de regexp_replace que no son el normalizador canónico ni están en la lista blanca. ` +
      `Una copia modificada del normalizador aparece acá: unificala contra COLA_NORMALIZADOR en vez de aflojarla.`,
  );
});

// ---------------------------------------------------------------------------
// Fila 7 — índices únicos parciales
// ---------------------------------------------------------------------------

test("fila 7 distingue el índice de email SIN lower() — la regresión de M-13", async () => {
  await assertDiscrimina(
    "contacts_org_email_unique",
    `pg_get_indexdef('public.contacts_org_email_unique'::regclass)`,
    "CREATE UNIQUE INDEX contacts_org_email_unique ON public.contacts USING btree (organization_id, lower(email)) WHERE (email IS NOT NULL AND deleted_at IS NULL)",
    // Exactamente la definición anterior a M-13: mismo nombre, mismas columnas,
    // mismo predicado. Solo cambia que compara la columna cruda. Es lo que el
    // chequeo por nombre de la versión vieja daba por bueno.
    "CREATE UNIQUE INDEX contacts_org_email_unique ON public.contacts USING btree (organization_id, email) WHERE (email IS NOT NULL AND deleted_at IS NULL)",
  );
});

test("fila 7 distingue un índice parcial al que le sacaron el predicado", async () => {
  await assertDiscrimina(
    "pipelines_org_default_unique",
    `pg_get_indexdef('public.pipelines_org_default_unique'::regclass)`,
    "CREATE UNIQUE INDEX pipelines_org_default_unique ON public.pipelines USING btree (organization_id) WHERE (is_default = true AND deleted_at IS NULL)",
    // Sin "deleted_at IS NULL" es el bug que este índice ya tuvo una vez:
    // borrar el pipeline default deja a la organización sin poder volver a
    // tener uno, porque la fila borrada sigue ocupando el lugar.
    "CREATE UNIQUE INDEX pipelines_org_default_unique ON public.pipelines USING btree (organization_id) WHERE (is_default = true)",
  );
});

test("fila 7 distingue un índice que dejó de ser único", async () => {
  await assertDiscrimina(
    "ingestion_events_source_external_unique",
    `pg_get_indexdef('public.ingestion_events_source_external_unique'::regclass)`,
    "CREATE UNIQUE INDEX ingestion_events_source_external_unique ON public.ingestion_events USING btree (source_id, external_id) WHERE (external_id IS NOT NULL)",
    // Sin UNIQUE la ingesta deja de ser idempotente y un webhook que reintenta
    // duplica. El nombre no cambia.
    "CREATE INDEX ingestion_events_source_external_unique ON public.ingestion_events USING btree (source_id, external_id) WHERE (external_id IS NOT NULL)",
  );
});

// ---------------------------------------------------------------------------
// Fila 8 — CHECK constraints
// ---------------------------------------------------------------------------

test("fila 8 distingue un CHECK reescrito para no restringir nada", async () => {
  await assertDiscrimina(
    "opportunities_amount_non_negative_check",
    `(select pg_get_constraintdef(oid) from pg_constraint where conname = 'opportunities_amount_non_negative_check')`,
    "CHECK (amount >= 0)",
    // El caso de manual: existe, se llama igual, y la base acepta montos
    // negativos.
    "CHECK (true)",
  );
});

test("fila 8 distingue el CHECK de espacios del email vaciado de contenido", async () => {
  await assertDiscrimina(
    "contacts_email_trimmed_check",
    `(select pg_get_constraintdef(oid) from pg_constraint where conname = 'contacts_email_trimmed_check')`,
    "CHECK (email IS NULL OR email = btrim(email))",
    "CHECK (true)",
  );
});

// ---------------------------------------------------------------------------
// Fila 9 — triggers
// ---------------------------------------------------------------------------

test("fila 9 distingue el trigger de email movido de BEFORE a AFTER", async () => {
  await assertDiscrimina(
    "trg_set_user_email_from_auth",
    `(select pg_get_triggerdef(oid) from pg_trigger where tgname = 'trg_set_user_email_from_auth' and not tgisinternal)`,
    "CREATE TRIGGER trg_set_user_email_from_auth BEFORE INSERT OR UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION set_user_email_from_auth()",
    // AFTER no sirve: el trigger sobrescribe NEW.email antes de que la fila se
    // escriba. Después de escrita, ya no hay nada que corregir.
    "CREATE TRIGGER trg_set_user_email_from_auth AFTER INSERT OR UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION set_user_email_from_auth()",
  );
});

// ---------------------------------------------------------------------------
// Fila 10 — current_organization_id()
// ---------------------------------------------------------------------------

test("fila 10 distingue la función vaciada y la que perdió security definer", async () => {
  const firmaReal = `('secdef=' || p.prosecdef::text || '/vol=' || p.provolatile::text || '/cfg=' || coalesce(array_to_string(p.proconfig, ','), '-') || '/body=' || p.prosrc)`;
  const real = await norm(
    `(select ${firmaReal} from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace where ns.nspname = 'public' and p.proname = 'current_organization_id')`,
  );

  const esperada = await norm(
    lit(
      "secdef=true/vol=s/cfg=search_path=public/body=select organization_id from public.users where id = auth.uid();",
    ),
  );
  assert.equal(real, esperada, "la función real no coincide con la esperada");

  // Cuerpo vaciado: toda política de aislamiento pasa a comparar contra NULL.
  assert.notEqual(
    real,
    await norm(lit("secdef=true/vol=s/cfg=search_path=public/body=select null::uuid;")),
  );

  // Sin security definer vuelve la recursión que la función existe para cortar:
  // leer public.users para resolver la organización re-evalúa RLS sobre
  // public.users.
  assert.notEqual(
    real,
    await norm(
      lit(
        "secdef=false/vol=s/cfg=search_path=public/body=select organization_id from public.users where id = auth.uid();",
      ),
    ),
  );

  // Sin search_path fijado, el caller elige qué tabla `users` se lee.
  assert.notEqual(
    real,
    await norm(
      lit(
        "secdef=true/vol=s/cfg=-/body=select organization_id from public.users where id = auth.uid();",
      ),
    ),
  );
});

// ---------------------------------------------------------------------------
// Fila 5 — políticas de RLS
// ---------------------------------------------------------------------------

test("fila 5 distingue una política de aislamiento abierta con USING (true)", async () => {
  await assertDiscrimina(
    "contacts_isolation",
    `(select qual from pg_policies where schemaname = 'public' and policyname = 'contacts_isolation')`,
    "(organization_id = current_organization_id())",
    // El conteo de políticas que había antes daba 12 igual con esto puesto.
    "(true)",
  );
});

// ---------------------------------------------------------------------------
// Fila 16 — el mapa hijo -> padre de las 18 FKs conocidas
// ---------------------------------------------------------------------------

// ESTE TEST ESTABA EN LA FILA 14 y se mudó acá el 2026-08-28, junto con la
// cobertura que prueba.
//
// La fila 14 pasó a ser un chequeo ESTRUCTURAL y por construcción no puede ver
// este caso: una FK compuesta bien formada hacia la tabla equivocada tiene dos
// columnas, la primera organization_id de los dos lados, y acciones
// referenciales conformes. Pasa la fila 14 entera. A qué padre debe apuntar
// cada FK solo lo sabe un mapa, y ese mapa es ahora la fila 16.
//
// Sin normalizador, a diferencia de las filas 5/7/8/9/10/15: la firma de la
// fila 16 se arma concatenando attname y no contiene nada que normalizar.
test("fila 16 distingue una FK compuesta que apunta al padre equivocado", async () => {
  const firma = (nombre: string) => `(
    select c.conname || '|'
      || regexp_replace(c.conrelid::regclass::text, '^public\\.', '') || '('
      || (select string_agg(a.attname, ',' order by k.ord)
            from unnest(c.conkey) with ordinality as k(attnum, ord)
            join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum)
      || ')->'
      || regexp_replace(c.confrelid::regclass::text, '^public\\.', '') || '('
      || (select string_agg(a.attname, ',' order by k.ord)
            from unnest(c.confkey) with ordinality as k(attnum, ord)
            join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.attnum)
      || ')'
    from pg_constraint c where c.conname = ${lit(nombre)})`;

  const real = await escalar(firma("ingestion_events_organization_id_promoted_contact_id_fkey"));

  const ESPERADA =
    "ingestion_events_organization_id_promoted_contact_id_fkey|" +
    "ingestion_events(organization_id,promoted_contact_id)->contacts(organization_id,id)";

  // El padre equivocado: la FK seguiría siendo compuesta y seguiría empezando
  // por organization_id de los dos lados. Compararía la organización contra la
  // tabla que no es, y la fila 14 no tendría forma de notarlo.
  const CON_PADRE_EQUIVOCADO =
    "ingestion_events_organization_id_promoted_contact_id_fkey|" +
    "ingestion_events(organization_id,promoted_contact_id)->users(organization_id,id)";

  assert.equal(real, ESPERADA, "la FK real no coincide con la firma que espera la fila 16");
  assert.notEqual(real, CON_PADRE_EQUIVOCADO);

  // Y que la fila 16 del .sql liste EXACTAMENTE esa firma. Sin esto el test
  // compararía la base contra su propia constante, y la lista del diagnóstico
  // podría haber derivado sin que nadie se entere — que es justo el modo de
  // fallo que este archivo existe para cerrar.
  const archivo = readFileSync(DIAGNOSTICO, "utf8");
  assert.ok(
    archivo.includes(`('${ESPERADA}')`),
    `${DIAGNOSTICO}: la fila 16 ya no lista la firma esperada de ingestion_events -> contacts`,
  );
  assert.ok(
    !archivo.includes(`('${CON_PADRE_EQUIVOCADO}')`),
    `${DIAGNOSTICO}: la fila 16 lista la firma con el padre EQUIVOCADO`,
  );
});

// ---------------------------------------------------------------------------
// Fila 14 — el chequeo estructural genérico
// ---------------------------------------------------------------------------

// ESTE ES EL ÚNICO TEST DEL ARCHIVO QUE CREA OBJETOS, y el argumento del
// encabezado para no hacerlo no aplica acá.
//
// Lo que se descartó arriba era DROP INDEX + CREATE INDEX sobre `contacts`:
// eso toma un ACCESS EXCLUSIVE sobre una tabla que otros archivos de la suite
// escriben en paralelo. Esto crea TRES TABLAS NUEVAS y no toca ninguna
// existente, así que no bloquea a nadie. El DDL de Postgres es transaccional:
// la transacción se revierte al terminar y ninguna otra sesión llega a ver las
// tablas, ni siquiera mientras existen.
//
// Y crear algo es la única forma de probar esta fila. Las demás preguntan por
// un objeto CON NOMBRE, así que alcanza con comparar su definición real contra
// una rota. La fila 14 pregunta por TODO EL ESQUEMA a la vez —"ninguna FK entre
// tablas con organization_id está mal formada"— y una afirmación universal solo
// se prueba falsable poniéndole delante un contraejemplo.
//
// Los tres fixtures cubren las tres mitades del chequeo: la FK simple (la
// pregunta original de C-3), la compuesta con un ON DELETE que viola la regla
// derivada, y la compuesta conforme —esta última para que "detecta" no se
// confunda con "marca todo".

const FIN_FILA_14 = "where problema is not null";

// Extrae del .sql el TEXTO REAL de la fila 14 para correrlo solo. Se afirma
// sobre el diagnóstico, no sobre una copia de su lógica: una copia divergiría,
// que es el modo de fallo que este archivo persigue en el normalizador.
function extraerFila14(): string {
  const sql = readFileSync(DIAGNOSTICO, "utf8")
    .split("\n")
    .filter((linea) => !/^\s*--/.test(linea))
    .join("\n");

  const inicio = sql.indexOf("select 14,");
  assert.notEqual(inicio, -1, `${DIAGNOSTICO}: no se encontró el "select 14," de la fila 14`);

  const fin = sql.indexOf(FIN_FILA_14, inicio);
  assert.notEqual(
    fin,
    -1,
    `${DIAGNOSTICO}: la fila 14 ya no termina en "${FIN_FILA_14}" — si se reescribió, actualizar FIN_FILA_14`,
  );

  return sql.slice(inicio, fin + FIN_FILA_14.length);
}

// Marca para revertir la transacción sin que el fallo se confunda con un error
// real: Prisma solo revierte si el callback lanza.
class Revertir extends Error {}

async function resultadoFila14Con(ddl: string[]): Promise<string> {
  const consulta = `select * from (${extraerFila14()}) as t(n, chequeo, resultado, esperado)`;
  let resultado: string | undefined;

  try {
    await prisma.$transaction(async (tx) => {
      for (const sentencia of ddl) {
        await tx.$executeRawUnsafe(sentencia);
      }
      const filas = await tx.$queryRawUnsafe<{ resultado: string }[]>(consulta);
      resultado = filas[0]?.resultado;
      throw new Revertir();
    });
  } catch (err) {
    if (!(err instanceof Revertir)) throw err;
  }

  assert.ok(resultado !== undefined, "la fila 14 no devolvió ninguna fila");
  return resultado;
}

test("fila 14 detecta una FK simple y un ON DELETE fuera de la regla, sin marcar la conforme", async () => {
  const resultado = await resultadoFila14Con([
    `create table public.zz_fila14_padre (
       organization_id uuid not null,
       id uuid not null primary key,
       unique (organization_id, id)
     )`,

    // (1) FK SIMPLE entre dos tablas con organization_id. Es exactamente el
    // agujero de C-3: Postgres verifica que el UUID exista, no que pertenezca a
    // la misma organización.
    `create table public.zz_fila14_hijo_simple (
       organization_id uuid not null,
       id uuid not null primary key,
       padre_id uuid,
       constraint zz_fila14_hijo_simple_padre_fkey
         foreign key (padre_id) references public.zz_fila14_padre(id)
     )`,

    // (2) Compuesta y bien apuntada, pero con ON DELETE CASCADE sobre una
    // columna NULLABLE. La regla de 20260821140200 dice NO ACTION ahí, y
    // CASCADE borraría filas como efecto colateral silencioso.
    `create table public.zz_fila14_hijo_cascade (
       organization_id uuid not null,
       id uuid not null primary key,
       padre_id uuid,
       constraint zz_fila14_hijo_cascade_padre_fkey
         foreign key (organization_id, padre_id)
         references public.zz_fila14_padre(organization_id, id)
         on update cascade on delete cascade
     )`,

    // (3) La conforme: compuesta, contra (organization_id, id), ON UPDATE
    // CASCADE, ON DELETE NO ACTION porque padre_id es nullable.
    `create table public.zz_fila14_hijo_ok (
       organization_id uuid not null,
       id uuid not null primary key,
       padre_id uuid,
       constraint zz_fila14_hijo_ok_padre_fkey
         foreign key (organization_id, padre_id)
         references public.zz_fila14_padre(organization_id, id)
         on update cascade on delete no action
     )`,
  ]);

  assert.match(
    resultado,
    /zz_fila14_hijo_simple\(padre_id\).*FK SIMPLE/,
    `la fila 14 no reportó la FK simple. Devolvió: ${resultado}`,
  );

  assert.match(
    resultado,
    /zz_fila14_hijo_cascade\(organization_id,padre_id\): ON DELETE es c y debería ser a/,
    `la fila 14 no reportó el ON DELETE fuera de la regla. Devolvió: ${resultado}`,
  );

  assert.ok(
    !resultado.includes("zz_fila14_hijo_ok"),
    `la fila 14 marcó como problema una FK conforme — el chequeo marca todo. Devolvió: ${resultado}`,
  );
});

test("fila 14 no mira las FKs cuyo padre no tiene organization_id", async () => {
  // El recorte que hace que x.organization_id -> organizations.id y
  // users.role_id -> roles.id no entren. Sin él, la fila 14 exigiría que la FK
  // a la propia tabla de organizaciones fuera compuesta contra
  // organizations(organization_id, id), una columna que no existe.
  const resultado = await resultadoFila14Con([
    `create table public.zz_fila14_catalogo (
       id uuid not null primary key
     )`,
    `create table public.zz_fila14_hijo_catalogo (
       organization_id uuid not null,
       id uuid not null primary key,
       catalogo_id uuid,
       constraint zz_fila14_hijo_catalogo_fkey
         foreign key (catalogo_id) references public.zz_fila14_catalogo(id)
     )`,
  ]);

  assert.equal(
    resultado,
    "ninguna",
    `la fila 14 marcó una FK hacia una tabla sin organization_id. Devolvió: ${resultado}`,
  );
});

test("fila 14 falla si una excepción declarada deja de corresponder a una FK", async () => {
  // La excepción de stages -> pipelines no es una exención: si esa FK
  // desapareciera, el `values` quedaría declarando algo que ya no existe y el
  // chequeo lo dice en vez de callarse. No se puede borrar esa FK para
  // probarlo —tomaría un lock sobre stages— así que se prueba la propiedad
  // simétrica: que el nombre declarado en el .sql es exactamente el de una FK
  // que existe hoy.
  const declarada = await escalar(
    `(select count(*)::text from pg_constraint c
        join pg_namespace ns on ns.oid = c.connamespace
        where ns.nspname = 'public'
          and c.conname = 'stages_organization_id_pipeline_id_fkey')`,
  );
  assert.equal(
    declarada,
    "1",
    "la excepción declarada en la fila 14 no corresponde a ninguna FK real: el chequeo la reportaría como EXCEPCIÓN HUÉRFANA",
  );

  const archivo = readFileSync(DIAGNOSTICO, "utf8");
  assert.ok(
    archivo.includes("('stages_organization_id_pipeline_id_fkey', 'c',"),
    `${DIAGNOSTICO}: la fila 14 ya no declara la excepción de stages -> pipelines`,
  );
});

// ---------------------------------------------------------------------------
// Fila 15 — el guardarraíl con nombre propio de M-13
// ---------------------------------------------------------------------------

test("fila 15 mira la 2.ª columna clave, no cualquier mención de lower en la definición", async () => {
  const segundaColumna = await norm(
    `pg_get_indexdef('public.contacts_org_email_unique'::regclass, 2, true)`,
  );
  assert.equal(segundaColumna, "loweremail");

  // La versión anterior de la fila 15 era `indexdef ilike '%lower%'`. Este es
  // el contraejemplo que la habría dado por buena: un índice case-sensitive
  // sobre email cuyo predicado menciona lower() en OTRA columna. Contiene
  // "lower", así que pasaba; no compara el email sin distinguir mayúsculas, así
  // que la ingesta duplicaría igual.
  const definicionQueEngañabaAlIlike =
    "CREATE UNIQUE INDEX contacts_org_email_unique ON public.contacts USING btree (organization_id, email) WHERE (email IS NOT NULL AND deleted_at IS NULL AND lower(first_name) <> 'x')";
  assert.match(
    definicionQueEngañabaAlIlike,
    /lower/i,
    "el contraejemplo tiene que contener 'lower' para que sirva de contraejemplo",
  );
  assert.notEqual(
    await norm(lit(definicionQueEngañabaAlIlike)),
    await norm(`pg_get_indexdef('public.contacts_org_email_unique'::regclass)`),
    "la fila 7 tampoco debe darla por buena",
  );
});
