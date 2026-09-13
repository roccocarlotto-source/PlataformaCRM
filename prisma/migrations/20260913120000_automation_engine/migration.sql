-- ---------------------------------------------------------------------------
-- Motor de automatizaciones (docs/automations-architecture.md §3): las tablas
-- automations y automation_executions, y el enum AutomationExecutionStatus.
-- Es el primer consumidor real del outbox (20260828150000): una Automation es
-- la regla "cuando pase trigger_type, ejecutá action_type con action_config";
-- una AutomationExecution es la marca de que esa regla YA corrió para un
-- evento saliente concreto, que es lo que hace al despacho idempotente frente
-- a los reintentos del outbox (§6 del documento).
--
-- Escrita a mano, no generada por `prisma migrate dev`: mismo motivo que el
-- resto de las migraciones desde 20260821 (la shadow database no tiene el
-- schema auth). Quien valida que aplica sobre una base vacía es el job
-- `integration` del CI, que reconstruye la base desde cero en cada corrida.
--
-- El enum nace en esta migración y SE USA como tipo de columna en la misma
-- transacción. Es legal: la prohibición de Postgres ("unsafe use of new
-- value") aplica a ALTER TYPE ... ADD VALUE, no a CREATE TYPE. Mismo molde
-- que 20260830120000 (BookingStatus) y 20260912130000 (los enums del agente).
--
-- LAS ACCIONES REFERENCIALES salen de la regla de 20260821140200 y la fila 14
-- del diagnóstico las deriva sola: automation_id es NOT NULL -> RESTRICT. No
-- CASCADE: automations usa soft delete, así que la FK no se dispara en la
-- práctica, y si alguien introduce un borrado físico de una regla con
-- historial, que falle ruidosamente en vez de borrar el historial en silencio.
--
-- SIN FK de automation_executions.outbox_event_id a outbox_events, a
-- propósito: los eventos salientes se purgan a los 90 días
-- (purge:outbox-events) y esta fila es el historial de la REGLA, no del
-- evento. Una FK obligaría a purgar las ejecuciones con el evento o a
-- bloquear la purga.
--
-- Al diagnóstico (docs/auditoria-2026-08-21-diagnostico.sql) entran en este
-- mismo cambio: las dos políticas de aislamiento a la fila 5 y la FK compuesta
-- a la fila 16 (43 -> 44). La fila 8 (CHECKs) no cambia: no hay ninguno.
-- ---------------------------------------------------------------------------

-- CreateEnum
CREATE TYPE "AutomationExecutionStatus" AS ENUM ('SUCCESS', 'FAILED');

-- ---------------------------------------------------------------------------
-- 1. automations
--
-- trigger_type y action_type son VARCHAR libres, no enums, mismo criterio que
-- outbox_events.event_type y agents.model_provider: el catálogo vive en
-- código y agregar un trigger o una acción no debe requerir migración.
-- action_config es JSONB sin forma impuesta: cada acción declara su propio
-- schema zod y el CRUD lo valida antes de guardar (como agents.guardrails).
-- ---------------------------------------------------------------------------

-- CreateTable
CREATE TABLE "automations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "trigger_type" VARCHAR(100) NOT NULL,
    "action_type" VARCHAR(100) NOT NULL,
    "action_config" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "automations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- El UNIQUE que habilita la FK compuesta de automation_executions (C-3).
CREATE UNIQUE INDEX "automations_organization_id_id_key" ON "automations"("organization_id", "id");

-- CreateIndex
-- Exactamente la consulta del dispatcher: "las reglas activas de esta
-- organización para este trigger". Sin @@index([organizationId]) suelto: un
-- btree que empieza por organization_id ya sirve cualquier WHERE por
-- organización, así que el de una sola columna sería peso muerto.
CREATE INDEX "automations_organization_id_trigger_type_is_active_idx" ON "automations"("organization_id", "trigger_type", "is_active");

-- ---------------------------------------------------------------------------
-- 2. automation_executions
-- ---------------------------------------------------------------------------

-- CreateTable
CREATE TABLE "automation_executions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "automation_id" UUID NOT NULL,
    "outbox_event_id" UUID NOT NULL,
    "status" "AutomationExecutionStatus" NOT NULL,
    "error" TEXT,
    "executed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automation_executions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- La garantía de "a lo sumo una marca por (regla, evento)": convierte la
-- idempotencia del dispatcher en un invariante de la base. Dos workers que
-- despacharan el mismo evento a la vez (imposible hoy por el FOR UPDATE SKIP
-- LOCKED del reclamo) no podrían escribir dos marcas.
CREATE UNIQUE INDEX "automation_executions_automation_id_outbox_event_id_key" ON "automation_executions"("automation_id", "outbox_event_id");

-- CreateIndex
-- Cubre el lado referenciante de la FK compuesta —que Postgres no indexa por
-- su cuenta— y "las ejecuciones de esta regla, ordenadas", con un solo
-- índice. Mismo criterio que agent_embed_tokens_organization_id_agent_id_created_at_idx.
--
-- EL NOMBRE ESTÁ RECORTADO A PROPÓSITO ("execute_idx", no "executed_at_idx"):
-- es exactamente el que Prisma deriva para @@index([organizationId,
-- automationId, executedAt]) cuando el nombre completo supera los 63
-- caracteres del identificador de Postgres. Escribirlo entero acá haría que
-- Postgres lo truncara a otro string y `prisma migrate diff` reportara un
-- RenameIndex como drift en cada corrida.
CREATE INDEX "automation_executions_organization_id_automation_id_execute_idx" ON "automation_executions"("organization_id", "automation_id", "executed_at");

-- ---------------------------------------------------------------------------
-- 3. Foreign keys — la cruzada es COMPUESTA (organization_id, automation_id)
-- -> automations(organization_id, id), el estándar del proyecto desde C-3.
-- ---------------------------------------------------------------------------

-- AddForeignKey
ALTER TABLE "automations" ADD CONSTRAINT "automations_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_executions" ADD CONSTRAINT "automation_executions_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_executions" ADD CONSTRAINT "automation_executions_organization_id_automation_id_fkey"
    FOREIGN KEY ("organization_id", "automation_id") REFERENCES "automations"("organization_id", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 4. RLS — el patrón de aislamiento uniforme de M-5 (20260901120000), el
-- mismo que outbox_events, branches o vehicles: `for all` con USING y WITH
-- CHECK sobre current_organization_id(), y `drop policy if exists` antes de
-- cada create. Las dos tablas tienen organization_id propio, así que no hay
-- motivo para la excepción deny-all de api_keys (no guardan secretos).
--
-- HOY NO ES ALCANZABLE desde afuera de Express: 20260821140100 revocó todo
-- grant a anon/authenticated sobre public y fijó `alter default privileges
-- ... revoke`, así que las tablas nacen sin grants (fila 18 del diagnóstico).
-- La política es la SEGUNDA capa, para el día que alguien habilite Realtime
-- o haga un grant para un dashboard.
-- ---------------------------------------------------------------------------
alter table public.automations enable row level security;
drop policy if exists automations_isolation on public.automations;
create policy automations_isolation on public.automations
  for all
  using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());

alter table public.automation_executions enable row level security;
drop policy if exists automation_executions_isolation on public.automation_executions;
create policy automation_executions_isolation on public.automation_executions
  for all
  using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());
