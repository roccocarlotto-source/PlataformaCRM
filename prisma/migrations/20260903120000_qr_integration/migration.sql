-- ---------------------------------------------------------------------------
-- Fase 1 de la integración de QR Reviews (docs/qr-integration.md): el módulo
-- QR entra al esquema. Cinco tablas nuevas (qr_codes, qr_payment_events,
-- qr_subscription_status_changes, qr_billing_exemption_changes,
-- platform_admins), tres enums y cuatro columnas en organizations. Cada
-- modelo de prisma/schema.prisma referencia la migración original de
-- Plataforma-QR/supabase/migrations de la que viene y su DEC-XXX.
--
-- CÓMO SE GENERÓ, y por qué no con `prisma migrate dev --create-only` como
-- decía la guía: `migrate dev` replica el historial en una shadow database y
-- 20260821140000 falla ahí con "schema auth does not exist" — la shadow no es
-- un proyecto Supabase. Es la razón por la que todas las migraciones de este
-- repo se escriben a mano. El DDL de abajo salió de
-- `prisma migrate diff --from-url <DIRECT_URL> --to-schema-datamodel` contra
-- la base ya al día con 20260902150000, sin ningún retoque salvo uno: se
-- QUITARON nueve `DROP INDEX *_trgm_idx` que el diff proponía porque los GIN
-- de 20260828120100 no existen en el DSL de Prisma. No son drift: son los
-- objetos manuales de siempre, y la fila 12 del diagnóstico los afirma.
--
-- El bloque final (RLS + CHECK constraints) es manual, mismo criterio que
-- 20260821140000 (C-2) y 20260901120000 (M-5): lo que el DSL no expresa se
-- escribe en la migración versionada, no en prisma/sql/*.sql. Las filas 5, 8,
-- 14 y 16 del diagnóstico afirman en CI la política, los tres CHECK y la FK
-- compuesta de qr_codes -> branches (ON DELETE NO ACTION por la regla de
-- 20260821140200: columna referenciante nullable).
-- ---------------------------------------------------------------------------

-- CreateEnum
CREATE TYPE "QrType" AS ENUM ('REUSABLE', 'SINGLE_USE');

-- CreateEnum
CREATE TYPE "QrSubscriptionStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "QrSubscriptionChangeSource" AS ENUM ('MERCADOPAGO_WEBHOOK', 'PLATFORM_ADMIN');

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "next_qr_display_number" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "qr_billing_exempt" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "qr_mercadopago_subscription_id" TEXT,
ADD COLUMN     "qr_subscription_status" "QrSubscriptionStatus" NOT NULL DEFAULT 'INACTIVE';

-- CreateTable
CREATE TABLE "qr_codes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "branch_id" UUID,
    "display_number" INTEGER,
    "name" VARCHAR(255),
    "message" TEXT,
    "destination_url" TEXT,
    "qr_type" "QrType" NOT NULL DEFAULT 'REUSABLE',
    "used_at" TIMESTAMP(3),
    "claimed_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qr_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qr_payment_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "mercadopago_event_id" TEXT NOT NULL,
    "organization_id" UUID,
    "event_type" TEXT NOT NULL,
    "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qr_payment_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qr_subscription_status_changes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "previous_status" "QrSubscriptionStatus" NOT NULL,
    "new_status" "QrSubscriptionStatus" NOT NULL,
    "source" "QrSubscriptionChangeSource" NOT NULL,
    "changed_by_platform_admin_id" UUID,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qr_subscription_status_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qr_billing_exemption_changes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "previous_value" BOOLEAN NOT NULL,
    "new_value" BOOLEAN NOT NULL,
    "changed_by_platform_admin_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qr_billing_exemption_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_admins" (
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_admins_pkey" PRIMARY KEY ("user_id")
);

-- CreateIndex
CREATE INDEX "qr_codes_organization_id_branch_id_idx" ON "qr_codes"("organization_id", "branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "qr_payment_events_mercadopago_event_id_key" ON "qr_payment_events"("mercadopago_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_qr_mercadopago_subscription_id_key" ON "organizations"("qr_mercadopago_subscription_id");

-- AddForeignKey
ALTER TABLE "qr_codes" ADD CONSTRAINT "qr_codes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qr_codes" ADD CONSTRAINT "qr_codes_organization_id_branch_id_fkey" FOREIGN KEY ("organization_id", "branch_id") REFERENCES "branches"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qr_payment_events" ADD CONSTRAINT "qr_payment_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qr_subscription_status_changes" ADD CONSTRAINT "qr_subscription_status_changes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qr_subscription_status_changes" ADD CONSTRAINT "qr_subscription_status_changes_changed_by_platform_admin_i_fkey" FOREIGN KEY ("changed_by_platform_admin_id") REFERENCES "platform_admins"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qr_billing_exemption_changes" ADD CONSTRAINT "qr_billing_exemption_changes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qr_billing_exemption_changes" ADD CONSTRAINT "qr_billing_exemption_changes_changed_by_platform_admin_id_fkey" FOREIGN KEY ("changed_by_platform_admin_id") REFERENCES "platform_admins"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------
-- RLS — mismo patrón uniforme que el resto (ver
-- prisma/sql/rls_policies.sql y 20260901120000_rls_booking_and_outbox_tables).
-- ---------------------------------------------------------------------
alter table public.qr_codes enable row level security;
drop policy if exists qr_codes_isolation on public.qr_codes;
create policy qr_codes_isolation on public.qr_codes
  for all
  using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());

-- Tablas internas (D7/D8/D9/DEC-060 originales): ningún grant a
-- anon/authenticated, ninguna policy — mismo criterio que el original
-- (payment_events/platform_admins/subscription_status_changes/
-- billing_exemption_changes tampoco la tenían). RLS habilitada igual,
-- por la misma razón que 20260901120000 documenta: defensa en
-- profundidad para el día que algo distinto de Express llegue a public.
alter table public.qr_payment_events enable row level security;
alter table public.qr_subscription_status_changes enable row level security;
alter table public.qr_billing_exemption_changes enable row level security;
alter table public.platform_admins enable row level security;

-- ---------------------------------------------------------------------
-- CHECK constraints — equivalentes exactos de los originales. Los enums
-- se llaman "QrType" / "QrSubscriptionStatus" / "QrSubscriptionChangeSource"
-- (Prisma conserva el nombre del DSL, entre comillas); los literales de
-- abajo se castean solos al tipo de la columna.
-- ---------------------------------------------------------------------

-- Original: qr_codes_name_destination_iff_claimed (0008_qr_own_destination.sql).
-- Un QR Stock (branch_id null) no tiene nombre/destino; uno reclamado, sí.
alter table public.qr_codes
  add constraint qr_codes_name_destination_iff_claimed
  check (
    (branch_id is null and name is null and destination_url is null)
    or
    (branch_id is not null and name is not null and destination_url is not null)
  );

-- Original: qr_codes_used_at_only_single_use (0015_single_use_qr.sql).
-- used_at solo tiene sentido para qr_type = SINGLE_USE.
alter table public.qr_codes
  add constraint qr_codes_used_at_only_single_use
  check (used_at is null or qr_type = 'SINGLE_USE');

-- Original: changed_by_only_for_platform_admin (0001_init.sql, adaptado a
-- QrSubscriptionChangeSource). changed_by_platform_admin_id obligatorio
-- sii source = PLATFORM_ADMIN.
alter table public.qr_subscription_status_changes
  add constraint qr_subscription_status_changes_changed_by_only_for_admin
  check (
    (source = 'PLATFORM_ADMIN' and changed_by_platform_admin_id is not null)
    or
    (source = 'MERCADOPAGO_WEBHOOK' and changed_by_platform_admin_id is null)
  );
