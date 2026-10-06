-- ---------------------------------------------------------------------------
-- Campos personalizados de contactos, v1 (B6, 06/10/2026):
-- contact_custom_field_definitions.
--
-- Las DEFINICIONES de los campos de cada organización (etiqueta, tipo,
-- opciones de una lista, si el agente de IA puede escribirlo). Los VALORES
-- siguen en contacts.custom_fields (jsonb, ya existía) como { key: valor } y
-- se validan contra estas filas en el backend (utils/camposPersonalizados.ts).
-- Hasta 30 por organización: lo cuenta el service, no la base.
--
-- UNIQUE (organization_id, key) incluidas las borradas (soft delete): volver
-- a crear un campo con la misma key restaura la fila borrada en vez de dejar
-- dos definiciones para el mismo dato. Sin CHECK ni índice parcial a
-- propósito: cada uno entra en los contadores de verify:schema.
--
-- RLS con la política uniforme (organization_id = current_organization_id()),
-- mismo molde que qr_follow_ups (20261002120000). Nace sin grants a
-- anon/authenticated: la fila 18 del diagnóstico lo verifica.
--
-- Escrita a mano, no generada por `prisma migrate dev`: mismo motivo que el
-- resto de las migraciones desde 20260821 (la shadow database no tiene el
-- schema auth). La valida el job `integration` del CI.
-- ---------------------------------------------------------------------------

-- CreateEnum
CREATE TYPE "ContactCustomFieldType" AS ENUM ('TEXT', 'NUMBER', 'DATE', 'BOOLEAN', 'SELECT');

-- CreateTable
CREATE TABLE "contact_custom_field_definitions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "key" VARCHAR(60) NOT NULL,
    "label" VARCHAR(100) NOT NULL,
    "type" "ContactCustomFieldType" NOT NULL,
    "options" JSONB NOT NULL DEFAULT '[]',
    "agent_editable" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "contact_custom_field_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contact_custom_field_definitions_organization_id_key_key" ON "contact_custom_field_definitions"("organization_id", "key");
CREATE INDEX "contact_custom_field_definitions_organization_id_created_at_idx" ON "contact_custom_field_definitions"("organization_id", "created_at");

-- AddForeignKey
ALTER TABLE "contact_custom_field_definitions" ADD CONSTRAINT "contact_custom_field_definitions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Row Level Security: la política uniforme por organización.
alter table public.contact_custom_field_definitions enable row level security;

drop policy if exists contact_custom_field_definitions_isolation on public.contact_custom_field_definitions;
create policy contact_custom_field_definitions_isolation on public.contact_custom_field_definitions
  for all
  using (organization_id = current_organization_id())
  with check (organization_id = current_organization_id());
