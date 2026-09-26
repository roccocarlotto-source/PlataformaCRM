-- ---------------------------------------------------------------------------
-- Ítem 160 de docs/frontend-cambios-pendientes.md (rama
-- feat/plantilla-whatsapp-por-organizacion): la plantilla de seguimiento
-- post-venta la arma cada negocio desde el CRM, en vez de ser una sola para
-- toda la plataforma cargada en dos variables de Render (ítem 159).
--
-- TRES COSAS:
--
-- 1. whatsapp_templates — la plantilla de cada organización: el texto tal
--    cual lo escribió el negocio (con {nombre} y {link}), el nombre e idioma
--    con que se registró en Meta, el id que Meta le dio y el estado de la
--    revisión (PENDING / APPROVED / REJECTED + motivo). Soft delete.
--
-- 2. whatsapp_templates_org_active_unique — a lo sumo UNA activa por
--    organización. El worker manda "la" plantilla de la organización, sin
--    elegir; con dos activas tendría que adivinar. Para cambiarla, se borra
--    la actual. Parcial sobre deleted_at IS NULL: la borrada libera el lugar.
--
-- 3. whatsapp_templates_name_active_unique — el nombre es único en TODA la
--    tabla, no por organización. Todas las organizaciones comparten el mismo
--    WABA de Meta, y ahí el nombre identifica a la plantilla: el mismo nombre
--    en otro idioma no es otra plantilla sino otra traducción de la MISMA, y
--    el DELETE de Meta es por nombre. Sin este UNIQUE, el negocio B podría
--    colgarse de la plantilla del A, y borrar la suya borraría las dos. Es
--    solo el nombre y no (nombre, idioma) justamente por eso. Parcial, igual
--    que el anterior: borrar libera el nombre.
--
-- Escrita a mano, no generada por `prisma migrate dev`: mismo motivo que el
-- resto de las migraciones desde 20260821 (la shadow database no tiene el
-- schema auth). Las sentencias del punto 1 son exactamente lo que `prisma
-- migrate diff` deriva del schema, para que no aparezca drift; los dos
-- índices parciales y la RLS son lo que el DSL de Prisma no expresa.
--
-- Al diagnóstico (docs/auditoria-2026-08-21-diagnostico.sql) entran en este
-- mismo cambio: la política de aislamiento a la fila 5 y los dos índices
-- únicos parciales a la fila 7 (9 -> 11). La FK a organizations no es
-- compuesta —organizations no tiene organization_id— así que ni la fila 14
-- ni la 16 cambian.
--
-- Solo AGREGA: el orden de siempre (migración y después la imagen) sirve, y
-- la imagen vieja contra este esquema no se entera.
-- ---------------------------------------------------------------------------

-- CreateEnum
CREATE TYPE "WhatsappTemplateStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "whatsapp_templates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(512) NOT NULL,
    "language" VARCHAR(20) NOT NULL,
    "body_text" TEXT NOT NULL,
    "meta_template_id" VARCHAR(64),
    "status" "WhatsappTemplateStatus" NOT NULL DEFAULT 'PENDING',
    "rejected_reason" TEXT,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- El webhook message_template_status_update identifica la plantilla por el
-- id de Meta.
CREATE INDEX "whatsapp_templates_meta_template_id_idx" ON "whatsapp_templates"("meta_template_id");

-- CreateIndex
-- El punto 2 del encabezado. Sirve además el EXISTS del reclamo de la cola
-- de seguimientos (claimNextQrFollowUp): "¿esta organización tiene una
-- plantilla activa y aprobada?".
CREATE UNIQUE INDEX "whatsapp_templates_org_active_unique"
  ON "whatsapp_templates" ("organization_id")
  WHERE "deleted_at" IS NULL;

-- CreateIndex
-- El punto 3 del encabezado.
CREATE UNIQUE INDEX "whatsapp_templates_name_active_unique"
  ON "whatsapp_templates" ("name")
  WHERE "deleted_at" IS NULL;

-- AddForeignKey
ALTER TABLE "whatsapp_templates" ADD CONSTRAINT "whatsapp_templates_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- RLS — el patrón de aislamiento uniforme de M-5 (20260901120000), el mismo
-- que qr_follow_ups: `for all` con USING y WITH CHECK sobre
-- current_organization_id(). La tabla nace sin grants a anon/authenticated
-- (default privileges de 20260821140100/20260902150000); la política es la
-- segunda capa.
-- ---------------------------------------------------------------------------
alter table public.whatsapp_templates enable row level security;
drop policy if exists whatsapp_templates_isolation on public.whatsapp_templates;
create policy whatsapp_templates_isolation on public.whatsapp_templates
  for all
  using (organization_id = current_organization_id())
  with check (organization_id = current_organization_id());
