-- ---------------------------------------------------------------------------
-- Módulo de Agentes de IA, paso 1 de docs/ai-agent-architecture.md §9: las
-- tres entidades del modelo de datos de §3 — Agent, Conversation y Message —
-- con sus cuatro enums.
--
-- SOLO SCHEMA, mismo criterio que 20260912120000 (calificación del lead en
-- Contact): ningún controller, service, route ni loop de orquestación lee o
-- escribe estas tablas todavía — eso es el paso 2 del plan. Por eso no hay
-- backfill (nacen vacías), no hay tests nuevos y no hay cambios en Zod.
--
-- Escrita a mano, no generada por `prisma migrate dev`: mismo motivo que el
-- resto de las migraciones desde 20260821 (la shadow database no tiene el
-- schema auth). Quien valida que aplica sobre una base vacía es el job
-- `integration` del CI, que reconstruye la base desde cero en cada corrida.
--
-- LAS ACCIONES REFERENCIALES salen de la regla de 20260821140200 y la fila 14
-- del diagnóstico las deriva sola: columna referenciante NOT NULL -> RESTRICT
-- (agents.branch_id; conversations.branch_id, agent_id y contact_id;
-- messages.conversation_id), nullable -> NO ACTION
-- (conversations.assigned_user_id, messages.sender_user_id). Ninguna es
-- CASCADE: agents usa soft delete y conversations/messages no se borran, así
-- que ninguna se dispara en la práctica, y si alguien introduce un borrado
-- físico, que falle ruidosamente.
--
-- SIN políticas RLS, y no es una omisión: bookings, working_hours, resources,
-- service_types y google_calendar_connections —el módulo arquitectónicamente
-- más parecido— tampoco las tienen (ver prisma/sql/rls_policies.sql). La
-- defensa principal sigue siendo el filtro por organization_id en cada query.
--
-- Los cuatro enums nacen en esta migración y MessageSenderType SE USA en el
-- CHECK del final, en la misma transacción. Es legal: la prohibición de
-- Postgres ("unsafe use of new value") aplica a ALTER TYPE ... ADD VALUE, no a
-- CREATE TYPE. Mismo molde que 20260830120000, que creó BookingStatus y lo usó
-- como DEFAULT en la misma migración.
--
-- Al diagnóstico (docs/auditoria-2026-08-21-diagnostico.sql) entran en este
-- mismo cambio: el CHECK a la fila 8 (22 -> 23) y las siete FKs compuestas a
-- la fila 16 (35 -> 42). La expectativa de la fila 8 se transcribió de lo que
-- pg_get_constraintdef devolvió de verdad después de aplicar esta migración,
-- como pide la regla del encabezado del diagnóstico.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Enums nativos
-- ---------------------------------------------------------------------------

-- CreateEnum
CREATE TYPE "ConversationChannel" AS ENUM ('WHATSAPP', 'WEB');

-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('ACTIVE', 'TRANSFERRED_TO_HUMAN', 'CLOSED');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "MessageSenderType" AS ENUM ('CONTACT', 'AGENT', 'HUMAN');

-- ---------------------------------------------------------------------------
-- 2. agents
--
-- Un agente de IA configurado por una sucursal. branch_id NO es UNIQUE: el
-- documento de visión permite varios agentes por negocio aunque el plan cree
-- uno solo al principio. CON deleted_at, a diferencia de las otras dos tablas:
-- es configuración que un ADMIN da de alta y de baja, no historia.
--
-- model_provider / model_name son VARCHAR y no enum: el catálogo de
-- proveedores y modelos cambia más rápido de lo que conviene versionar en un
-- tipo de Postgres (mismo criterio que opportunities.currency).
--
-- enabled_tools y channels son arrays sin DEFAULT, tal como los declara el
-- schema (Prisma devuelve [] cuando la columna es NULL). guardrails es JSONB
-- NOT NULL sin default: la forma esperada está documentada en §6 y no impuesta
-- por Postgres (mismo criterio que contacts.custom_fields), pero un agente sin
-- guardrails declarados no debería poder existir aunque el valor sea `{}`.
-- ---------------------------------------------------------------------------

-- CreateTable
CREATE TABLE "agents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "goal" VARCHAR(500),
    "instructions" TEXT NOT NULL,
    "tone" VARCHAR(100),
    "model_provider" VARCHAR(50) NOT NULL,
    "model_name" VARCHAR(100) NOT NULL,
    "enabled_tools" TEXT[],
    "channels" "ConversationChannel"[],
    "guardrails" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "agents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- El UNIQUE que habilita la FK compuesta de conversations (C-3).
CREATE UNIQUE INDEX "agents_organization_id_id_key" ON "agents"("organization_id", "id");

-- CreateIndex
CREATE INDEX "agents_organization_id_idx" ON "agents"("organization_id");

-- CreateIndex
CREATE INDEX "agents_branch_id_idx" ON "agents"("branch_id");

-- ---------------------------------------------------------------------------
-- 3. conversations
--
-- Un hilo entre un contacto y un agente por un canal. branch_id está
-- denormalizado desde agent_id (mismo criterio que stages.organization_id).
-- contact_id es NOT NULL: una conversación sin contacto no es una conversación
-- (mismo criterio que bookings.contact_id). assigned_user_id se completa solo
-- en el handoff (status = TRANSFERRED_TO_HUMAN).
--
-- SIN deleted_at: "cerrada" es un status (CLOSED), no un borrado. Una
-- conversación cerrada es historia que hay que conservar tal cual, y un soft
-- delete agregaría un cuarto estado que no significa nada distinto de CLOSED.
-- Mismo criterio que bookings con BookingStatus.CANCELLED.
-- ---------------------------------------------------------------------------

-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "agent_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "assigned_user_id" UUID,
    "channel" "ConversationChannel" NOT NULL,
    "status" "ConversationStatus" NOT NULL DEFAULT 'ACTIVE',
    "external_thread_id" VARCHAR(255),
    "last_message_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- El UNIQUE que habilita la FK compuesta de messages (C-3).
CREATE UNIQUE INDEX "conversations_organization_id_id_key" ON "conversations"("organization_id", "id");

-- CreateIndex
CREATE INDEX "conversations_organization_id_idx" ON "conversations"("organization_id");

-- CreateIndex
CREATE INDEX "conversations_branch_id_idx" ON "conversations"("branch_id");

-- CreateIndex
-- Historial de conversaciones de un contacto.
CREATE INDEX "conversations_contact_id_idx" ON "conversations"("contact_id");

-- CreateIndex
-- La bandeja: conversaciones activas / derivadas de la organización.
CREATE INDEX "conversations_organization_id_status_idx" ON "conversations"("organization_id", "status");

-- ---------------------------------------------------------------------------
-- 4. messages
--
-- Un mensaje dentro de una conversación. organization_id está denormalizado
-- desde conversation_id, para la FK compuesta y el aislamiento.
--
-- SIN updated_at NI deleted_at: un mensaje enviado no se edita ni se borra, es
-- la transcripción de algo que ya pasó con un tercero — a diferencia de
-- activities, que es una nota interna y sí se edita. Solo created_at.
--
-- external_message_id SIN UNIQUE todavía: el índice que haga cumplir la
-- deduplicación nace con el webhook que la necesite (paso 6 de §9), cuando se
-- sepa contra qué se deduplica.
-- ---------------------------------------------------------------------------

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "sender_type" "MessageSenderType" NOT NULL,
    "sender_user_id" UUID,
    "content" TEXT NOT NULL,
    "tool_calls" JSONB,
    "external_message_id" VARCHAR(255),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- El patrón de lectura real, y el único: los mensajes de una conversación, en
-- orden. No hay listado de mensajes por organización.
CREATE INDEX "messages_conversation_id_created_at_idx" ON "messages"("conversation_id", "created_at");

-- ---------------------------------------------------------------------------
-- 5. Foreign keys
--
-- Todas las cruzadas son COMPUESTAS (organization_id, x_id) -> padre
-- (organization_id, id), el estándar del proyecto desde C-3. ON DELETE por la
-- regla de 20260821140200 (ver el encabezado).
-- ---------------------------------------------------------------------------

-- AddForeignKey
ALTER TABLE "agents" ADD CONSTRAINT "agents_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agents" ADD CONSTRAINT "agents_organization_id_branch_id_fkey"
    FOREIGN KEY ("organization_id", "branch_id") REFERENCES "branches"("organization_id", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_organization_id_branch_id_fkey"
    FOREIGN KEY ("organization_id", "branch_id") REFERENCES "branches"("organization_id", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_organization_id_agent_id_fkey"
    FOREIGN KEY ("organization_id", "agent_id") REFERENCES "agents"("organization_id", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_organization_id_contact_id_fkey"
    FOREIGN KEY ("organization_id", "contact_id") REFERENCES "contacts"("organization_id", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_organization_id_assigned_user_id_fkey"
    FOREIGN KEY ("organization_id", "assigned_user_id") REFERENCES "users"("organization_id", "id")
    ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_organization_id_conversation_id_fkey"
    FOREIGN KEY ("organization_id", "conversation_id") REFERENCES "conversations"("organization_id", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_organization_id_sender_user_id_fkey"
    FOREIGN KEY ("organization_id", "sender_user_id") REFERENCES "users"("organization_id", "id")
    ON DELETE NO ACTION ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 6. CHECK constraint — uno solo.
--
-- Vive acá y NO en prisma/sql/manual_constraints.sql: B-15 de
-- docs/auditoria-2026-08-29.md sacó los CHECK de la reaplicación por deploy.
-- Mismo criterio que contacts_lead_* (20260912120000) y vehicles_*
-- (20260907120000).
--
-- sender_type y sender_user_id van juntos: un mensaje HUMAN tiene que decir
-- quién lo mandó, y uno CONTACT/AGENT no puede tener un usuario puesto por
-- error. Mismo espíritu que google_calendar_connections_channel_all_or_none_
-- check ("una fila ACTIVE sin token es imposible"): son estados inconsistentes
-- que conviene que el motor rechace, no solo la aplicación. El documento de
-- arquitectura §3 no lo detallaba; se agrega al implementar.
--
-- Escrito con las dos ramas explícitas y no como
-- `(sender_type = 'HUMAN') = (sender_user_id is not null)` a propósito: si
-- MessageSenderType gana un cuarto valor (un SYSTEM, digamos), la forma
-- booleana lo dejaría pasar con sender_user_id NULL sin que nadie decida nada,
-- mientras que esta lo rechaza hasta que alguien extienda el CHECK.
-- ---------------------------------------------------------------------------
alter table public.messages
  add constraint messages_sender_user_id_consistency_check
  check (
    (sender_type = 'HUMAN' and sender_user_id is not null)
    or (sender_type in ('CONTACT', 'AGENT') and sender_user_id is null)
  );
