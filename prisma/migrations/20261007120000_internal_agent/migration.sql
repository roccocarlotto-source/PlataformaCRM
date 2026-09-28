-- ---------------------------------------------------------------------------
-- Ítem 179 de docs/frontend-cambios-pendientes.md (rama
-- feature/agente-interno-backend): el agente de IA de uso INTERNO de una
-- organización. El ADMIN, y los usuarios que el ADMIN habilite, le consultan
-- datos del negocio y le piden acciones (crear una tarea, ver la agenda).
--
-- ES UN SUBSISTEMA NUEVO, NO UNA EXTENSIÓN DE agents/conversations/messages:
-- conversations.contact_id es NOT NULL y todo el loop del agente de cliente
-- está armado alrededor de un contacto real y de una posible derivación a una
-- persona. Acá quien escribe es un empleado. agents, conversations y messages
-- no se tocan.
--
-- TRES COSAS:
--
-- 1. internal_agents — la configuración, UNA por organización (UNIQUE
--    organization_id). Más el UNIQUE (organization_id, id) que exige la FK
--    compuesta de internal_agent_messages (C-3).
--
-- 2. internal_agent_messages — el historial, un hilo continuo por usuario.
--    FKs compuestas a internal_agents y a users, NOT NULL -> RESTRICT (regla
--    de 20260821140200).
--
-- 3. users.can_use_internal_agent — boolean NOT NULL DEFAULT false. Solo
--    cuenta para USER (un ADMIN siempre tiene acceso). El default hace que el
--    ADD COLUMN no reescriba la tabla (Postgres 11+) y que nadie que no sea
--    ADMIN gane acceso por esta migración.
--
-- Escrita a mano, no generada por `prisma migrate dev`: mismo motivo que el
-- resto de las migraciones desde 20260821 (la shadow database no tiene el
-- schema auth). Las sentencias de los puntos 1 a 3 son exactamente lo que
-- `prisma migrate diff` deriva del schema, para que no aparezca drift; la RLS
-- es lo que el DSL de Prisma no expresa.
--
-- Al diagnóstico (docs/auditoria-2026-08-21-diagnostico.sql) entran en este
-- mismo cambio: las dos políticas de aislamiento a la fila 5 y las dos FKs
-- compuestas a la fila 16 (67 -> 69 FKs conocidas). Sin CHECK nuevo: la fila
-- 8 no cambia.
-- ---------------------------------------------------------------------------

-- CreateEnum
CREATE TYPE "InternalAgentMessageSenderType" AS ENUM ('USER', 'AGENT');

-- AlterTable
-- El punto 3 del encabezado.
ALTER TABLE "users" ADD COLUMN     "can_use_internal_agent" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "internal_agents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "instructions" TEXT NOT NULL,
    "model_provider" VARCHAR(50) NOT NULL,
    "model_name" VARCHAR(100) NOT NULL,
    "enabled_tools" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "internal_agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "internal_agent_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "internal_agent_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "sender_type" "InternalAgentMessageSenderType" NOT NULL,
    "content" TEXT NOT NULL,
    "tool_calls" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "internal_agent_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- Un solo agente interno por organización (punto 1).
CREATE UNIQUE INDEX "internal_agents_organization_id_key" ON "internal_agents"("organization_id");

-- CreateIndex
-- El destino de la FK compuesta de internal_agent_messages (punto 1).
CREATE UNIQUE INDEX "internal_agents_organization_id_id_key" ON "internal_agents"("organization_id", "id");

-- CreateIndex
CREATE INDEX "internal_agent_messages_organization_id_idx" ON "internal_agent_messages"("organization_id");

-- CreateIndex
-- Leer un hilo ordenado: la ventana de cada turno y el GET paginado.
CREATE INDEX "internal_agent_messages_internal_agent_id_user_id_created_a_idx" ON "internal_agent_messages"("internal_agent_id", "user_id", "created_at");

-- AddForeignKey
ALTER TABLE "internal_agents" ADD CONSTRAINT "internal_agents_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_agent_messages" ADD CONSTRAINT "internal_agent_messages_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
-- Las dos compuestas NOT NULL -> RESTRICT (punto 2). Protegen contra que un id
-- de otra organización se cuele, mismo criterio que discount_vouchers.
ALTER TABLE "internal_agent_messages" ADD CONSTRAINT "internal_agent_messages_organization_id_internal_agent_id_fkey" FOREIGN KEY ("organization_id", "internal_agent_id") REFERENCES "internal_agents"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
-- users usa soft delete: el RESTRICT no se dispara en ningún flujo del
-- producto, y si alguien introduce un borrado físico falla ruidosamente en vez
-- de perder el rastro de quién escribió (mismo criterio que activities.author_id).
ALTER TABLE "internal_agent_messages" ADD CONSTRAINT "internal_agent_messages_organization_id_user_id_fkey" FOREIGN KEY ("organization_id", "user_id") REFERENCES "users"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- RLS — el patrón de aislamiento uniforme de M-5 (20260901120000), el mismo
-- que discount_vouchers: `for all` con USING y WITH CHECK sobre
-- current_organization_id(). Las tablas nacen sin grants a anon/authenticated
-- (default privileges de 20260821140100/20260902150000); la política es la
-- segunda capa.
-- ---------------------------------------------------------------------------
alter table public.internal_agents enable row level security;
drop policy if exists internal_agents_isolation on public.internal_agents;
create policy internal_agents_isolation on public.internal_agents
  for all
  using (organization_id = current_organization_id())
  with check (organization_id = current_organization_id());

alter table public.internal_agent_messages enable row level security;
drop policy if exists internal_agent_messages_isolation on public.internal_agent_messages;
create policy internal_agent_messages_isolation on public.internal_agent_messages
  for all
  using (organization_id = current_organization_id())
  with check (organization_id = current_organization_id());
