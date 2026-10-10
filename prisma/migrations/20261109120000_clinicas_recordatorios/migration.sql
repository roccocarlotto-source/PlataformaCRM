-- ---------------------------------------------------------------------------
-- R13 (docs/rubros.md §6): recordatorio de turno con confirmación, solo en
-- clínicas.
--
-- 1. booking_messages: la cola de mensajes de un turno (hoy, el recordatorio).
--    La agenda el consumidor de booking.created / booking.rescheduled (R10) y
--    la manda src/clinicas/recordatorios/recordatorioWorker.ts. Una automotora
--    no tiene filas.
-- 2. bookings.patient_confirmed_at: el paciente tocó "Confirmo". Aditiva y
--    nullable: no es un estado nuevo (CONFIRMED ya es "turno dado").
-- 3. bookings (organization_id, id) UNIQUE: habilita la FK compuesta de
--    booking_messages hacia bookings (C-3). id ya es PK, así que no puede
--    fallar sobre datos existentes. Se crea sin CONCURRENTLY: bloquea las
--    escrituras en bookings mientras se arma (la tabla es chica).
--
-- FKs NOT NULL -> RESTRICT (la regla de 20260821140200). Ninguna se dispara en
-- el uso normal: las reglas y los contactos se borran con soft delete (el
-- borrado de datos personales anonimiza la fila) y los turnos no se borran.
-- Al desactivar o borrar la regla, o al anonimizar el contacto, los
-- recordatorios pendientes se cancelan en la misma transacción.
--
-- Escrita a mano (la shadow database no tiene el schema auth). Las sentencias
-- de tabla, FKs e índices no parciales son las que deriva `prisma migrate
-- diff` del schema; los índices parciales, los CHECK y la RLS son lo que el DSL
-- de Prisma no expresa. Al diagnóstico (docs/auditoria-2026-08-21-
-- diagnostico.sql) entran: la política a la fila 5, los CHECK a la fila 8 y las
-- cuatro FKs a la fila 16.
-- ---------------------------------------------------------------------------

-- CreateEnum
CREATE TYPE "BookingMessageKind" AS ENUM ('REMINDER');

-- CreateEnum
CREATE TYPE "BookingMessageStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BookingMessageResponse" AS ENUM ('CONFIRMAR', 'CANCELAR');

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN "patient_confirmed_at" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "bookings_organization_id_id_key" ON "bookings"("organization_id", "id");

-- CreateTable
CREATE TABLE "booking_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "automation_id" UUID NOT NULL,
    "kind" "BookingMessageKind" NOT NULL,
    "booking_starts_at" TIMESTAMP(3) NOT NULL,
    "scheduled_for" TIMESTAMP(3) NOT NULL,
    "next_attempt_at" TIMESTAMP(3) NOT NULL,
    "status" "BookingMessageStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "sent_at" TIMESTAMP(3),
    "external_message_id" VARCHAR(255),
    "response" "BookingMessageResponse",
    "responded_at" TIMESTAMP(3),
    "response_external_id" VARCHAR(255),
    "no_response_task_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "booking_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "booking_messages_organization_id_booking_id_idx" ON "booking_messages"("organization_id", "booking_id");

-- CreateIndex
CREATE INDEX "booking_messages_organization_id_contact_id_idx" ON "booking_messages"("organization_id", "contact_id");

-- CreateIndex
CREATE INDEX "booking_messages_organization_id_automation_id_idx" ON "booking_messages"("organization_id", "automation_id");

-- AddForeignKey
ALTER TABLE "booking_messages" ADD CONSTRAINT "booking_messages_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_messages" ADD CONSTRAINT "booking_messages_organization_id_booking_id_fkey" FOREIGN KEY ("organization_id", "booking_id") REFERENCES "bookings"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_messages" ADD CONSTRAINT "booking_messages_organization_id_contact_id_fkey" FOREIGN KEY ("organization_id", "contact_id") REFERENCES "contacts"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_messages" ADD CONSTRAINT "booking_messages_organization_id_automation_id_fkey" FOREIGN KEY ("organization_id", "automation_id") REFERENCES "automations"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Lo que el DSL de Prisma no expresa.

-- Un mensaje SENT tiene cuándo salió. El wamid puede faltar (Meta aceptó el
-- envío sin devolverlo): ese recordatorio no se cruza con el botón y sigue el
-- camino de "sin respuesta".
ALTER TABLE "booking_messages" ADD CONSTRAINT "booking_messages_sent_check" CHECK (
  "status" <> 'SENT' OR "sent_at" IS NOT NULL
);

-- La respuesta por botón va entera o no va.
ALTER TABLE "booking_messages" ADD CONSTRAINT "booking_messages_response_check" CHECK (
  ("response" IS NULL AND "responded_at" IS NULL AND "response_external_id" IS NULL)
  OR ("response" IS NOT NULL AND "responded_at" IS NOT NULL AND "response_external_id" IS NOT NULL)
);

-- Un solo recordatorio por turno y por horario mientras esté vigente.
CREATE UNIQUE INDEX "booking_messages_vigente_key" ON "booking_messages"("booking_id", "kind", "booking_starts_at")
  WHERE "status" IN ('PENDING', 'SENT');

-- El cruce de la respuesta del botón (context.id = wamid del envío).
CREATE UNIQUE INDEX "booking_messages_external_message_id_key" ON "booking_messages"("external_message_id")
  WHERE "external_message_id" IS NOT NULL;

-- El reclamo del worker.
CREATE INDEX "booking_messages_claimable_idx" ON "booking_messages"("next_attempt_at")
  WHERE "status" = 'PENDING';

-- La barrida de "sin respuesta" (§6.5).
CREATE INDEX "booking_messages_sin_respuesta_idx" ON "booking_messages"("sent_at")
  WHERE "status" = 'SENT' AND "responded_at" IS NULL AND "no_response_task_at" IS NULL;

-- RLS: la política uniforme de aislamiento (fila 5 del diagnóstico).
alter table public.booking_messages enable row level security;
drop policy if exists booking_messages_isolation on public.booking_messages;
create policy booking_messages_isolation on public.booking_messages
  for all using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());
