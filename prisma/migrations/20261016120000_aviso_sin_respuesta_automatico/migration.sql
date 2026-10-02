-- ---------------------------------------------------------------------------
-- Aviso automático si nadie responde a una derivación.
--
-- Si una conversación queda derivada (TRANSFERRED_TO_HUMAN) y ninguna persona
-- le escribe al cliente en X minutos, sale solo el aviso de "no hay nadie
-- disponible" y la conversación vuelve al agente, igual que con "Devolver al
-- agente" (src/workers/avisoSinRespuestaWorker.ts).
--
-- 1. agents.unanswered_handoff_notice_minutes: el X de cada agente. NULL o 0 =
--    desactivado. DEFAULT 15 también para los agentes existentes: es el
--    comportamiento pedido por defecto.
--
-- 2. conversations.transferred_to_human_at: cuándo la derivó el agente por
--    última vez (lo escribe el CAS de transferConversationToHuman). Las que
--    ya estaban derivadas quedan en NULL y NO reciben el aviso automático: no
--    se sabe desde cuándo esperan, y avisarles a todas juntas al deployar
--    sería peor que no hacerlo.
--
-- Solo agrega columnas nullable y un índice: no reescribe filas existentes
-- más allá del DEFAULT de la columna nueva.
-- ---------------------------------------------------------------------------

-- AlterTable
ALTER TABLE "agents" ADD COLUMN     "unanswered_handoff_notice_minutes" INTEGER DEFAULT 15;

ALTER TABLE "agents" ADD CONSTRAINT "agents_unanswered_handoff_notice_minutes_range"
  CHECK ("unanswered_handoff_notice_minutes" IS NULL OR "unanswered_handoff_notice_minutes" BETWEEN 0 AND 1440);

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "transferred_to_human_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "conversations_status_transferred_to_human_at_idx" ON "conversations"("status", "transferred_to_human_at");
