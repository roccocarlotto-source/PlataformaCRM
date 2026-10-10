-- ---------------------------------------------------------------------------
-- PR R5 de docs/rubros.md (§15): varios profesionales por prestación (§4.3).
--
-- ADITIVA: una tabla nueva, sin tocar ninguna existente. ServiceType.resourceId
-- sigue NOT NULL y en una clínica es el "profesional principal"; los
-- profesionales de una prestación son el principal más las filas de esta tabla.
--
-- 1. service_type_resources: (prestación, profesional). PK
--    (service_type_id, resource_id). FKs COMPUESTAS por organización a
--    service_types y resources, con las acciones de la regla C-3 (NOT NULL ->
--    RESTRICT, ON UPDATE CASCADE): las dos tablas usan soft delete, así que el
--    RESTRICT nunca se dispara en la operación normal.
--
-- 2. Relleno: el profesional principal de cada prestación de una organización
--    CLINICA, para que la tabla sea completa desde el primer día. Las
--    automotoras NO tienen filas (su agenda no lee la tabla), y hoy no existe
--    ninguna organización CLINICA en producción (CLINICA_HABILITADA en false),
--    así que el INSERT no escribe nada; queda por si se aplica sobre una base
--    que ya tenga clínicas. Idempotente (ON CONFLICT DO NOTHING).
--
-- RLS con la política uniforme (organization_id = current_organization_id()),
-- mismo molde que clinic_branch_settings (20261101120000). Nace sin grants a
-- anon/authenticated (la fila 18 del diagnóstico lo verifica).
--
-- Escrita a mano a partir de `prisma migrate diff --from-schema-datasource`
-- contra el Supabase local; el relleno y la RLS se agregan a mano. El
-- diagnóstico (docs/auditoria-2026-08-21-diagnostico.sql) la afirma en las
-- filas 5 y 16 en este mismo cambio.
--
-- El nombre ordena DESPUÉS de 20261101120000_clinicas_configuracion, la
-- última, que ya tiene fecha futura: migrate deploy aplica en orden de nombre.
-- ---------------------------------------------------------------------------

-- CreateTable
CREATE TABLE "service_type_resources" (
    "organization_id" UUID NOT NULL,
    "service_type_id" UUID NOT NULL,
    "resource_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_type_resources_pkey" PRIMARY KEY ("service_type_id","resource_id")
);

-- CreateIndex
CREATE INDEX "service_type_resources_organization_id_resource_id_idx" ON "service_type_resources"("organization_id", "resource_id");

-- AddForeignKey
ALTER TABLE "service_type_resources" ADD CONSTRAINT "service_type_resources_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_type_resources" ADD CONSTRAINT "service_type_resources_organization_id_service_type_id_fkey" FOREIGN KEY ("organization_id", "service_type_id") REFERENCES "service_types"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_type_resources" ADD CONSTRAINT "service_type_resources_organization_id_resource_id_fkey" FOREIGN KEY ("organization_id", "resource_id") REFERENCES "resources"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Relleno: el principal de cada prestación de una clínica (hoy, ninguna).
INSERT INTO "service_type_resources" ("organization_id", "service_type_id", "resource_id")
SELECT st."organization_id", st."id", st."resource_id"
FROM "service_types" st
JOIN "organizations" o ON o."id" = st."organization_id"
WHERE o."industry" = 'CLINICA'
  AND st."deleted_at" IS NULL
ON CONFLICT DO NOTHING;

-- Row Level Security: la política uniforme por organización.
alter table public.service_type_resources enable row level security;

drop policy if exists service_type_resources_isolation on public.service_type_resources;
create policy service_type_resources_isolation on public.service_type_resources
  for all
  using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());
