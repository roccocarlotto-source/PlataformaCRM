-- ---------------------------------------------------------------------------
-- "Crear cupón" a mano, desde la ficha del contacto o de la oportunidad. Hasta
-- acá un cupón solo nacía de la regla "Oportunidad ganada -> Enviar cupón de
-- descuento" (ítem 177), así que opportunity_id y automation_id eran NOT NULL.
--
-- CUATRO COSAS:
--
-- 1. opportunity_id y automation_id pasan a NULL: un cupón manual puede no
--    tener venta (se crea desde el contacto) y nunca tiene regla. Sus FKs
--    compuestas pasan de RESTRICT a NO ACTION, por la regla de
--    20260821140200 (NOT NULL -> RESTRICT, nullable -> NO ACTION).
--
-- 2. created_by_user_id: quién lo creó a mano. Nullable -> NO ACTION, el mismo
--    par que consumed_by_user_id.
--
-- 3. branch_id: la sucursal elegida al crearlo, de cuyo número de WhatsApp se
--    le manda ("Enviar por WhatsApp"). En un cupón de regla queda NULL: la
--    sucursal es la de la regla. Nullable -> NO ACTION.
--
-- 4. CHECK discount_vouchers_origin_check: un cupón sale de una regla o de una
--    persona. Las filas existentes tienen automation_id, así que lo cumplen.
--
-- Escrita a mano, como las demás desde 20260821 (la shadow database no tiene
-- el schema auth). Las sentencias de 1 a 3 son exactamente lo que
-- `prisma migrate diff` deriva del schema.
--
-- Aditiva para el código viejo: la imagen anterior siempre escribe los dos
-- campos que dejan de ser obligatorios, y no lee las columnas nuevas. Orden de
-- siempre: migración primero, imagen después.
-- ---------------------------------------------------------------------------

-- DropForeignKey
ALTER TABLE "discount_vouchers" DROP CONSTRAINT "discount_vouchers_organization_id_automation_id_fkey";

-- DropForeignKey
ALTER TABLE "discount_vouchers" DROP CONSTRAINT "discount_vouchers_organization_id_opportunity_id_fkey";

-- AlterTable
ALTER TABLE "discount_vouchers" ADD COLUMN     "branch_id" UUID,
ADD COLUMN     "created_by_user_id" UUID,
ALTER COLUMN "opportunity_id" DROP NOT NULL,
ALTER COLUMN "automation_id" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "discount_vouchers_organization_id_created_by_user_id_idx" ON "discount_vouchers"("organization_id", "created_by_user_id");

-- CreateIndex
CREATE INDEX "discount_vouchers_organization_id_branch_id_idx" ON "discount_vouchers"("organization_id", "branch_id");

-- AddForeignKey
ALTER TABLE "discount_vouchers" ADD CONSTRAINT "discount_vouchers_organization_id_opportunity_id_fkey" FOREIGN KEY ("organization_id", "opportunity_id") REFERENCES "opportunities"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_vouchers" ADD CONSTRAINT "discount_vouchers_organization_id_automation_id_fkey" FOREIGN KEY ("organization_id", "automation_id") REFERENCES "automations"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_vouchers" ADD CONSTRAINT "discount_vouchers_organization_id_created_by_user_id_fkey" FOREIGN KEY ("organization_id", "created_by_user_id") REFERENCES "users"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_vouchers" ADD CONSTRAINT "discount_vouchers_organization_id_branch_id_fkey" FOREIGN KEY ("organization_id", "branch_id") REFERENCES "branches"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- El punto 4 del encabezado.
ALTER TABLE "discount_vouchers" ADD CONSTRAINT "discount_vouchers_origin_check"
    CHECK ("automation_id" IS NOT NULL OR "created_by_user_id" IS NOT NULL);
