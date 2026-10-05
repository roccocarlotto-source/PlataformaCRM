-- ---------------------------------------------------------------------------
-- Unir contactos duplicados (contactMerge.service.ts). El contacto que se une
-- a otro no se borra: queda con soft delete (deleted_at) y una referencia al
-- que lo absorbió, para auditoría.
--
-- DOS COSAS:
--
-- 1. contacts.merged_into_id, autorreferencia compuesta (organization_id,
--    merged_into_id) -> contacts(organization_id, id). Nullable -> NO ACTION
--    (regla de 20260821140200). Con su índice del lado referenciante.
--
-- 2. CHECK contacts_merged_into_check: solo un contacto dado de baja puede
--    estar unido a otro, y nunca a sí mismo.
--
-- Escrita a mano, como las demás desde 20260821. Las sentencias del punto 1
-- son exactamente lo que `prisma migrate diff` deriva del schema.
--
-- ORDEN: aditiva (columna nueva nullable). Migración primero, imagen después.
-- ---------------------------------------------------------------------------

-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "merged_into_id" UUID;

-- CreateIndex
CREATE INDEX "contacts_organization_id_merged_into_id_idx" ON "contacts"("organization_id", "merged_into_id");

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_organization_id_merged_into_id_fkey" FOREIGN KEY ("organization_id", "merged_into_id") REFERENCES "contacts"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- El punto 2.
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_merged_into_check"
    CHECK ("merged_into_id" IS NULL OR ("deleted_at" IS NOT NULL AND "merged_into_id" <> "id"));
