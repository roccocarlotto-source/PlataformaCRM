-- ---------------------------------------------------------------------------
-- Ítem 169 de docs/frontend-cambios-pendientes.md (rama
-- feat/canales-meta-infraestructura): infraestructura de datos de los canales
-- de Meta, paso 1 de 5 (Instagram + Messenger). SOLO datos: sin webhook, sin
-- envío y sin OAuth (ítems 170-173). Nada llena todavía las tablas nuevas.
--
-- CINCO COSAS:
--
-- 1. ConversationChannel + INSTAGRAM, MESSENGER. ADD VALUE dentro de la
--    transacción de la migración es válido desde Postgres 12; lo que no se
--    puede es USAR el valor nuevo en la misma transacción, y acá no se usa (el
--    default de agent_inbound_jobs.channel es WHATSAPP, que ya existía).
--
-- 2. agents.facebook_page_id — mismo patrón EXACTO que whatsapp_phone_number_id
--    (20260929120000, ítem 127): NULLABLE, sin backfill, UNIQUE GLOBAL (el
--    webhook de Meta trae el page id y ninguna otra pista). Lo escribe solo el
--    endpoint de platform admin.
--
-- 3. agent_inbound_jobs generalizada a los tres canales de Meta:
--    phone_number_id -> channel_account_id y wa_id -> external_user_id, más
--    `channel` con default WHATSAPP.
--
--    RENAME Y NO DROP + ADD, y es lo más delicado de esta migración: la tabla
--    es una cola y puede tener filas en tránsito (PENDING/PROCESSING). `prisma
--    migrate diff` propone DROP COLUMN + ADD COLUMN NOT NULL —que además
--    fallaría con filas presentes—; se reemplazó a mano por RENAME COLUMN, que
--    conserva el valor de cada fila. Mismo tipo (VARCHAR(40)) y mismo NOT
--    NULL, así que el rename no deja drift. El default de `channel` clasifica
--    las filas existentes —todas de WhatsApp— sin tocarlas a mano.
--
-- 4. contact_channel_identities — (organization_id, channel, external_id) ->
--    contact_id: el PSID/IGSID de un contacto, que no es un teléfono. El
--    UNIQUE es la garantía de que dos webhooks concurrentes del mismo contacto
--    nuevo no creen dos Contact. Nace vacía, sin backfill: WhatsApp no la usa.
--
-- 5. meta_page_connections — la conexión OAuth de una organización con SU
--    página de Facebook. Mismo molde que google_calendar_connections
--    (20260829120000): token cifrado y nullable, el mismo CHECK "ACTIVE exige
--    token", y RLS habilitada con CERO políticas (deny-all, guarda secretos),
--    igual que google_calendar_connections y api_keys. La diferencia: UNA por
--    ORGANIZACIÓN (organization_id UNIQUE), no por sucursal.
--
-- Escrita a mano, no generada por `prisma migrate dev`: mismo motivo que el
-- resto de las migraciones desde 20260821 (la shadow database no tiene el
-- schema auth). Salvo el rename del punto 3, las sentencias son exactamente
-- lo que `prisma migrate diff` deriva del schema, para que no aparezca drift;
-- el CHECK y la RLS son lo que el DSL de Prisma no expresa.
--
-- Al diagnóstico (docs/auditoria-2026-08-21-diagnostico.sql) entran en este
-- mismo cambio: la política de contact_channel_identities a la fila 5, el
-- CHECK de meta_page_connections a la fila 8, y la FK compuesta
-- contact_channel_identities -> contacts a la fila 16 (la 14 la toma sola).
--
-- ---------------------------------------------------------------------------
-- ORDEN EN PRODUCCIÓN — NO ES ADITIVA
-- ---------------------------------------------------------------------------
-- El rename rompe la compatibilidad en los DOS sentidos: la imagen vieja
-- escribe y lee phone_number_id/wa_id, y la nueva channel_account_id/
-- external_user_id/channel. No hay un orden sin ventana. Con el orden de
-- siempre (migración y después imagen), durante la ventana:
--
--   - el webhook viejo no puede encolar: la transacción del entrante se
--     revierte entera (Message + job), el error se loguea y el webhook
--     responde 200 igual (un mensaje fallido no tumba el lote), así que Meta
--     NO reintenta: los mensajes que lleguen en esa ventana se pierden.
--   - el worker viejo falla al reclamar; los jobs quedan PENDING y los toma
--     la imagen nueva cuando arranca. Esos no se pierden.
--
-- Por eso: aplicar la migración e inmediatamente desplegar la imagen, en un
-- horario de poco tráfico. Ver la nota de docs/deployment.md §2.2.
-- ---------------------------------------------------------------------------

-- AlterEnum
ALTER TYPE "ConversationChannel" ADD VALUE 'INSTAGRAM';
ALTER TYPE "ConversationChannel" ADD VALUE 'MESSENGER';

-- AlterTable
ALTER TABLE "agents" ADD COLUMN     "facebook_page_id" VARCHAR(64);

-- CreateIndex
CREATE UNIQUE INDEX "agents_facebook_page_id_key" ON "agents"("facebook_page_id");

-- AlterTable — RENAME, no DROP + ADD (punto 3 del encabezado).
ALTER TABLE "agent_inbound_jobs" RENAME COLUMN "phone_number_id" TO "channel_account_id";
ALTER TABLE "agent_inbound_jobs" RENAME COLUMN "wa_id" TO "external_user_id";
ALTER TABLE "agent_inbound_jobs" ADD COLUMN     "channel" "ConversationChannel" NOT NULL DEFAULT 'WHATSAPP';

-- CreateTable
CREATE TABLE "contact_channel_identities" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "channel" "ConversationChannel" NOT NULL,
    "external_id" VARCHAR(128) NOT NULL,
    "contact_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_channel_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meta_page_connections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "page_id" VARCHAR(64) NOT NULL,
    -- Cifrado con AES-256-GCM (src/utils/encryption.ts). NUNCA en claro. Sin
    -- límite de longitud: el ciphertext es base64url y el largo del token lo
    -- decide Meta.
    "page_access_token" TEXT,
    "instagram_business_account_id" VARCHAR(64),
    "status" "ConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "last_error_at" TIMESTAMP(3),
    "last_error_message" VARCHAR(500),
    "connected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meta_page_connections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contact_channel_identities_organization_id_contact_id_idx" ON "contact_channel_identities"("organization_id", "contact_id");

-- CreateIndex
-- El nombre lo trunca Prisma a 63 caracteres (límite de identificadores de
-- Postgres); se deja tal cual para que no aparezca drift.
CREATE UNIQUE INDEX "contact_channel_identities_organization_id_channel_external_key" ON "contact_channel_identities"("organization_id", "channel", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "meta_page_connections_organization_id_key" ON "meta_page_connections"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "meta_page_connections_page_id_key" ON "meta_page_connections"("page_id");

-- CreateIndex
CREATE INDEX "meta_page_connections_instagram_business_account_id_idx" ON "meta_page_connections"("instagram_business_account_id");

-- AddForeignKey
ALTER TABLE "contact_channel_identities" ADD CONSTRAINT "contact_channel_identities_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
-- Compuesta (C-3). NOT NULL -> RESTRICT (regla de 20260821140200).
ALTER TABLE "contact_channel_identities" ADD CONSTRAINT "contact_channel_identities_organization_id_contact_id_fkey" FOREIGN KEY ("organization_id", "contact_id") REFERENCES "contacts"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meta_page_connections" ADD CONSTRAINT "meta_page_connections_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- CHECK: una conexión ACTIVE sin token es imposible. Mismo invariante y mismo
-- motivo que google_calendar_connections_active_requires_token_check: sin
-- esto, un bug en el callback podría dejar una fila que dice estar conectada
-- y no tiene con qué llamar a Meta. REVOKED y ERROR quedan libres: al
-- desconectar el token va a NULL, y ERROR lo conserva a propósito.
-- ---------------------------------------------------------------------------
ALTER TABLE "meta_page_connections" ADD CONSTRAINT "meta_page_connections_active_requires_token_check"
    CHECK ("status" <> 'ACTIVE' OR "page_access_token" IS NOT NULL);

-- ---------------------------------------------------------------------------
-- RLS
--
-- contact_channel_identities: el patrón de aislamiento uniforme de M-5
-- (20260901120000), el mismo que agent_inbound_jobs.
--
-- meta_page_connections: RLS habilitada y CERO políticas — deny-all, igual que
-- google_calendar_connections y api_keys, porque guarda un secreto. Las dos
-- nacen sin grants a anon/authenticated (default privileges de
-- 20260821140100/20260902150000); la RLS es la segunda capa.
-- ---------------------------------------------------------------------------
alter table public.contact_channel_identities enable row level security;
drop policy if exists contact_channel_identities_isolation on public.contact_channel_identities;
create policy contact_channel_identities_isolation on public.contact_channel_identities
  for all
  using (organization_id = current_organization_id())
  with check (organization_id = current_organization_id());

alter table public.meta_page_connections enable row level security;
