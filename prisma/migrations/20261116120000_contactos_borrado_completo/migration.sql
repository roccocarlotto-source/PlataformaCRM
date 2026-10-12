-- ---------------------------------------------------------------------------
-- Borrado completo de los datos personales a pedido del titular
-- (docs/data-classification.md §5.2): cuándo y quién lo hizo, y lo que no se
-- pudo limpiar fuera de la base (los eventos de Google Calendar de sus turnos).
--
-- Tres columnas nullables y sin default: no reescriben la tabla. Los contactos
-- borrados antes de esta migración quedan con las tres en NULL (el CHECK lo
-- permite: los dos o ninguno).
--
-- FK compuesta a users (C-3): quien borró es de la misma organización.
-- Nullable -> NO ACTION (regla de 20260821140200). Nombre corto: el que arma
-- Prisma pasaría los 63 caracteres de Postgres.
-- ---------------------------------------------------------------------------

-- AlterTable
ALTER TABLE "contacts"
  ADD COLUMN "personal_data_erased_at" TIMESTAMP(3),
  ADD COLUMN "personal_data_erased_by_id" UUID,
  ADD COLUMN "personal_data_erase_pending" JSONB;

ALTER TABLE "contacts"
  ADD CONSTRAINT "contacts_personal_data_erased_check"
    CHECK ((personal_data_erased_at IS NULL) = (personal_data_erased_by_id IS NULL));

-- CreateIndex
CREATE INDEX "contacts_organization_id_personal_data_erased_by_id_idx" ON "contacts"("organization_id", "personal_data_erased_by_id");

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_personal_data_erased_by_fkey" FOREIGN KEY ("organization_id", "personal_data_erased_by_id") REFERENCES "users"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;
