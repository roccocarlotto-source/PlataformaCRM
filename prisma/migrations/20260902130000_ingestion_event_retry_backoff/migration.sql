-- B-30 de docs/auditoria-2026-08-29.md: reintentos con backoff y DEAD_LETTER
-- para la cola de ingesta.
--
-- El problema: una fila con un error de sistema DETERMINISTICO para su
-- contenido se reclamaba, reventaba y se posponia en cada tick, para siempre —
-- una transaccion y un logger.error por tick, sin que nada lo detuviera ni lo
-- señalara. Replica completa del patron que outbox_events ya usa (migracion
-- 20260828150000): contador de intentos, proximo turno con backoff, y un
-- estado terminal para lo que agoto sus reintentos.
--
-- Escrita a mano, no generada por `prisma migrate dev`: mismo motivo que las
-- migraciones de ingesta y outbox (el unico DATABASE_URL disponible apunta al
-- proyecto real y `migrate dev` usa una shadow database y puede proponer un
-- reset). Quien valida que aplica sobre una base vacia es el job `integration`
-- del CI, que reconstruye la base desde cero en cada corrida.

-- ---------------------------------------------------------------------------
-- 1. El valor nuevo del enum
--
-- DEAD_LETTER es distinto de FAILED y la distincion es el corazon del cambio:
-- FAILED significa "este payload nunca va a servir" (dato invalido, terminal
-- desde el primer intento); DEAD_LETTER significa "esto SI podria haber
-- servido, pero agoto sus reintentos contra un error de sistema".
--
-- Postgres prohibe USAR un valor de enum en la misma transaccion que lo
-- agrega (desde PG 12 el ALTER TYPE ... ADD VALUE si puede correr dentro de
-- una transaccion). Esta migracion no lo usa en ningun lado —ni default, ni
-- backfill, ni indice—, asi que el bloque transaccional de `migrate deploy`
-- no lo afecta.
-- ---------------------------------------------------------------------------
ALTER TYPE "IngestionStatus" ADD VALUE 'DEAD_LETTER';

-- ---------------------------------------------------------------------------
-- 2. Las columnas de reintento — espejo de outbox_events
--
-- ADD COLUMN con DEFAULT constante no reescribe la tabla en Postgres moderno
-- (mismo argumento que batch_id en 20260825160000): importa porque
-- ingestion_events es la tabla de mayor volumen del esquema.
--
-- last_error es una columna NUEVA y NO se reutiliza error_message a proposito:
-- error_message significa una sola cosa ya documentada — por que fallo el
-- dato cuando la fila esta en FAILED (payload invalido) — y una fila que se
-- reprograma por error de sistema sigue en PENDING, no en FAILED. Mezclar los
-- dos usos romperia el invariante que el comentario de
-- retryIngestionEventConditional describe (y que markEventProcessed y el
-- propio retry ya limpian).
-- ---------------------------------------------------------------------------
ALTER TABLE "ingestion_events" ADD COLUMN IF NOT EXISTS "attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ingestion_events" ADD COLUMN IF NOT EXISTS "next_attempt_at" TIMESTAMP(3);
ALTER TABLE "ingestion_events" ADD COLUMN IF NOT EXISTS "last_error" TEXT;

-- ---------------------------------------------------------------------------
-- 3. El indice de la cola pasa a la expresion de "reclamable"
--
-- Mismo nombre que el indice original de 20260824120000 (nada lo consume por
-- nombre) pero sobre coalesce(next_attempt_at, created_at), igual que
-- outbox_events_claimable_idx: la condicion de reclamable se escribe con
-- coalesce y no con `next_attempt_at IS NULL OR next_attempt_at <= now()`
-- porque solo la primera la puede servir un indice de RANGO — y la diferencia
-- importa justo cuando importa: con muchas filas pospuestas al futuro y unas
-- pocas vencidas, el OR obligaria a recorrer todas para encontrar esas pocas.
-- coalesce sobre dos timestamp es IMMUTABLE, que es lo que permite indexar la
-- expresion; el casteo del predicado deja la resolucion de tipo fijada en la
-- definicion (los mismos dos puntos que documenta la migracion de outbox).
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS "ingestion_events_pending_created_at_idx";
CREATE INDEX "ingestion_events_pending_created_at_idx"
  ON "ingestion_events" ((coalesce("next_attempt_at", "created_at")))
  WHERE "status" = 'PENDING'::"IngestionStatus";
