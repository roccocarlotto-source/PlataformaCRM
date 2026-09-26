-- ---------------------------------------------------------------------------
-- Ítem 159 de docs/frontend-cambios-pendientes.md (rama
-- feat/seguimiento-qr-al-ganar-oportunidad): seguimiento automático por
-- WhatsApp con el QR de la sucursal cuando una oportunidad pasa a ganada. Es
-- la feature de "enlaces de fidelización" que quedó anotada en el pivot del
-- 04/09 (docs/qr-integration.md).
--
-- TRES COSAS:
--
-- 1. qr_follow_ups — los envíos AGENDADOS. La acción
--    opportunity.send_qr_followup del motor de automatizaciones no manda
--    nada: el dispatcher la corre en el instante en que se entrega el evento
--    opportunity.won y no tiene noción de demora, así que la acción deja una
--    fila con scheduled_for = ahora + delayHours y el worker
--    (src/workers/qrFollowUpWorker.ts) la manda cuando vence.
--
-- 2. qr_follow_ups (automation_id, opportunity_id) UNIQUE — a lo sumo un
--    agendado por regla y oportunidad. El evento opportunity.won se puede
--    REENTREGAR antes de que su AutomationExecution quede en SUCCESS: si el
--    proceso muere entre el efecto de la acción y la escritura de la marca,
--    el outbox reintenta y la acción vuelve a correr (la ventana documentada
--    en automationDispatch.service.ts). Para una acción que crea una Activity
--    eso es una tarea duplicada; para ésta sería un SEGUNDO WHATSAPP al
--    cliente, que no se puede deshacer. Con el UNIQUE, la acción inserta con
--    ON CONFLICT DO NOTHING y la reentrega no agenda nada: la ventana queda
--    cerrada por la base y no por una convención del código. Es por REGLA y
--    no por oportunidad a secas a propósito: dos reglas activas (distintos
--    QR, distintas demoras) agendan una fila cada una, que es lo que el
--    usuario configuró.
--
-- 3. qr_codes (organization_id, id) UNIQUE — el que habilita la FK compuesta
--    de qr_follow_ups hacia qr_codes (C-3). Hasta hoy nada referenciaba a un
--    QR. id ya es PK, así que el índice no puede fallar sobre datos
--    existentes.
--
-- Escrita a mano, no generada por `prisma migrate dev`: mismo motivo que el
-- resto de las migraciones desde 20260821 (la shadow database no tiene el
-- schema auth). Las sentencias de los puntos 1 a 3 son exactamente lo que
-- `prisma migrate diff` deriva del schema, para que no aparezca drift; el
-- índice parcial de la cola y la RLS son lo que el DSL de Prisma no expresa.
--
-- Al diagnóstico (docs/auditoria-2026-08-21-diagnostico.sql) entran en este
-- mismo cambio: la política de aislamiento a la fila 5, las cuatro FKs
-- compuestas a la fila 16 (58 -> 62 FKs conocidas) y el índice de la cola a
-- la fila 17.
-- ---------------------------------------------------------------------------

-- CreateEnum
CREATE TYPE "QrFollowUpStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "qr_follow_ups" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "automation_id" UUID NOT NULL,
    "opportunity_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "qr_code_id" UUID NOT NULL,
    "scheduled_for" TIMESTAMP(3) NOT NULL,
    "next_attempt_at" TIMESTAMP(3) NOT NULL,
    "status" "QrFollowUpStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "qr_follow_ups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "qr_follow_ups_organization_id_created_at_idx" ON "qr_follow_ups"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "qr_follow_ups_organization_id_opportunity_id_idx" ON "qr_follow_ups"("organization_id", "opportunity_id");

-- CreateIndex
CREATE INDEX "qr_follow_ups_organization_id_contact_id_idx" ON "qr_follow_ups"("organization_id", "contact_id");

-- CreateIndex
CREATE INDEX "qr_follow_ups_organization_id_qr_code_id_idx" ON "qr_follow_ups"("organization_id", "qr_code_id");

-- CreateIndex
-- El punto 2 del encabezado: la reentrega de opportunity.won no agenda un
-- segundo WhatsApp.
CREATE UNIQUE INDEX "qr_follow_ups_automation_id_opportunity_id_key" ON "qr_follow_ups"("automation_id", "opportunity_id");

-- CreateIndex
CREATE UNIQUE INDEX "qr_codes_organization_id_id_key" ON "qr_codes"("organization_id", "id");

-- CreateIndex
-- El índice de la COLA: los candidatos a reclamar. Parcial, la forma que el
-- DSL de Prisma no expresa — mismo molde que agent_inbound_jobs_claimable_idx
-- (20260930120000). Con la cola sana casi todas las filas están en un estado
-- terminal, y el reclamo solo mira las PENDING. Sin coalesce: next_attempt_at
-- es NOT NULL desde que nace (igual a scheduled_for).
CREATE INDEX "qr_follow_ups_claimable_idx"
  ON "qr_follow_ups" ("next_attempt_at")
  WHERE "status" = 'PENDING'::"QrFollowUpStatus";

-- AddForeignKey
ALTER TABLE "qr_follow_ups" ADD CONSTRAINT "qr_follow_ups_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
-- Las cuatro compuestas son NOT NULL -> RESTRICT (regla de 20260821140200).
-- Las cuatro tablas padre usan soft delete, así que la acción no se dispara en
-- ningún flujo del producto; si alguien introduce un borrado físico, que falle
-- ruidosamente en vez de dejar un envío apuntando a la nada.
ALTER TABLE "qr_follow_ups" ADD CONSTRAINT "qr_follow_ups_organization_id_automation_id_fkey" FOREIGN KEY ("organization_id", "automation_id") REFERENCES "automations"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qr_follow_ups" ADD CONSTRAINT "qr_follow_ups_organization_id_opportunity_id_fkey" FOREIGN KEY ("organization_id", "opportunity_id") REFERENCES "opportunities"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qr_follow_ups" ADD CONSTRAINT "qr_follow_ups_organization_id_contact_id_fkey" FOREIGN KEY ("organization_id", "contact_id") REFERENCES "contacts"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qr_follow_ups" ADD CONSTRAINT "qr_follow_ups_organization_id_qr_code_id_fkey" FOREIGN KEY ("organization_id", "qr_code_id") REFERENCES "qr_codes"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- RLS — el patrón de aislamiento uniforme de M-5 (20260901120000), el mismo
-- que agent_inbound_jobs: `for all` con USING y WITH CHECK sobre
-- current_organization_id(). La tabla nace sin grants a anon/authenticated
-- (default privileges de 20260821140100/20260902150000); la política es la
-- segunda capa.
-- ---------------------------------------------------------------------------
alter table public.qr_follow_ups enable row level security;
drop policy if exists qr_follow_ups_isolation on public.qr_follow_ups;
create policy qr_follow_ups_isolation on public.qr_follow_ups
  for all
  using (organization_id = current_organization_id())
  with check (organization_id = current_organization_id());
