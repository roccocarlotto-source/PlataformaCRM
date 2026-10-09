-- ---------------------------------------------------------------------------
-- PR R3 de docs/rubros.md (§15): la configuración de una clínica (§1.3).
--
-- ADITIVA: dos enums y dos tablas nuevas, sin tocar ninguna tabla existente ni
-- ningún dato. Sin backfill: las automotoras no tienen filas, y una clínica sin
-- fila usa los defaults (el código no depende de que la fila exista).
--
-- 1. clinic_settings, 1:1 con la organización (organization_id es la clave):
--    el término del contacto (§3) y el aviso de privacidad (§8, lo usa R16).
--    La crea el alta de una organización CLINICA, o el cambio de rubro a
--    CLINICA. FK a organizations con ON DELETE CASCADE: es configuración, sin
--    datos de negocio; una organización solo se borra de verdad en los tests.
--
-- 2. clinic_branch_settings, 1:1 con la sucursal (branch_id es la clave): los
--    parámetros de recordatorios (§6.2, D8) y la anticipación mínima para
--    cambiar un turno (§5.1, D10). Los usan R13 y R11; R3 solo los guarda. La
--    crea el alta de una sucursal de una clínica. FK COMPUESTA a branches por
--    (organization_id, branch_id), con las acciones de la regla C-3 (NOT NULL
--    -> RESTRICT, ON UPDATE CASCADE). Los dos CHECK acotan las horas.
--
-- RLS con la política uniforme (organization_id = current_organization_id()),
-- mismo molde que contact_custom_field_definitions (20261024120000). Nacen sin
-- grants a anon/authenticated (la fila 18 del diagnóstico lo verifica).
--
-- Escrita a mano a partir de `prisma migrate diff --from-schema-datasource`
-- contra el Supabase local; los CHECK y la RLS se agregan a mano (Prisma no
-- los expresa). El diagnóstico (docs/auditoria-2026-08-21-diagnostico.sql)
-- los afirma en las filas 5, 8 y 16 en este mismo cambio.
--
-- El nombre ordena DESPUÉS de 20261031120000_rubros_columna_industry, la
-- última, que ya tiene fecha futura: migrate deploy aplica en orden de nombre.
-- ---------------------------------------------------------------------------

-- CreateEnum
CREATE TYPE "ContactTerm" AS ENUM ('PACIENTE', 'CLIENTE');

-- CreateEnum
CREATE TYPE "LateBookingReminder" AS ENUM ('NO_ENVIAR', 'EN_EL_MOMENTO', 'HORAS_ANTES');

-- CreateTable
CREATE TABLE "clinic_settings" (
    "organization_id" UUID NOT NULL,
    "contact_term" "ContactTerm" NOT NULL DEFAULT 'PACIENTE',
    "privacy_notice_text" VARCHAR(1000),
    "privacy_policy_url" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clinic_settings_pkey" PRIMARY KEY ("organization_id")
);

-- CreateTable
CREATE TABLE "clinic_branch_settings" (
    "branch_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "reminder_hours_before" INTEGER NOT NULL DEFAULT 24,
    "late_booking_reminder" "LateBookingReminder" NOT NULL DEFAULT 'NO_ENVIAR',
    "late_booking_hours_before" INTEGER NOT NULL DEFAULT 2,
    "no_response_task_hours" INTEGER NOT NULL DEFAULT 4,
    "min_hours_to_change_booking" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clinic_branch_settings_pkey" PRIMARY KEY ("branch_id"),
    CONSTRAINT "clinic_branch_settings_reminder_hours_before_check"
        CHECK (reminder_hours_before >= 1 AND reminder_hours_before <= 72),
    CONSTRAINT "clinic_branch_settings_late_booking_hours_before_check"
        CHECK (late_booking_hours_before >= 1 AND late_booking_hours_before <= 23)
);

-- AddForeignKey
ALTER TABLE "clinic_settings" ADD CONSTRAINT "clinic_settings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_branch_settings" ADD CONSTRAINT "clinic_branch_settings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_branch_settings" ADD CONSTRAINT "clinic_branch_settings_organization_id_branch_id_fkey" FOREIGN KEY ("organization_id", "branch_id") REFERENCES "branches"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Row Level Security: la política uniforme por organización.
alter table public.clinic_settings enable row level security;

drop policy if exists clinic_settings_isolation on public.clinic_settings;
create policy clinic_settings_isolation on public.clinic_settings
  for all
  using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());

alter table public.clinic_branch_settings enable row level security;

drop policy if exists clinic_branch_settings_isolation on public.clinic_branch_settings;
create policy clinic_branch_settings_isolation on public.clinic_branch_settings
  for all
  using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());
