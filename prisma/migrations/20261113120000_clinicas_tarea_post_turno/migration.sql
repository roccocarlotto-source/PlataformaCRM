-- ---------------------------------------------------------------------------
-- La tarea después del turno de una clínica (docs/rubros.md §7.3): la acción
-- activity.create_follow_up sobre booking.completed.
--
-- activities.source_booking_id y source_automation_id: el turno y la regla que
-- crearon la tarea. Nullable y sin default: no reescriben la tabla. Las FK son
-- compuestas con organization_id (la misma organización), como las demás de
-- activities. Una automotora nunca las escribe.
--
-- activities_follow_up_por_turno_key: una sola tarea por regla y por turno.
-- Cada corrección de "No vino" a "Atendido" emite otro booking.completed (otro
-- evento del outbox), y la idempotencia del dispatcher es por evento: este
-- índice es la garantía por turno.
--
-- Al diagnóstico (docs/auditoria-2026-08-21-diagnostico.sql) entran el índice
-- (fila 7) y las dos FK (inventario de FKs compuestas).
-- ---------------------------------------------------------------------------

-- AlterTable
ALTER TABLE "activities" ADD COLUMN "source_booking_id" UUID,
ADD COLUMN "source_automation_id" UUID;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_organization_id_source_booking_id_fkey" FOREIGN KEY ("organization_id", "source_booking_id") REFERENCES "bookings"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_organization_id_source_automation_id_fkey" FOREIGN KEY ("organization_id", "source_automation_id") REFERENCES "automations"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- Una tarea por regla y por turno.
CREATE UNIQUE INDEX "activities_follow_up_por_turno_key" ON "activities"("source_automation_id", "source_booking_id")
  WHERE "source_booking_id" IS NOT NULL;
