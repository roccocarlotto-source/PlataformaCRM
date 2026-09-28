-- ---------------------------------------------------------------------------
-- Ítem 177 de docs/frontend-cambios-pendientes.md (rama
-- feature/automatizacion-cupon-descuento): la automatización que, N horas
-- después de que una oportunidad pasa a ganada, emite un cupón de descuento
-- de un solo uso (ítem 176) y se lo manda al cliente por WhatsApp.
--
-- EL MISMO MOLDE QUE qr_follow_ups (20261002120000). La acción
-- opportunity.send_discount_voucher no manda nada: deja una fila con
-- scheduled_for = ahora + delayHours, y el worker
-- (src/workers/discountVoucherFollowUpWorker.ts) emite el cupón y lo manda
-- cuando vence.
--
-- LO QUE CAMBIA RESPECTO DE qr_follow_ups:
--
-- 1. Sin qr_code_id: el cupón no existe al agendar. En su lugar, label y
--    expires_in_days, fotografiados del actionConfig en ese momento, y
--    discount_voucher_id (NULLABLE) que el worker completa al emitir el
--    cupón, ANTES de mandar — la traza de qué cupón salió de qué fila, y el
--    candado que evita un segundo cupón si el envío falla y se reintenta.
--
-- 2. branch_id: la sucursal de cuyo número de WhatsApp sale el mensaje. En
--    qr_follow_ups la pone el QR; un cupón no es de ninguna sucursal y
--    opportunities tampoco, así que la elige la regla.
--
-- 3. UNIQUE (organization_id, automation_id, opportunity_id) — el mismo
--    candado de a lo sumo un agendado por (regla, oportunidad), con
--    organization_id adelante: además cubre el lado referenciante de la FK
--    compuesta a automations, que así no necesita índice propio.
--
-- 4. Enum propio (DiscountVoucherFollowUpStatus) y no QrFollowUpStatus: ver
--    el comentario del enum en schema.prisma.
--
-- Escrita a mano, no generada por `prisma migrate dev`: mismo motivo que el
-- resto de las migraciones desde 20260821 (la shadow database no tiene el
-- schema auth). El enum, la tabla, los índices y las FKs son exactamente lo
-- que `prisma migrate diff` deriva del schema (incluidos los dos nombres que
-- Postgres trunca a 63 caracteres), para que no aparezca drift; el índice
-- parcial de la cola y la RLS son lo que el DSL de Prisma no expresa.
--
-- Al diagnóstico (docs/auditoria-2026-08-21-diagnostico.sql) entran en este
-- mismo cambio: la política de aislamiento a la fila 5, las cinco FKs
-- compuestas a la fila 16 (69 -> 74 FKs conocidas) y el índice de la cola a
-- la fila 17. Sin CHECK nuevo: la fila 8 no cambia.
-- ---------------------------------------------------------------------------

-- CreateEnum
CREATE TYPE "DiscountVoucherFollowUpStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "discount_voucher_follow_ups" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "automation_id" UUID NOT NULL,
    "opportunity_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "label" VARCHAR(200) NOT NULL,
    "expires_in_days" INTEGER NOT NULL,
    "discount_voucher_id" UUID,
    "scheduled_for" TIMESTAMP(3) NOT NULL,
    "next_attempt_at" TIMESTAMP(3) NOT NULL,
    "status" "DiscountVoucherFollowUpStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "discount_voucher_follow_ups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "discount_voucher_follow_ups_organization_id_created_at_idx" ON "discount_voucher_follow_ups"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "discount_voucher_follow_ups_organization_id_opportunity_id_idx" ON "discount_voucher_follow_ups"("organization_id", "opportunity_id");

-- CreateIndex
CREATE INDEX "discount_voucher_follow_ups_organization_id_contact_id_idx" ON "discount_voucher_follow_ups"("organization_id", "contact_id");

-- CreateIndex
CREATE INDEX "discount_voucher_follow_ups_organization_id_branch_id_idx" ON "discount_voucher_follow_ups"("organization_id", "branch_id");

-- CreateIndex
CREATE INDEX "discount_voucher_follow_ups_organization_id_discount_vouche_idx" ON "discount_voucher_follow_ups"("organization_id", "discount_voucher_id");

-- CreateIndex
-- El punto 3 del encabezado: la reentrega de opportunity.won no agenda un
-- segundo cupón.
CREATE UNIQUE INDEX "discount_voucher_follow_ups_organization_id_automation_id_o_key" ON "discount_voucher_follow_ups"("organization_id", "automation_id", "opportunity_id");

-- CreateIndex
-- El índice de la COLA, mismo molde que qr_follow_ups_claimable_idx.
CREATE INDEX "discount_voucher_follow_ups_claimable_idx"
  ON "discount_voucher_follow_ups" ("next_attempt_at")
  WHERE "status" = 'PENDING'::"DiscountVoucherFollowUpStatus";

-- AddForeignKey
ALTER TABLE "discount_voucher_follow_ups" ADD CONSTRAINT "discount_voucher_follow_ups_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
-- Las cuatro NOT NULL -> RESTRICT (regla de 20260821140200): las cuatro
-- tablas padre usan soft delete.
ALTER TABLE "discount_voucher_follow_ups" ADD CONSTRAINT "discount_voucher_follow_ups_organization_id_automation_id_fkey" FOREIGN KEY ("organization_id", "automation_id") REFERENCES "automations"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_voucher_follow_ups" ADD CONSTRAINT "discount_voucher_follow_ups_organization_id_opportunity_id_fkey" FOREIGN KEY ("organization_id", "opportunity_id") REFERENCES "opportunities"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_voucher_follow_ups" ADD CONSTRAINT "discount_voucher_follow_ups_organization_id_contact_id_fkey" FOREIGN KEY ("organization_id", "contact_id") REFERENCES "contacts"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_voucher_follow_ups" ADD CONSTRAINT "discount_voucher_follow_ups_organization_id_branch_id_fkey" FOREIGN KEY ("organization_id", "branch_id") REFERENCES "branches"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
-- Nullable -> NO ACTION, el mismo par que
-- discount_vouchers.consumed_by_user_id. Usa el UNIQUE (organization_id, id)
-- que 20261006120000 dejó en discount_vouchers para esto.
ALTER TABLE "discount_voucher_follow_ups" ADD CONSTRAINT "discount_voucher_follow_ups_organization_id_discount_vouch_fkey" FOREIGN KEY ("organization_id", "discount_voucher_id") REFERENCES "discount_vouchers"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- RLS — el patrón de aislamiento uniforme de M-5 (20260901120000), el mismo
-- que qr_follow_ups y discount_vouchers. La tabla nace sin grants a
-- anon/authenticated (default privileges de 20260821140100/20260902150000);
-- la política es la segunda capa.
-- ---------------------------------------------------------------------------
alter table public.discount_voucher_follow_ups enable row level security;
drop policy if exists discount_voucher_follow_ups_isolation on public.discount_voucher_follow_ups;
create policy discount_voucher_follow_ups_isolation on public.discount_voucher_follow_ups
  for all
  using (organization_id = current_organization_id())
  with check (organization_id = current_organization_id());
