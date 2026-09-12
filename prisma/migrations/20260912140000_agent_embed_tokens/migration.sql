-- ---------------------------------------------------------------------------
-- Módulo de Agentes de IA, paso 5a de docs/ai-agent-architecture.md §9: el
-- schema del token de embed del widget del canal Web (nota del canal Web en
-- §10) — la tabla agent_embed_tokens y la columna agents.allowed_origins. El
-- endpoint público que los usa es 5b, un PR aparte.
--
-- Escrita a mano, no generada por `prisma migrate dev`: mismo motivo que el
-- resto de las migraciones desde 20260821 (la shadow database no tiene el
-- schema auth). Quien valida que aplica sobre una base vacía es el job
-- `integration` del CI, que reconstruye la base desde cero en cada corrida.
--
-- agent_embed_tokens es PARALELA a api_keys (20260824120000), no una
-- extensión: mismo shape (hash único + prefix, revoked_at como estado
-- terminal, sin deleted_at) pero scopeada a (organization_id, agent_id) en
-- vez de (organization_id, source_id). Sin updated_at: la única transición es
-- revoked_at.
--
-- LAS ACCIONES REFERENCIALES salen de la regla de 20260821140200 y la fila 14
-- del diagnóstico las deriva sola: agent_id es NOT NULL -> RESTRICT. No
-- CASCADE: agents usa soft delete y sus tokens se revocan (revoked_at) desde
-- deleteAgent, igual que deleteSource revoca sus api_keys — la invariante
-- vive en los datos, no en un middleware.
--
-- Al diagnóstico (docs/auditoria-2026-08-21-diagnostico.sql) entra en este
-- mismo cambio la FK compuesta nueva, a la fila 16 (42 -> 43). La fila 4
-- (tablas sin RLS) no cambia: la tabla nace con RLS habilitada, ver el final.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. agents.allowed_origins
--
-- Orígenes (esquema + host, sin path) desde los que el widget puede
-- escribirle al agente. DEFAULT '{}' y NOT NULL: vacío = widget deshabilitado
-- (fail-closed), y es lo que reciben todos los agentes existentes — ninguno
-- queda accesible desde ningún origen por el solo hecho de existir antes de
-- esta migración. A diferencia de enabled_tools/channels (sin DEFAULT, Prisma
-- devuelve [] ante NULL), acá el default es explícito porque el schema lo
-- declara (@default([])) y porque la semántica de "vacío" es una decisión de
-- seguridad, no una ausencia de dato.
-- ---------------------------------------------------------------------------

-- AlterTable
ALTER TABLE "agents" ADD COLUMN "allowed_origins" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- ---------------------------------------------------------------------------
-- 2. agent_embed_tokens
-- ---------------------------------------------------------------------------

-- CreateTable
CREATE TABLE "agent_embed_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "agent_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "token_prefix" VARCHAR(16) NOT NULL,
    "last_used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_embed_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- UNIQUE global sobre el hash: en el momento de autenticar el widget todavía
-- no se conoce la organización, es justamente lo que esta búsqueda resuelve.
-- Mismo criterio que api_keys_key_hash_key.
CREATE UNIQUE INDEX "agent_embed_tokens_token_hash_key" ON "agent_embed_tokens"("token_hash");

-- CreateIndex
-- (organization_id, agent_id, created_at) cubre el lado referenciante de la
-- FK compuesta —que Postgres no indexa por su cuenta— y el listado "tokens de
-- este agente" ya ordenado, con un solo índice. Mismo criterio que
-- api_keys_organization_id_source_id_created_at_idx.
CREATE INDEX "agent_embed_tokens_organization_id_agent_id_created_at_idx" ON "agent_embed_tokens"("organization_id", "agent_id", "created_at");

-- ---------------------------------------------------------------------------
-- 3. Foreign keys — la cruzada es COMPUESTA (organization_id, agent_id) ->
-- agents(organization_id, id), el estándar del proyecto desde C-3. Apoya en
-- el UNIQUE agents_organization_id_id_key que ya existe (20260912130000).
-- ---------------------------------------------------------------------------

-- AddForeignKey
ALTER TABLE "agent_embed_tokens" ADD CONSTRAINT "agent_embed_tokens_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_embed_tokens" ADD CONSTRAINT "agent_embed_tokens_organization_id_agent_id_fkey"
    FOREIGN KEY ("organization_id", "agent_id") REFERENCES "agents"("organization_id", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 4. RLS habilitada y DELIBERADAMENTE SIN NINGUNA POLÍTICA — deny-all, el
-- mismo tratamiento que api_keys (20260824120000): guarda material
-- criptográfico (el hash de una credencial) y no debe ser legible por ningún
-- camino que no sea el backend, ni siquiera por el ADMIN de su propia
-- organización vía PostgREST. La administración pasa por Express, que
-- bypassea RLS. Por eso NO entra a la lista de políticas de la fila 5 del
-- diagnóstico, igual que api_keys.
--
-- Sin grants: el `alter default privileges ... revoke all on tables from
-- anon, authenticated` de 20260821140100 hace que la tabla nazca sin ellos
-- (fila 18 del diagnóstico).
-- ---------------------------------------------------------------------------
alter table public.agent_embed_tokens enable row level security;
