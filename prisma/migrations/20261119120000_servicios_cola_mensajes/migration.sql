-- ---------------------------------------------------------------------------
-- S6 de docs/servicios.md (§6.3): el registro de avisos y la cola de mensajes
-- del módulo Servicios.
--
-- TODO ADITIVO E INERTE. Dos tablas nuevas, vacías, tres enums y dos columnas
-- nullable en activities. Nadie las lee ni las escribe hasta S7 (el
-- recordatorio del próximo service): aplicada antes que el código, no cambia
-- nada para ninguna organización.
--
--   customer_vehicle_notices  un aviso dado sobre un vehículo (próximo service
--                             o recambio): lo que hace idempotentes los
--                             barridos de S7 y S13
--   service_messages          la cola de mensajes del módulo, con el patrón de
--                             booking_messages (reclamar, reintentar, cancelar)
--   activities.source_notice_id         la tarea que originó un aviso (S7)
--   activities.source_service_order_id  la tarea que originó una orden (S8)
--
-- activities: ADD COLUMN nullable y sin default, no reescribe la tabla. Los
-- dos índices únicos parciales de activities se crean sin CONCURRENTLY (la
-- migración corre en una transacción): bloquean las escrituras en activities
-- mientras se arman, y como las columnas son nuevas y todas NULL, el índice
-- parcial queda vacío y se arma enseguida.
--
-- FKs: compuestas (organization_id, x_id) -> padre(organization_id, id), con
-- la regla de 20260821140200: columna NOT NULL -> RESTRICT, nullable -> NO
-- ACTION, ON UPDATE CASCADE. Ninguna se dispara en el uso normal: reglas,
-- contactos, usuarios y sucursales usan soft delete, y vehículos, órdenes y
-- avisos no se borran. Las de nombre largo llevan uno corto (Postgres trunca a
-- 63 sin aviso).
--
-- customer_vehicle_notices NO tiene FK a contacts (el contacto sale del
-- vehículo). service_messages.contact_id sí: entra al inventario de
-- contactMerge (unir contactos la mueve al que queda).
--
-- Escrita a mano (la shadow database no tiene el schema auth). Las sentencias
-- de tabla, FKs e índices no parciales son las que deriva `prisma migrate
-- diff` del schema; los índices parciales, los CHECK y la RLS son lo que el DSL
-- de Prisma no expresa. Al diagnóstico (docs/auditoria-2026-08-21-
-- diagnostico.sql) entran: las dos políticas a la fila 5, los únicos parciales
-- a la fila 7, los CHECK a la fila 8 y las FKs al inventario de FKs compuestas.
--
-- ROLLBACK (en una transacción; las tablas están vacías hasta S7):
--   DROP INDEX IF EXISTS "activities_tarea_por_orden_key";
--   DROP INDEX IF EXISTS "activities_tarea_por_aviso_key";
--   ALTER TABLE "activities" DROP CONSTRAINT IF EXISTS "activities_source_service_order_fkey";
--   ALTER TABLE "activities" DROP CONSTRAINT IF EXISTS "activities_source_notice_fkey";
--   ALTER TABLE "activities" DROP COLUMN IF EXISTS "source_service_order_id";
--   ALTER TABLE "activities" DROP COLUMN IF EXISTS "source_notice_id";
--   DROP TABLE IF EXISTS "service_messages";
--   DROP TABLE IF EXISTS "customer_vehicle_notices";
--   DROP TYPE IF EXISTS "ServiceMessageKind";
--   DROP TYPE IF EXISTS "CustomerVehicleNoticeSource";
--   DROP TYPE IF EXISTS "CustomerVehicleNoticeKind";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261119120000_servicios_cola_mensajes';
-- ---------------------------------------------------------------------------

-- CreateEnum
CREATE TYPE "CustomerVehicleNoticeKind" AS ENUM ('NEXT_SERVICE', 'REPLACEMENT');

-- CreateEnum
CREATE TYPE "CustomerVehicleNoticeSource" AS ENUM ('AUTOMATICO', 'MANUAL');

-- CreateEnum
CREATE TYPE "ServiceMessageKind" AS ENUM ('NEXT_SERVICE');

-- AlterTable
ALTER TABLE "activities" ADD COLUMN     "source_notice_id" UUID,
ADD COLUMN     "source_service_order_id" UUID;

-- CreateTable
CREATE TABLE "customer_vehicle_notices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "customer_vehicle_id" UUID NOT NULL,
    "kind" "CustomerVehicleNoticeKind" NOT NULL,
    "due_on" DATE NOT NULL,
    "source" "CustomerVehicleNoticeSource" NOT NULL,
    "automation_id" UUID,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_vehicle_notices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "kind" "ServiceMessageKind" NOT NULL,
    "automation_id" UUID NOT NULL,
    "notice_id" UUID,
    "customer_vehicle_id" UUID,
    "service_order_id" UUID,
    "contact_id" UUID NOT NULL,
    "branch_id" UUID,
    "due_key" DATE,
    "scheduled_for" TIMESTAMP(3) NOT NULL,
    "next_attempt_at" TIMESTAMP(3) NOT NULL,
    "status" "BookingMessageStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" VARCHAR(500),
    "cancel_reason" VARCHAR(200),
    "sent_at" TIMESTAMP(3),
    "external_message_id" VARCHAR(255),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cv_notices_vehicle_idx" ON "customer_vehicle_notices"("organization_id", "customer_vehicle_id");

-- CreateIndex
CREATE INDEX "cv_notices_automation_idx" ON "customer_vehicle_notices"("organization_id", "automation_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_vehicle_notices_organization_id_id_key" ON "customer_vehicle_notices"("organization_id", "id");

-- CreateIndex
CREATE INDEX "service_messages_organization_id_contact_id_idx" ON "service_messages"("organization_id", "contact_id");

-- CreateIndex
CREATE INDEX "service_messages_organization_id_automation_id_idx" ON "service_messages"("organization_id", "automation_id");

-- CreateIndex
CREATE INDEX "service_messages_organization_id_customer_vehicle_id_idx" ON "service_messages"("organization_id", "customer_vehicle_id");

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_source_notice_fkey" FOREIGN KEY ("organization_id", "source_notice_id") REFERENCES "customer_vehicle_notices"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_source_service_order_fkey" FOREIGN KEY ("organization_id", "source_service_order_id") REFERENCES "service_orders"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_vehicle_notices" ADD CONSTRAINT "customer_vehicle_notices_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_vehicle_notices" ADD CONSTRAINT "cv_notices_vehicle_fkey" FOREIGN KEY ("organization_id", "customer_vehicle_id") REFERENCES "customer_vehicles"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_vehicle_notices" ADD CONSTRAINT "cv_notices_automation_fkey" FOREIGN KEY ("organization_id", "automation_id") REFERENCES "automations"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_vehicle_notices" ADD CONSTRAINT "cv_notices_created_by_fkey" FOREIGN KEY ("organization_id", "created_by_id") REFERENCES "users"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_messages" ADD CONSTRAINT "service_messages_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_messages" ADD CONSTRAINT "service_messages_organization_id_automation_id_fkey" FOREIGN KEY ("organization_id", "automation_id") REFERENCES "automations"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_messages" ADD CONSTRAINT "service_messages_organization_id_notice_id_fkey" FOREIGN KEY ("organization_id", "notice_id") REFERENCES "customer_vehicle_notices"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_messages" ADD CONSTRAINT "service_messages_organization_id_customer_vehicle_id_fkey" FOREIGN KEY ("organization_id", "customer_vehicle_id") REFERENCES "customer_vehicles"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_messages" ADD CONSTRAINT "service_messages_organization_id_service_order_id_fkey" FOREIGN KEY ("organization_id", "service_order_id") REFERENCES "service_orders"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_messages" ADD CONSTRAINT "service_messages_organization_id_contact_id_fkey" FOREIGN KEY ("organization_id", "contact_id") REFERENCES "contacts"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_messages" ADD CONSTRAINT "service_messages_organization_id_branch_id_fkey" FOREIGN KEY ("organization_id", "branch_id") REFERENCES "branches"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;


-- Lo que el DSL de Prisma no expresa.

-- Un aviso AUTOMATICO lleva la regla y no el usuario; uno MANUAL ("contactado",
-- §7.4), el usuario y no la regla.
ALTER TABLE "customer_vehicle_notices" ADD CONSTRAINT "cv_notices_source_check" CHECK (
  ("source" = 'AUTOMATICO' AND "automation_id" IS NOT NULL AND "created_by_id" IS NULL)
  OR ("source" = 'MANUAL' AND "automation_id" IS NULL AND "created_by_id" IS NOT NULL)
);

-- Un aviso por (regla, vehículo, tipo, fecha): un barrido repetido no duplica.
CREATE UNIQUE INDEX "cv_notices_automatico_key" ON "customer_vehicle_notices"("automation_id", "customer_vehicle_id", "kind", "due_on")
  WHERE "source" = 'AUTOMATICO';

-- Una marca manual por (vehículo, tipo, fecha).
CREATE UNIQUE INDEX "cv_notices_manual_key" ON "customer_vehicle_notices"("customer_vehicle_id", "kind", "due_on")
  WHERE "source" = 'MANUAL';

-- Un recordatorio del próximo service sale de un aviso, para un vehículo y una
-- fecha (la que se revalida antes de enviar).
ALTER TABLE "service_messages" ADD CONSTRAINT "service_messages_kind_check" CHECK (
  "kind" <> 'NEXT_SERVICE'
  OR ("notice_id" IS NOT NULL AND "customer_vehicle_id" IS NOT NULL AND "due_key" IS NOT NULL)
);

ALTER TABLE "service_messages" ADD CONSTRAINT "service_messages_sent_check" CHECK (
  "status" <> 'SENT' OR "sent_at" IS NOT NULL
);

-- Cancelar siempre dice por qué (§6.3: la revalidación antes de enviar).
ALTER TABLE "service_messages" ADD CONSTRAINT "service_messages_cancel_check" CHECK (
  "status" <> 'CANCELLED' OR "cancel_reason" IS NOT NULL
);

ALTER TABLE "service_messages" ADD CONSTRAINT "service_messages_attempts_check" CHECK (
  "attempts" >= 0
);

-- Un mensaje vigente por aviso: lo enviado no se reenvía y una reentrega del
-- evento no duplica.
CREATE UNIQUE INDEX "service_messages_vigente_key" ON "service_messages"("notice_id")
  WHERE "status" IN ('PENDING', 'SENT');

CREATE UNIQUE INDEX "service_messages_external_message_id_key" ON "service_messages"("external_message_id")
  WHERE "external_message_id" IS NOT NULL;

-- El reclamo del worker.
CREATE INDEX "service_messages_claimable_idx" ON "service_messages"("next_attempt_at")
  WHERE "status" = 'PENDING';

-- Una sola tarea por aviso (§6.3), y una por regla y orden (§8).
CREATE UNIQUE INDEX "activities_tarea_por_aviso_key" ON "activities"("source_notice_id")
  WHERE "source_notice_id" IS NOT NULL;

CREATE UNIQUE INDEX "activities_tarea_por_orden_key" ON "activities"("source_automation_id", "source_service_order_id")
  WHERE "source_service_order_id" IS NOT NULL;

-- RLS: la política uniforme de aislamiento (fila 5 del diagnóstico).
alter table public.customer_vehicle_notices enable row level security;
drop policy if exists customer_vehicle_notices_isolation on public.customer_vehicle_notices;
create policy customer_vehicle_notices_isolation on public.customer_vehicle_notices
  for all using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());

alter table public.service_messages enable row level security;
drop policy if exists service_messages_isolation on public.service_messages;
create policy service_messages_isolation on public.service_messages
  for all using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());
