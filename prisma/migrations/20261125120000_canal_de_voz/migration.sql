-- ---------------------------------------------------------------------------
-- Canal de voz: lo que necesita una llamada para quedar en el CRM.
--
--   - VOICE en ConversationChannel: la llamada como conversación.
--   - PHONE en OpportunityLeadSource: el origen de la oportunidad que crea el
--     agente durante una llamada.
--   - branches.transfer_phone: a qué número pasa el agente una llamada cuando
--     el cliente pide una persona. Opcional, por sucursal.
--
-- Todo aditivo, mismo molde que 20261022120000: sin reescritura de tabla, sin
-- backfill (ninguna fila puede tener estos valores todavía) y sin usar los
-- valores nuevos en esta misma transacción (Postgres lo prohíbe). Agregar una
-- columna NULL sin default no reescribe la tabla.
--
-- Escrita a mano, no generada por `prisma migrate dev`: mismo motivo que el
-- resto de las migraciones desde 20260821 (la shadow database no tiene el
-- schema auth). La valida el job `integration` del CI, que reconstruye la
-- base desde cero.
-- ---------------------------------------------------------------------------

-- AlterEnum
ALTER TYPE "ConversationChannel" ADD VALUE IF NOT EXISTS 'VOICE';

-- AlterEnum
ALTER TYPE "OpportunityLeadSource" ADD VALUE IF NOT EXISTS 'PHONE';

-- AlterTable
ALTER TABLE "branches" ADD COLUMN "transfer_phone" VARCHAR(30);
