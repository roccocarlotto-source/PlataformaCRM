-- ---------------------------------------------------------------------------
-- PR R6 de docs/rubros.md (§15, §4.4, §4.5, D9): bloqueos y sobreturnos de los
-- profesionales de una clínica.
--
-- TODO ADITIVO. No reescribe ninguna fila existente:
--   - resource_time_offs: tabla nueva y vacía. Solo la escriben las rutas de
--     agenda_clinica, así que una automotora nunca tiene filas.
--   - resources.allows_overbooking (default false) y
--     resources.max_overbookings_per_day (default 1, CHECK >= 1): con false,
--     la disponibilidad y la reserva son las de antes.
--   - bookings.is_overbooking (default false): todas las reservas de hoy son
--     turnos normales.
--
-- Las tres columnas NOT NULL con default constante son solo metadata en
-- Postgres 11+: no reescriben la tabla.
--
-- ORDEN DE DESPLIEGUE: esta migración va ANTES del código. El código viejo no
-- conoce la tabla ni las columnas (Prisma ignora una columna que su cliente no
-- conoce, y los defaults cubren sus INSERT); el código nuevo las lee.
-- ---------------------------------------------------------------------------

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN "is_overbooking" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "resources" ADD COLUMN "allows_overbooking" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "max_overbookings_per_day" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "resources" ADD CONSTRAINT "resources_max_overbookings_per_day_check"
  CHECK (max_overbookings_per_day >= 1);

-- CreateTable
CREATE TABLE "resource_time_offs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "resource_id" UUID NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "reason" VARCHAR(200),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resource_time_offs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "resource_time_offs_time_range_check" CHECK (starts_at < ends_at)
);

-- CreateIndex
CREATE INDEX "resource_time_offs_organization_id_resource_id_starts_at_idx" ON "resource_time_offs"("organization_id", "resource_id", "starts_at");

-- AddForeignKey
ALTER TABLE "resource_time_offs" ADD CONSTRAINT "resource_time_offs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_time_offs" ADD CONSTRAINT "resource_time_offs_organization_id_resource_id_fkey" FOREIGN KEY ("organization_id", "resource_id") REFERENCES "resources"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS: la política uniforme de aislamiento (fila 5 del diagnóstico).
alter table public.resource_time_offs enable row level security;
drop policy if exists resource_time_offs_isolation on public.resource_time_offs;
create policy resource_time_offs_isolation on public.resource_time_offs
  for all using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());
