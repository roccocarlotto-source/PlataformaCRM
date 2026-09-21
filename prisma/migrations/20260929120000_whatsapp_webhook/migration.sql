-- ---------------------------------------------------------------------------
-- Webhook de WhatsApp Business Platform (ítem 81 de
-- docs/frontend-cambios-pendientes.md; paso 6 de §9 de
-- docs/ai-agent-architecture.md).
--
-- DOS COSAS, las dos que necesita el webhook y nada más:
--
-- 1. agents.whatsapp_phone_number_id — el phone_number_id que Meta manda en
--    cada webhook (metadata.phone_number_id). Es lo único que dice a qué
--    agente (y por lo tanto a qué organización y sucursal) le corresponde un
--    mensaje entrante: el equivalente de allowed_origins para el canal Web.
--    NULLABLE, sin default ni backfill: ningún agente existente tiene número
--    hasta que un ADMIN lo cargue. UNIQUE GLOBAL (no por organización): el
--    webhook no trae ninguna otra pista, así que dos agentes con el mismo
--    número serían un mensaje sin dueño. Postgres no compara NULLs entre sí,
--    así que los agentes sin número no chocan.
--
-- 2. messages (organization_id, external_message_id) UNIQUE — el índice que
--    el comentario de Message.externalMessageId venía anunciando ("nace con el
--    webhook que lo necesite"). Meta reintenta la entrega ante cualquier cosa
--    que no sea un 2xx, así que el mismo wamid puede llegar dos veces; este
--    índice es lo que hace que la segunda no se procese aunque dos entregas
--    corran en paralelo. Los mensajes sin id externo (Web, salientes,
--    probador) quedan en NULL y no chocan entre sí.
--
-- Sin cambios en el diagnóstico (docs/auditoria-2026-08-21-diagnostico.sql):
-- no hay tabla nueva (fila 5), ni CHECK (fila 8), ni FK (filas 14/16).
--
-- Escrita a mano, no generada por `prisma migrate dev`: mismo motivo que el
-- resto de las migraciones desde 20260821 (la shadow database no tiene el
-- schema auth). Las sentencias son exactamente lo que `prisma migrate diff`
-- deriva del schema, para que no aparezca drift.
-- ---------------------------------------------------------------------------

-- AlterTable
ALTER TABLE "agents" ADD COLUMN "whatsapp_phone_number_id" VARCHAR(40);

-- CreateIndex
CREATE UNIQUE INDEX "agents_whatsapp_phone_number_id_key" ON "agents"("whatsapp_phone_number_id");

-- CreateIndex
CREATE UNIQUE INDEX "messages_organization_id_external_message_id_key" ON "messages"("organization_id", "external_message_id");
