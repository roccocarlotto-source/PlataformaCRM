-- Ítem 2 de la sección 6 de docs/ingestion-architecture.md: los tres modelos
-- de la capa de ingesta — Source, ApiKey e IngestionEvent.
--
-- Escrita a mano, no generada por `prisma migrate dev`: el único DATABASE_URL
-- disponible apunta al proyecto real de Supabase, y `migrate dev` usa una
-- shadow database y puede proponer un reset. Quien valida que esto aplica
-- sobre una base vacía es el job `integration` del CI, que la reconstruye
-- desde cero en cada corrida.
--
-- Tres decisiones que el documento de ingesta no cubría y se tomaron para
-- esta migración:
--
-- 1. FKs COMPUESTAS por organización, el estándar del proyecto desde C-3
--    (ver 20260821140200). Las tres relaciones cruzadas de la capa —
--    api_keys -> sources, ingestion_events -> sources e
--    ingestion_events -> contacts— son (organization_id, x_id) REFERENCES
--    padre(organization_id, id), MATCH SIMPLE, ON UPDATE CASCADE. Postgres
--    rechaza a nivel de motor cualquier fila cuya organización no coincida
--    con la de la fila referenciada. Esto exige el séptimo
--    UNIQUE (organization_id, id) del schema, sobre sources.
--
--    ON DELETE, mismo criterio que las 15 existentes: columna referenciante
--    nullable -> NO ACTION (promoted_contact_id); NOT NULL -> RESTRICT
--    (source_id, en las dos tablas hijas). Se evaluó y descartó CASCADE para
--    api_keys -> sources: una ApiKey es una composición estricta de su Source,
--    igual que un Stage lo es de su Pipeline, pero CASCADE borraría
--    credenciales como efecto colateral silencioso — exactamente lo que la
--    migración de C-3 rechazó al elegir NO ACTION sobre SET NULL. RESTRICT
--    falla ruidosamente en vez de destruir en silencio.
--
-- 2. SOFT DELETE solo en sources. isActive y deletedAt no son redundantes,
--    mismo criterio documentado en User: isActive = false es una pausa
--    reversible; deletedAt es la remoción terminal. Sin deletedAt no habría
--    ninguna forma de sacar una Source de la UI, porque
--    ingestion_events -> sources es RESTRICT y una fuente que ya ingestó algo
--    no se puede borrar. api_keys NO lleva deletedAt (revoked_at ya ES el
--    estado terminal, mismo criterio que Invitation) e ingestion_events
--    tampoco (registro de auditoría append-only; la retención se resuelve con
--    un DELETE por created_at + status — ver la sección 9.1 del documento).
--
-- 3. ÍNDICES SEGÚN EL PATRÓN DE CONSULTA REAL, no "por las dudas". El
--    hallazgo A-6 es que ninguna de las 6 entidades existentes tiene índice
--    para su propio listado; estas tres nacen ahora y no repiten el error.
--    Cada índice de la sección 5 tiene su justificación al lado. Nótese la
--    ausencia deliberada del `(organization_id)` de una sola columna que
--    tienen las 6 tablas viejas: un btree sobre (organization_id, ...) ya
--    sirve cualquier WHERE organization_id = ?, así que el índice suelto solo
--    costaría escrituras y espacio.

-- ---------------------------------------------------------------------------
-- 1. Enums nativos
-- ---------------------------------------------------------------------------

-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('WEBHOOK', 'FILE_IMPORT', 'EXTERNAL_DB');

-- CreateEnum
CREATE TYPE "IngestionStatus" AS ENUM ('PENDING', 'PROCESSED', 'FAILED', 'DUPLICATE');

-- ---------------------------------------------------------------------------
-- 2. Tablas
-- ---------------------------------------------------------------------------

-- CreateTable
CREATE TABLE "sources" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "type" "SourceType" NOT NULL,
    "field_mapping" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "source_id" UUID NOT NULL,
    "key_hash" TEXT NOT NULL,
    "key_prefix" VARCHAR(16) NOT NULL,
    "last_used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingestion_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "source_id" UUID NOT NULL,
    "external_id" VARCHAR(255),
    "raw_payload" JSONB NOT NULL,
    "status" "IngestionStatus" NOT NULL DEFAULT 'PENDING',
    "error_message" TEXT,
    "promoted_contact_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ingestion_events_pkey" PRIMARY KEY ("id")
);

-- ---------------------------------------------------------------------------
-- 3. Índices declarados en schema.prisma
-- ---------------------------------------------------------------------------

-- El séptimo UNIQUE (organization_id, id) del schema. Es lo que habilita las
-- dos FKs compuestas que apuntan a sources.
-- CreateIndex
CREATE UNIQUE INDEX "sources_organization_id_id_key" ON "sources"("organization_id", "id");

-- La unicidad de key_hash es GLOBAL, no por organización, y no es cosmética:
-- authenticateApiKey (ítem 4) busca la fila por hash SIN conocer todavía la
-- organización. Es además el índice del camino caliente: una lectura por cada
-- request de ingesta. La verificación de revoked_at se hace sobre la única
-- fila que este índice devuelve, así que no necesita índice propio.
-- CreateIndex
CREATE UNIQUE INDEX "api_keys_key_hash_key" ON "api_keys"("key_hash");

-- Dos usos con un solo índice: el lado REFERENCIANTE de la FK compuesta a
-- sources —que Postgres no indexa por su cuenta— y el listado "claves de esta
-- fuente" ya ordenado por fecha. Sin DESC a propósito: un btree se recorre
-- hacia atrás al mismo costo, y la dirección declarada solo importaría para un
-- ORDER BY de direcciones mixtas.
-- CreateIndex
CREATE INDEX "api_keys_organization_id_source_id_created_at_idx" ON "api_keys"("organization_id", "source_id", "created_at");

-- Lado referenciante de la FK compuesta a sources, y la consulta de resultado
-- de lote de la sección 5 del documento (cuántos eventos entraron, se
-- promovieron y fallaron para una fuente), incluido su GROUP BY status.
-- CreateIndex
CREATE INDEX "ingestion_events_organization_id_source_id_created_at_idx" ON "ingestion_events"("organization_id", "source_id", "created_at");

-- ---------------------------------------------------------------------------
-- 4. Claves foráneas
--
-- Las tres a organizations(id) son simples, como en las 8 tablas existentes:
-- organizations es la raíz, no hay organización de la organización que validar.
-- Las tres cruzadas son compuestas (C-3).
-- ---------------------------------------------------------------------------

-- AddForeignKey
ALTER TABLE "sources" ADD CONSTRAINT "sources_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingestion_events" ADD CONSTRAINT "ingestion_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- api_keys -> sources — source_id es NOT NULL. RESTRICT, no CASCADE: ver la
-- decisión 2 del encabezado.
-- AddForeignKey
ALTER TABLE "api_keys"
  ADD CONSTRAINT "api_keys_organization_id_source_id_fkey"
  FOREIGN KEY ("organization_id", "source_id")
  REFERENCES "sources"("organization_id", "id")
  MATCH SIMPLE
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

-- ingestion_events -> sources — source_id es NOT NULL. RESTRICT: CASCADE
-- borraría la auditoría de origen, que es justamente lo que la sección 1 del
-- documento existe para conservar.
-- AddForeignKey
ALTER TABLE "ingestion_events"
  ADD CONSTRAINT "ingestion_events_organization_id_source_id_fkey"
  FOREIGN KEY ("organization_id", "source_id")
  REFERENCES "sources"("organization_id", "id")
  MATCH SIMPLE
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

-- ingestion_events -> contacts — promoted_contact_id es nullable. MATCH SIMPLE
-- (el default, no MATCH FULL) no valida la FK mientras esa columna sea NULL,
-- que es el estado de todo evento todavía no promovido: el caso normal, no el
-- borde.
-- AddForeignKey
ALTER TABLE "ingestion_events"
  ADD CONSTRAINT "ingestion_events_organization_id_promoted_contact_id_fkey"
  FOREIGN KEY ("organization_id", "promoted_contact_id")
  REFERENCES "contacts"("organization_id", "id")
  MATCH SIMPLE
  ON DELETE NO ACTION
  ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 5. Índices parciales
--
-- El DSL de Prisma no expresa índices parciales, así que estos tres viven acá
-- y quedan anotados como comentario en schema.prisma — mismo tratamiento que
-- los 7 únicos parciales que la migración 20260821140000 incorporó desde
-- manual_constraints.sql. Van en la migración y NO en un .sql aparte: C-2
-- cerró esa puerta, y una restricción crítica que solo existe si alguien se
-- acuerda de correr otro archivo no es una restricción.
-- ---------------------------------------------------------------------------

-- LA RESTRICCIÓN CRÍTICA DE ESTA ETAPA. Lo que hace idempotente a la ingesta,
-- en la base y no en el código: un webhook que reintenta y un Excel que se
-- sube dos veces chocan acá (sección 4 del documento). Parcial porque
-- external_id es nullable y los eventos sin id externo no se deduplican entre
-- sí — se promueven como nuevos y se marcan para revisión manual.
--
-- No lleva organization_id: source_id ya determina la organización, vía la FK
-- compuesta de la sección 4 de esta migración.
CREATE UNIQUE INDEX "ingestion_events_source_external_unique"
  ON "ingestion_events" ("source_id", "external_id")
  WHERE "external_id" IS NOT NULL;

-- La cola del worker de la sección 5: SELECT ... WHERE status = 'PENDING'
-- ORDER BY created_at. El worker drena la cola de todas las organizaciones,
-- no filtra por una, así que este índice NO puede empezar por organization_id.
--
-- Es parcial a propósito, y es la diferencia entre una cola que escala y una
-- que se degrada sola: un (status, created_at) completo cargaría cada fila
-- PROCESSED para siempre, mientras que el parcial solo pesa lo que pesa el
-- backlog — tiende a cero cuando el worker va al día, sin importar cuántos
-- millones de filas históricas haya acumuladas.
--
-- El literal del predicado se castea explícito al enum: un índice parcial
-- exige un predicado IMMUTABLE, y el casteo deja la resolución de tipo
-- resuelta en la definición en vez de depender de la inferencia.
CREATE INDEX "ingestion_events_pending_created_at_idx"
  ON "ingestion_events" ("created_at")
  WHERE "status" = 'PENDING'::"IngestionStatus";

-- El listado por defecto de sources (A-6): WHERE organization_id = ? AND
-- deleted_at IS NULL ORDER BY created_at. Parcial porque sources es la única
-- de las tres tablas con soft delete, y las filas borradas nunca se listan.
CREATE INDEX "sources_org_created_at_idx"
  ON "sources" ("organization_id", "created_at")
  WHERE "deleted_at" IS NULL;

-- ---------------------------------------------------------------------------
-- 6. RLS
--
-- Defensa SECUNDARIA, igual que en el resto del schema: el backend se conecta
-- con un rol equivalente a service_role (BYPASSRLS) y estas políticas no se
-- evalúan para ninguna de sus queries. Protegen los otros caminos de acceso
-- (Realtime, un cliente de Supabase directo, el SQL editor con rol
-- authenticated).
--
-- Los privilegios ya quedaron cerrados sin hacer nada: la migración
-- 20260821140100 dejó un `alter default privileges ... revoke all on tables
-- from anon, authenticated`, así que estas tres tablas nacen sin grants. RLS
-- se habilita igual, para que la fila 4 del diagnóstico (tablas de public sin
-- RLS) siga diciendo "a lo sumo _prisma_migrations".
-- ---------------------------------------------------------------------------

alter table public.sources enable row level security;

drop policy if exists sources_isolation on public.sources;
create policy sources_isolation on public.sources
  for all
  using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());

alter table public.ingestion_events enable row level security;

drop policy if exists ingestion_events_isolation on public.ingestion_events;
create policy ingestion_events_isolation on public.ingestion_events
  for all
  using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());

-- api_keys: RLS habilitada y DELIBERADAMENTE SIN NINGUNA POLÍTICA. Con RLS
-- activa y cero políticas, Postgres deniega todo a cualquier rol que no tenga
-- BYPASSRLS — deny-all. Es la única tabla del schema que guarda material
-- criptográfico: un hash de credencial no debe ser legible por ningún camino
-- que no sea el backend, ni siquiera por el usuario ADMIN de su propia
-- organización a través de PostgREST. La gestión de claves (ítem 3) pasa por
-- Express, que bypassea RLS.
--
-- Por eso el conteo de políticas de la fila 5 del diagnóstico pasa de 10 a 12
-- y no a 13.
alter table public.api_keys enable row level security;
