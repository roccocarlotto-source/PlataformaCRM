-- ---------------------------------------------------------------------------
-- Origen MESSENGER e INSTAGRAM en OpportunityLeadSource (B2, 06/10/2026).
--
-- Las oportunidades que crea el agente por Messenger o Instagram quedaban sin
-- origen: ORIGEN_POR_CANAL (agentTools.service.ts) solo tenía WEB y WHATSAPP
-- porque el enum no tenía valor para los canales de Meta. Dos valores
-- aditivos, mismo molde que OTHER en 20260911120000: sin reescritura de
-- tabla, sin backfill (ninguna fila puede tenerlos todavía) y sin usarlos en
-- esta misma transacción (Postgres prohíbe usar un valor de enum en la
-- transacción que lo agrega).
--
-- Escrita a mano, no generada por `prisma migrate dev`: mismo motivo que el
-- resto de las migraciones desde 20260821 (la shadow database no tiene el
-- schema auth). La valida el job `integration` del CI, que reconstruye la
-- base desde cero.
--
-- Los contactos ("leads") no cambian: Contact.source es texto libre y los
-- de Messenger e Instagram ya lo traen (META_CONTACT_SOURCE en
-- metaContact.service.ts).
-- ---------------------------------------------------------------------------

-- AlterEnum
ALTER TYPE "OpportunityLeadSource" ADD VALUE IF NOT EXISTS 'MESSENGER';
ALTER TYPE "OpportunityLeadSource" ADD VALUE IF NOT EXISTS 'INSTAGRAM';
