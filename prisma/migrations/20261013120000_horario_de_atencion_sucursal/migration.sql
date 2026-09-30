-- ---------------------------------------------------------------------------
-- Horario de atención propio de la sucursal — G-07 de
-- docs-privados/auditoria-2026-09-30-corta.md (local, no está en GitHub).
--
-- ADITIVA: una tabla nueva, sin tocar ninguna existente ni ningún dato. Una
-- sucursal sin filas acá usa el horario por defecto (lunes a sábado de 9 a
-- 20, src/utils/horarioDeAtencion.ts), así que no hace falta backfill.
--
-- Por ahora la usa SOLO la ventana de envío de los mensajes que inicia el
-- negocio (seguimiento con QR y cupón de descuento). Las respuestas del
-- agente a mensajes entrantes no la miran.
--
-- ES EL CALCO DE working_hours (20260830120000) a propósito: mismo enum
-- "Weekday", minutos LOCALES de la sucursal (branches.timezone) en 0..1440 con
-- el mismo CHECK, una fila por franja, FK compuesta por organización y la
-- misma política de aislamiento que 20260901120000 le puso a working_hours.
-- Una sola forma de expresar un horario en todo el sistema.
--
-- Generada contra el Supabase local con `prisma migrate diff`; el CHECK y la
-- RLS se agregan a mano (Prisma no los expresa). El diagnóstico
-- (docs/auditoria-2026-08-21-diagnostico.sql) los afirma en las filas 5, 8 y
-- 15 en este mismo cambio.
-- ---------------------------------------------------------------------------

-- CreateTable
CREATE TABLE "branch_business_hours" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "weekday" "Weekday" NOT NULL,
    "start_minute" INTEGER NOT NULL,
    "end_minute" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "branch_business_hours_pkey" PRIMARY KEY ("id"),
    -- El mismo CHECK que working_hours_minute_range_check.
    CONSTRAINT "branch_business_hours_minute_range_check"
        CHECK (start_minute >= 0 AND end_minute <= 1440 AND start_minute < end_minute)
);

-- CreateIndex
CREATE INDEX "branch_business_hours_organization_id_branch_id_idx" ON "branch_business_hours"("organization_id", "branch_id");

-- AddForeignKey
ALTER TABLE "branch_business_hours" ADD CONSTRAINT "branch_business_hours_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_business_hours" ADD CONSTRAINT "branch_business_hours_organization_id_branch_id_fkey" FOREIGN KEY ("organization_id", "branch_id") REFERENCES "branches"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS: misma política de aislamiento que working_hours (20260901120000).
alter table public.branch_business_hours enable row level security;
drop policy if exists branch_business_hours_isolation on public.branch_business_hours;
create policy branch_business_hours_isolation on public.branch_business_hours
  for all
  using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());
