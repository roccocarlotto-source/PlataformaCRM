-- ---------------------------------------------------------------------------
-- Ítem 185 de docs/frontend-cambios-pendientes.md: seguimiento automático de
-- consultas estancadas y la marca "sin interés".
--
-- 1. contacts.no_interest_at / no_interest_note: el cliente dijo que no le
--    interesa. La pone el agente (tool mark_no_interest) o una persona desde
--    la ficha, y se quita a mano. Mientras está, ningún seguimiento
--    automático le escribe. Nullable las dos, sin backfill: "sin marca" es
--    el estado de todo contacto existente.
--
-- 2. inquiry_follow_ups: EL MISMO MOLDE QUE discount_voucher_follow_ups
--    (20261008120000). La acción inquiry.follow_up del motor de
--    automatizaciones deja una fila por cada seguimiento sobre un contacto
--    que escribió y se quedó callado X días; por WhatsApp la manda el worker
--    (src/workers/inquiryFollowUpWorker.ts) dentro del horario de la
--    sucursal, por los otros canales crea la tarea en el acto y la fila nace
--    SENT. La tabla es también el contador de "no más de N seguimientos".
--
--    Lo que cambia respecto de discount_voucher_follow_ups:
--    - conversation_id en lugar de opportunity_id: la conversación por la
--      que escribió por última vez (donde se anota lo enviado y cuyo canal
--      decide el tipo); channel y kind fotografiados al agendar.
--    - outbox_event_id (sin FK, como en automation_executions: los eventos
--      se purgan) en el UNIQUE en lugar de la oportunidad: un contacto puede
--      recibir más de un seguimiento a lo largo del tiempo, y lo que no
--      puede pasar es que la reentrega del MISMO evento agende dos.
--    - last_inbound_at: el último mensaje del cliente al agendar; si al
--      mandar hay uno posterior, ya respondió y se cancela.
--
-- Escrita a mano, no generada por `prisma migrate dev`: mismo motivo que el
-- resto desde 20260821. Enum, tabla, índices y FKs son lo que `prisma migrate
-- diff` deriva del schema (el UNIQUE lleva nombre propio en el schema porque
-- el derivado supera los 63 caracteres); el índice parcial de la cola y la
-- RLS son lo que el DSL no expresa.
--
-- Al diagnóstico (docs/auditoria-2026-08-21-diagnostico.sql) entran en este
-- mismo cambio: la política de aislamiento a la fila 5, las cuatro FKs
-- compuestas a la fila 16 (80 -> 84 FKs conocidas) y el índice de la cola a
-- la fila 17. Sin CHECK nuevo.
-- ---------------------------------------------------------------------------

-- AlterTable
ALTER TABLE "contacts" ADD COLUMN "no_interest_at" TIMESTAMP(3),
ADD COLUMN "no_interest_note" VARCHAR(200);

-- CreateEnum
CREATE TYPE "InquiryFollowUpStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InquiryFollowUpKind" AS ENUM ('WHATSAPP', 'TASK');

-- CreateTable
CREATE TABLE "inquiry_follow_ups" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "automation_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "channel" "ConversationChannel" NOT NULL,
    "outbox_event_id" UUID NOT NULL,
    "kind" "InquiryFollowUpKind" NOT NULL,
    "last_inbound_at" TIMESTAMP(3) NOT NULL,
    "scheduled_for" TIMESTAMP(3) NOT NULL,
    "next_attempt_at" TIMESTAMP(3) NOT NULL,
    "status" "InquiryFollowUpStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inquiry_follow_ups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inquiry_follow_ups_organization_id_contact_id_created_at_idx" ON "inquiry_follow_ups"("organization_id", "contact_id", "created_at");

-- CreateIndex
CREATE INDEX "inquiry_follow_ups_organization_id_created_at_idx" ON "inquiry_follow_ups"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "inquiry_follow_ups_organization_id_conversation_id_idx" ON "inquiry_follow_ups"("organization_id", "conversation_id");

-- CreateIndex
CREATE INDEX "inquiry_follow_ups_organization_id_branch_id_idx" ON "inquiry_follow_ups"("organization_id", "branch_id");

-- CreateIndex
-- A lo sumo un agendado por (regla, contacto, evento): la reentrega del
-- evento no agenda un segundo seguimiento. Cubre además el lado
-- referenciante de la FK a automations.
CREATE UNIQUE INDEX "inquiry_follow_ups_automation_contact_event_key" ON "inquiry_follow_ups"("organization_id", "automation_id", "contact_id", "outbox_event_id");

-- CreateIndex
-- El índice de la COLA, mismo molde que discount_voucher_follow_ups_claimable_idx.
CREATE INDEX "inquiry_follow_ups_claimable_idx"
  ON "inquiry_follow_ups" ("next_attempt_at")
  WHERE "status" = 'PENDING'::"InquiryFollowUpStatus";

-- AddForeignKey
ALTER TABLE "inquiry_follow_ups" ADD CONSTRAINT "inquiry_follow_ups_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
-- Las cuatro NOT NULL -> RESTRICT (regla de 20260821140200).
ALTER TABLE "inquiry_follow_ups" ADD CONSTRAINT "inquiry_follow_ups_organization_id_automation_id_fkey" FOREIGN KEY ("organization_id", "automation_id") REFERENCES "automations"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inquiry_follow_ups" ADD CONSTRAINT "inquiry_follow_ups_organization_id_contact_id_fkey" FOREIGN KEY ("organization_id", "contact_id") REFERENCES "contacts"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inquiry_follow_ups" ADD CONSTRAINT "inquiry_follow_ups_organization_id_conversation_id_fkey" FOREIGN KEY ("organization_id", "conversation_id") REFERENCES "conversations"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inquiry_follow_ups" ADD CONSTRAINT "inquiry_follow_ups_organization_id_branch_id_fkey" FOREIGN KEY ("organization_id", "branch_id") REFERENCES "branches"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- RLS — el patrón de aislamiento uniforme de M-5 (20260901120000), el mismo
-- que discount_voucher_follow_ups. La tabla nace sin grants a
-- anon/authenticated (default privileges de 20260821140100/20260902150000);
-- la política es la segunda capa.
-- ---------------------------------------------------------------------------
alter table public.inquiry_follow_ups enable row level security;
drop policy if exists inquiry_follow_ups_isolation on public.inquiry_follow_ups;
create policy inquiry_follow_ups_isolation on public.inquiry_follow_ups
  for all
  using (organization_id = current_organization_id())
  with check (organization_id = current_organization_id());
