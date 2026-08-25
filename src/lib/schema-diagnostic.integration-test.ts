import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { prisma } from "./prisma";

// Tests NEGATIVOS del diagnóstico de esquema
// (docs/auditoria-2026-08-21-diagnostico.sql, afirmado por
// scripts/verify-schema.ts).
//
// El CI ya prueba el lado positivo: `npm run verify:schema` corre las 15 filas
// contra la base recién construida y falla si alguna de las 9 afirmadas no da
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

const DIAGNOSTICO = "docs/auditoria-2026-08-21-diagnostico.sql";

// La cola del normalizador tal como aparece en el .sql. Se afirma más abajo que
// este texto sigue estando en el archivo: si alguien afloja el normalizador
// —agrega un tipo a la lista de casts, saca un paso— este test deja de estar
// probando lo que el diagnóstico hace de verdad, y tiene que enterarse.
// String.raw a propósito: así el texto entre backticks es byte por byte el
// mismo que está en el .sql, y la aserción de más abajo —que este texto siga
// apareciendo en el archivo— compara lo que parece que compara. Con un template
// literal común habría que escribir `\\.` para obtener `\.`, y el texto fuente
// dejaría de coincidir con el del .sql aunque el valor en runtime sí coincida.
const COLA_NORMALIZADOR = String.raw`'::(character varying|text|numeric|bpchar|uuid|integer|bigint|boolean|date|jsonb|"[^"]+")', '', 'g'), 'public\.', '', 'gi'), '[\s()]', '', 'g')`;

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

test("el normalizador del test es el mismo que usa el diagnóstico", () => {
  const archivo = readFileSync(DIAGNOSTICO, "utf8");
  assert.ok(
    archivo.includes(COLA_NORMALIZADOR),
    `${DIAGNOSTICO} ya no contiene el normalizador que este test replica: si se aflojó, estos tests dejaron de probar lo que el diagnóstico hace`,
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
// Fila 14 — FKs compuestas
// ---------------------------------------------------------------------------

test("fila 14 distingue una FK compuesta que apunta al padre equivocado", async () => {
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
      || ') upd=' || c.confupdtype::text || ' del=' || c.confdeltype::text || ' match=' || c.confmatchtype::text
    from pg_constraint c where c.conname = ${lit(nombre)})`;

  const real = await norm(
    firma("ingestion_events_organization_id_promoted_contact_id_fkey"),
  );

  assert.equal(
    real,
    await norm(
      lit(
        "ingestion_events_organization_id_promoted_contact_id_fkey|ingestion_events(organization_id,promoted_contact_id)->contacts(organization_id,id) upd=c del=a match=s",
      ),
    ),
  );

  // El padre equivocado: la FK seguiría siendo compuesta, seguiría empezando
  // por organization_id de los dos lados, y seguiría contando para el total de
  // 18 que afirmaba la versión anterior. Pero compararía la organización contra
  // la tabla que no es.
  assert.notEqual(
    real,
    await norm(
      lit(
        "ingestion_events_organization_id_promoted_contact_id_fkey|ingestion_events(organization_id,promoted_contact_id)->users(organization_id,id) upd=c del=a match=s",
      ),
    ),
  );

  // Y la acción referencial: CASCADE en vez de NO ACTION borraría eventos de
  // auditoría al borrar un contacto. El conteo tampoco lo veía.
  assert.notEqual(
    real,
    await norm(
      lit(
        "ingestion_events_organization_id_promoted_contact_id_fkey|ingestion_events(organization_id,promoted_contact_id)->contacts(organization_id,id) upd=c del=c match=s",
      ),
    ),
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
