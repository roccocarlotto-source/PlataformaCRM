-- ---------------------------------------------------------------------------
-- Ítem 176 de docs/frontend-cambios-pendientes.md (rama
-- feat/cupon-descuento-modelo): el cupón de descuento de UN SOLO USO que se le
-- manda al cliente N días después de ganar una oportunidad. Este ítem es solo
-- el modelo y el canje; la emisión automática es el 177 y la pantalla de
-- escaneo del CRM el 178.
--
-- NO REABRE EL QR DE UN SOLO USO QUE SE ELIMINÓ EL 04/09
-- (20260904120000_remove_qr_claim_and_single_use). Aquel era un modo de
-- qr_codes para reseñas/fidelización, donde un link reusable alcanza. Esto es
-- una tabla nueva y separada, sin relación con qr_codes, para un caso que sí
-- necesita gastarse una sola vez de verdad. qr_codes no se toca.
--
-- TRES COSAS:
--
-- 1. discount_vouchers — dos estados guardados, ACTIVE y CONSUMED. "Vencido"
--    no es un estado: se deriva al leer de expires_at. El canje es un UPDATE
--    con `WHERE status = 'ACTIVE'`, lo que lo hace atómico bajo concurrencia
--    sin lock explícito.
--
-- 2. discount_vouchers (organization_id, id) UNIQUE — el que va a necesitar
--    la tabla de agendado del ítem 177 para su FK compuesta (C-3), mismo
--    patrón que qr_follow_ups -> qr_codes. id ya es PK, así que no puede
--    fallar.
--
-- 3. CHECK discount_vouchers_consumed_consistency_check — ACTIVE exige
--    consumed_at y consumed_by_user_id en NULL; CONSUMED exige los dos. Un
--    canje a medio escribir es imposible a nivel de motor.
--
-- Escrita a mano, no generada por `prisma migrate dev`: mismo motivo que el
-- resto de las migraciones desde 20260821 (la shadow database no tiene el
-- schema auth). Las sentencias de los puntos 1 y 2 son exactamente lo que
-- `prisma migrate diff` deriva del schema, para que no aparezca drift; el
-- CHECK y la RLS son lo que el DSL de Prisma no expresa.
--
-- Al diagnóstico (docs/auditoria-2026-08-21-diagnostico.sql) entran en este
-- mismo cambio: la política de aislamiento a la fila 5, el CHECK a la fila 8
-- (28 -> 29) y las cuatro FKs compuestas a la fila 16 (63 -> 67 FKs
-- conocidas).
-- ---------------------------------------------------------------------------

-- CreateEnum
CREATE TYPE "DiscountVoucherStatus" AS ENUM ('ACTIVE', 'CONSUMED');

-- CreateTable
CREATE TABLE "discount_vouchers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "opportunity_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "automation_id" UUID NOT NULL,
    "label" VARCHAR(200) NOT NULL,
    "status" "DiscountVoucherStatus" NOT NULL DEFAULT 'ACTIVE',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "consumed_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "discount_vouchers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "discount_vouchers_organization_id_opportunity_id_idx" ON "discount_vouchers"("organization_id", "opportunity_id");

-- CreateIndex
CREATE INDEX "discount_vouchers_organization_id_contact_id_idx" ON "discount_vouchers"("organization_id", "contact_id");

-- CreateIndex
CREATE INDEX "discount_vouchers_organization_id_automation_id_idx" ON "discount_vouchers"("organization_id", "automation_id");

-- CreateIndex
CREATE INDEX "discount_vouchers_organization_id_consumed_by_user_id_idx" ON "discount_vouchers"("organization_id", "consumed_by_user_id");

-- CreateIndex
-- El punto 2 del encabezado.
CREATE UNIQUE INDEX "discount_vouchers_organization_id_id_key" ON "discount_vouchers"("organization_id", "id");

-- AddForeignKey
ALTER TABLE "discount_vouchers" ADD CONSTRAINT "discount_vouchers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
-- Las tres compuestas NOT NULL -> RESTRICT (regla de 20260821140200). Las
-- tres tablas padre usan soft delete, así que la acción no se dispara en
-- ningún flujo del producto; si alguien introduce un borrado físico, que falle
-- ruidosamente en vez de dejar un cupón apuntando a la nada.
ALTER TABLE "discount_vouchers" ADD CONSTRAINT "discount_vouchers_organization_id_opportunity_id_fkey" FOREIGN KEY ("organization_id", "opportunity_id") REFERENCES "opportunities"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_vouchers" ADD CONSTRAINT "discount_vouchers_organization_id_contact_id_fkey" FOREIGN KEY ("organization_id", "contact_id") REFERENCES "contacts"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_vouchers" ADD CONSTRAINT "discount_vouchers_organization_id_automation_id_fkey" FOREIGN KEY ("organization_id", "automation_id") REFERENCES "automations"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
-- Nullable -> NO ACTION, el mismo par que deliveries.delivered_by_id.
ALTER TABLE "discount_vouchers" ADD CONSTRAINT "discount_vouchers_organization_id_consumed_by_user_id_fkey" FOREIGN KEY ("organization_id", "consumed_by_user_id") REFERENCES "users"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- CHECK — el punto 3 del encabezado. Tiene la forma (A AND B AND C) OR
-- (D AND E AND F), el mismo límite conocido del normalizador de la fila 8
-- que messages_sender_user_id_consistency_check.
-- ---------------------------------------------------------------------------
ALTER TABLE "discount_vouchers" ADD CONSTRAINT "discount_vouchers_consumed_consistency_check"
    CHECK (
      ("status" = 'ACTIVE' AND "consumed_at" IS NULL AND "consumed_by_user_id" IS NULL)
      OR ("status" = 'CONSUMED' AND "consumed_at" IS NOT NULL AND "consumed_by_user_id" IS NOT NULL)
    );

-- ---------------------------------------------------------------------------
-- RLS — el patrón de aislamiento uniforme de M-5 (20260901120000), el mismo
-- que qr_follow_ups: `for all` con USING y WITH CHECK sobre
-- current_organization_id(). La tabla nace sin grants a anon/authenticated
-- (default privileges de 20260821140100/20260902150000); la política es la
-- segunda capa.
-- ---------------------------------------------------------------------------
alter table public.discount_vouchers enable row level security;
drop policy if exists discount_vouchers_isolation on public.discount_vouchers;
create policy discount_vouchers_isolation on public.discount_vouchers
  for all
  using (organization_id = current_organization_id())
  with check (organization_id = current_organization_id());
