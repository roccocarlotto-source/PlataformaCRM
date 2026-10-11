-- ---------------------------------------------------------------------------
-- R14 (docs/rubros.md §7): el QR de reseña y el control después de un turno
-- atendido, solo en clínicas.
--
-- 1. Dos valores nuevos de BookingMessageKind (la cola de R13). ALTER TYPE ...
--    ADD VALUE corre dentro de la transacción de la migración (Postgres 12+),
--    pero el valor nuevo no se puede USAR en esa misma transacción: esta
--    migración no lo usa (ni un INSERT, ni un DEFAULT, ni un CHECK lo nombran).
-- 2. service_types.follow_up_after_days: "Recordar control a los N días".
--    Nullable (null = sin control), 1 a 730. Columna nueva sin default: no
--    reescribe la tabla.
--
-- Al diagnóstico (docs/auditoria-2026-08-21-diagnostico.sql) entra el CHECK a
-- la fila 8.
-- ---------------------------------------------------------------------------

-- AlterEnum
ALTER TYPE "BookingMessageKind" ADD VALUE 'REVIEW_QR';
ALTER TYPE "BookingMessageKind" ADD VALUE 'CONTROL';

-- AlterTable
ALTER TABLE "service_types" ADD COLUMN "follow_up_after_days" INTEGER;

ALTER TABLE "service_types" ADD CONSTRAINT "service_types_follow_up_after_days_check" CHECK (
  "follow_up_after_days" IS NULL OR ("follow_up_after_days" >= 1 AND "follow_up_after_days" <= 730)
);
