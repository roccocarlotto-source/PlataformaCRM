-- ---------------------------------------------------------------------------
-- PR R7 de docs/rubros.md (§15, §4.6, D4, D18): los canales de notificaciones
-- de Google Calendar pasan a su propia tabla, google_calendar_channels.
--
-- COPIA, NO MUEVE. Las cuatro columnas de google_calendar_connections
-- (channel_id, channel_resource_id, channel_expiration, sync_token) quedan
-- como están, con sus datos, su UNIQUE, su índice y su CHECK. El código de R7
-- lee la tabla nueva y las sigue escribiendo EN ESPEJO, en la misma
-- transacción: volver al código de antes de R7 no pierde nada. Se borran en
-- R21 (D18), que no se mergea por iniciativa propia.
--
-- 1. Tabla nueva. Una fila por (organización, sucursal, calendario); en R7, a
--    lo sumo una por sucursal: la del calendario de su conexión. FK compuesta
--    a branches por (organization_id, branch_id), con las acciones de la
--    regla C-3 (NOT NULL -> RESTRICT, ON UPDATE CASCADE), y FK simple a
--    organizations, como google_calendar_connections. El CHECK de "los tres
--    del canal van juntos" es el mismo que el de la conexión.
--
-- 2. La copia: por cada conexión con canal o con syncToken, una fila con los
--    cuatro valores TAL COMO ESTÁN. Los canales vivos en Google son los
--    mismos (mismo channel_id, mismo resource id de Google, mismo
--    vencimiento): ninguna sucursal reconecta y ninguna notificación en vuelo
--    se pierde, porque el webhook encuentra el channel_id en la tabla nueva.
--    ON CONFLICT DO NOTHING: correrla dos veces no duplica ni pisa. Es una
--    tabla de una fila por sucursal: el INSERT ... SELECT no bloquea nada que
--    importe.
--
--    Entre que se aplica esta migración y se despliega el código de R7, el
--    código viejo puede renovar un canal o avanzar un syncToken en las
--    columnas viejas. El código de R7 lo reconcilia solo
--    (reconciliarCanalesConLasColumnasViejas, al empezar cada pasada del
--    worker) y el webhook busca también en las columnas viejas si no lo
--    encuentra en la tabla nueva.
--
-- 3. RLS habilitada y SIN políticas (deny-all), el criterio de
--    google_calendar_connections y meta_page_connections: solo la usa el
--    backend. Nace sin grants a anon/authenticated (fila 18 del diagnóstico).
--
-- Para revertir (antes de R21): volver al código anterior alcanza, las
-- columnas viejas están al día por el espejo. La tabla se puede dejar o
-- borrar con DROP TABLE google_calendar_channels.
--
-- Escrita a mano a partir de `prisma migrate diff --from-schema-datasource`
-- contra el Supabase local; la copia, el CHECK y la RLS se agregan a mano. El
-- diagnóstico (docs/auditoria-2026-08-21-diagnostico.sql) los afirma en las
-- filas 8 y 16 en este mismo cambio.
--
-- El nombre ordena DESPUÉS de 20261101120000_clinicas_configuracion.
-- ---------------------------------------------------------------------------

-- 1. CreateTable
CREATE TABLE "google_calendar_channels" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "calendar_id" VARCHAR(255) NOT NULL,
    "channel_id" UUID,
    "channel_resource_id" VARCHAR(255),
    "channel_expiration" TIMESTAMP(3),
    "sync_token" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "google_calendar_channels_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "google_calendar_channels_channel_all_or_none_check"
        CHECK (
            ("channel_id" IS NULL AND "channel_resource_id" IS NULL AND "channel_expiration" IS NULL)
            OR
            ("channel_id" IS NOT NULL AND "channel_resource_id" IS NOT NULL AND "channel_expiration" IS NOT NULL)
        )
);

-- CreateIndex
CREATE UNIQUE INDEX "google_calendar_channels_channel_id_key" ON "google_calendar_channels"("channel_id");

-- CreateIndex
CREATE INDEX "google_calendar_channels_channel_expiration_idx" ON "google_calendar_channels"("channel_expiration");

-- CreateIndex
CREATE UNIQUE INDEX "google_calendar_channels_organization_id_branch_id_calendar_id_key" ON "google_calendar_channels"("organization_id", "branch_id", "calendar_id");

-- AddForeignKey
ALTER TABLE "google_calendar_channels" ADD CONSTRAINT "google_calendar_channels_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "google_calendar_channels" ADD CONSTRAINT "google_calendar_channels_organization_id_branch_id_fkey" FOREIGN KEY ("organization_id", "branch_id") REFERENCES "branches"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 2. La copia de los canales y syncTokens existentes.
INSERT INTO "google_calendar_channels" (
    "organization_id", "branch_id", "calendar_id",
    "channel_id", "channel_resource_id", "channel_expiration", "sync_token",
    "created_at", "updated_at"
)
SELECT
    c."organization_id", c."branch_id", c."calendar_id",
    c."channel_id", c."channel_resource_id", c."channel_expiration", c."sync_token",
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "google_calendar_connections" c
WHERE c."channel_id" IS NOT NULL OR c."sync_token" IS NOT NULL
ON CONFLICT ("organization_id", "branch_id", "calendar_id") DO NOTHING;

-- 3. Row Level Security: habilitada, sin políticas (deny-all).
alter table public.google_calendar_channels enable row level security;
