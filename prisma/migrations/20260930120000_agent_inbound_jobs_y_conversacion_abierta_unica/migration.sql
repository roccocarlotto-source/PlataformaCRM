-- ---------------------------------------------------------------------------
-- Ítems 125 y 126 de docs/auditoria-2026-09-24-punta-a-punta.md (rama
-- audit/punta-a-punta-2026-09-24): la cola del webhook de WhatsApp y la
-- unicidad de la conversación abierta.
--
-- CUATRO COSAS:
--
-- 1. agent_inbound_jobs (ítem 125: D-01, B-02, B-08) — la cola persistente
--    del webhook de WhatsApp. El webhook persiste el Message entrante y un job
--    en la MISMA transacción, y responde 200 en milisegundos; el turno del
--    agente lo corre src/workers/agentInboundWorker.ts con reintentos. Antes
--    el turno corría dentro del request y cualquier falla después de
--    persistir el entrante dejaba al cliente sin respuesta para siempre (la
--    reentrega de Meta caía en el dedup por wamid).
--
-- 2. messages.delivery_status / delivery_error (ítem 125: B-02) — que un
--    envío fallido por la Graph API quede en la fila del Message, no solo en
--    los logs. Nullable y sin backfill: NULL es "no se manda por un canal
--    externo", y eso describe bien a todo mensaje anterior a este cambio.
--
-- 3. messages (organization_id, id) UNIQUE — el que habilita las FKs
--    compuestas de agent_inbound_jobs (C-3), mismo criterio que
--    conversations.
--
-- 4. conversations_open_unique (ítem 126: B-03, C-01) — a lo sumo UNA
--    conversación abierta (ACTIVE o TRANSFERRED_TO_HUMAN, exactamente el
--    filtro de findOpenConversation) por (organización, agente, contacto,
--    canal). Es la barrera de datos detrás del lock por conversación: dos
--    webhooks del mismo contacto nuevo que buscan-o-crean en paralelo ya no
--    pueden dejar dos abiertas; el segundo INSERT choca (P2002) y el código
--    relee la que ganó (findOrCreateOpenConversation).
--
-- ANTES DEL ÍNDICE, UNA CORRECCIÓN DE DATOS: sin ella, la creación del índice
-- falla en cualquier base donde B-03 ya haya dejado duplicados. De cada grupo
-- con más de una abierta queda abierta la que tiene el último mensaje más
-- reciente (NULLS LAST: la conversación vacía que deja una reentrega paralela
-- —el caso de C-01— pierde contra la que tiene el hilo), y el resto pasa a
-- CLOSED. No se borra nada: una CLOSED es historia que se conserva, sus
-- mensajes siguen en la bandeja, y el próximo mensaje del contacto cae en la
-- que quedó abierta, que es a la que ya caía (findOpenConversation ordenaba
-- por created_at desc, así que tomaba la más nueva — muchas veces la vacía).
--
-- Escrita a mano, no generada por `prisma migrate dev`: mismo motivo que el
-- resto de las migraciones desde 20260821 (la shadow database no tiene el
-- schema auth). Las sentencias de los puntos 1 a 3 son exactamente lo que
-- `prisma migrate diff` deriva del schema, para que no aparezca drift; los
-- dos índices parciales y la RLS son lo que el DSL de Prisma no expresa.
--
-- Al diagnóstico (docs/auditoria-2026-08-21-diagnostico.sql) entran en este
-- mismo cambio: la política de aislamiento a la fila 5, el índice único
-- parcial de conversations a la fila 7, las dos FKs compuestas a la fila 16
-- (56 -> 58 FKs conocidas) y el índice de la cola a la fila 17. La fila 8
-- (CHECKs) no cambia.
-- ---------------------------------------------------------------------------

-- CreateEnum
CREATE TYPE "MessageDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "AgentInboundJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'DONE', 'FAILED');

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "delivery_error" TEXT,
ADD COLUMN     "delivery_status" "MessageDeliveryStatus";

-- CreateTable
CREATE TABLE "agent_inbound_jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "phone_number_id" VARCHAR(40) NOT NULL,
    "wa_id" VARCHAR(40) NOT NULL,
    "status" "AgentInboundJobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3),
    "locked_until" TIMESTAMP(3),
    "last_error" TEXT,
    "response_message_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_inbound_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_inbound_jobs_organization_id_created_at_idx" ON "agent_inbound_jobs"("organization_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "agent_inbound_jobs_organization_id_message_id_key" ON "agent_inbound_jobs"("organization_id", "message_id");

-- CreateIndex
CREATE UNIQUE INDEX "agent_inbound_jobs_organization_id_response_message_id_key" ON "agent_inbound_jobs"("organization_id", "response_message_id");

-- CreateIndex
CREATE UNIQUE INDEX "messages_organization_id_id_key" ON "messages"("organization_id", "id");

-- CreateIndex
-- El índice de la COLA: los candidatos a reclamar. Parcial y sobre una
-- expresión, las dos formas que el DSL de Prisma no expresa — mismo molde que
-- outbox_events_claimable_idx (20260828150000) y por el mismo motivo: con la
-- cola sana casi todas las filas están en DONE, y el reclamo solo mira las
-- vivas. Incluye PROCESSING porque un job con el lease vencido (el proceso
-- que lo tenía murió) también es reclamable; ver claimNextAgentInboundJob.
CREATE INDEX "agent_inbound_jobs_claimable_idx"
  ON "agent_inbound_jobs" (coalesce("next_attempt_at", "created_at"))
  WHERE "status" IN ('PENDING'::"AgentInboundJobStatus", 'PROCESSING'::"AgentInboundJobStatus");

-- AddForeignKey
ALTER TABLE "agent_inbound_jobs" ADD CONSTRAINT "agent_inbound_jobs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
-- NOT NULL -> RESTRICT (regla de 20260821140200). Los mensajes no se borran
-- en ningún flujo del producto; si alguien introduce un borrado físico, que
-- falle ruidosamente en vez de dejar un job apuntando a la nada.
ALTER TABLE "agent_inbound_jobs" ADD CONSTRAINT "agent_inbound_jobs_organization_id_message_id_fkey" FOREIGN KEY ("organization_id", "message_id") REFERENCES "messages"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
-- Nullable -> NO ACTION (misma regla).
ALTER TABLE "agent_inbound_jobs" ADD CONSTRAINT "agent_inbound_jobs_organization_id_response_message_id_fkey" FOREIGN KEY ("organization_id", "response_message_id") REFERENCES "messages"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- RLS — el patrón de aislamiento uniforme de M-5 (20260901120000), el mismo
-- que outbox_events: `for all` con USING y WITH CHECK sobre
-- current_organization_id(). La tabla nace sin grants a anon/authenticated
-- (default privileges de 20260821140100/20260902150000); la política es la
-- segunda capa.
-- ---------------------------------------------------------------------------
alter table public.agent_inbound_jobs enable row level security;
drop policy if exists agent_inbound_jobs_isolation on public.agent_inbound_jobs;
create policy agent_inbound_jobs_isolation on public.agent_inbound_jobs
  for all
  using (organization_id = current_organization_id())
  with check (organization_id = current_organization_id());

-- ---------------------------------------------------------------------------
-- Ítem 126: a lo sumo una conversación abierta por contacto, agente y canal.
-- ---------------------------------------------------------------------------

-- La corrección de datos del encabezado: cierra los duplicados que B-03 pudo
-- haber dejado. En una base sin duplicados no toca ninguna fila.
WITH ranqueadas AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY organization_id, agent_id, contact_id, channel
      ORDER BY last_message_at DESC NULLS LAST, created_at DESC, id DESC
    ) AS posicion
  FROM conversations
  WHERE status IN ('ACTIVE', 'TRANSFERRED_TO_HUMAN')
)
UPDATE conversations c
SET status = 'CLOSED', updated_at = CURRENT_TIMESTAMP
FROM ranqueadas r
WHERE c.id = r.id AND r.posicion > 1;

-- CreateIndex
-- El predicado es EXACTAMENTE el filtro de findOpenConversation: lo que el
-- código considera "la conversación abierta" y lo que la base garantiza único
-- tienen que ser la misma definición, o el P2002 → releer podría releer nada.
CREATE UNIQUE INDEX "conversations_open_unique"
  ON "conversations" ("organization_id", "agent_id", "contact_id", "channel")
  WHERE "status" IN ('ACTIVE'::"ConversationStatus", 'TRANSFERRED_TO_HUMAN'::"ConversationStatus");
