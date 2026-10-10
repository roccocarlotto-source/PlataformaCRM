-- ---------------------------------------------------------------------------
-- PR R10 de docs/rubros.md (§15, §4.8, D6): atendido, no vino y el cierre
-- automático de los turnos de clínica.
--
-- TODO ADITIVO Y NULLABLE. No reescribe ninguna fila:
--   - el enum BookingCompletedBy (PERSONA | AUTO);
--   - bookings.completed_at y bookings.completed_by: cuándo y quién cerró el
--     turno (COMPLETED o NO_SHOW). Todas las reservas de hoy quedan en NULL;
--     solo una clínica los escribe.
--   - CHECK bookings_completed_check: los dos juntos o ninguno, y con valor
--     solo en COMPLETED o NO_SHOW. Las filas de hoy (NULL y NULL) lo cumplen
--     en cualquier estado, así que no puede fallar al agregarse.
--   - el índice (status, ends_at) del barrido del cierre automático.
--
-- ORDEN DE DESPLIEGUE: esta migración va ANTES del código. El código viejo no
-- conoce las columnas (Prisma ignora lo que su cliente no conoce).
-- ---------------------------------------------------------------------------

-- CreateEnum
CREATE TYPE "BookingCompletedBy" AS ENUM ('PERSONA', 'AUTO');

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN "completed_at" TIMESTAMP(3),
ADD COLUMN "completed_by" "BookingCompletedBy";

ALTER TABLE "bookings" ADD CONSTRAINT "bookings_completed_check" CHECK (
  (completed_at IS NULL AND completed_by IS NULL)
  OR (completed_at IS NOT NULL AND completed_by IS NOT NULL AND status IN ('COMPLETED', 'NO_SHOW'))
);

-- CreateIndex
CREATE INDEX "bookings_status_ends_at_idx" ON "bookings"("status", "ends_at");
