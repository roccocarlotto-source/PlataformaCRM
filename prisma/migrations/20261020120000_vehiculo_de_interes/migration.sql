-- ---------------------------------------------------------------------------
-- "Vehículo de interés" en el contacto (F2 de la prueba en vivo del 29/09):
-- la unidad del stock que le interesa al cliente, separada de una oportunidad
-- y de una reserva. Hasta acá solo existía el texto libre
-- lead_service_of_interest, y la unidad de una oportunidad (que la reserva).
--
-- TRES COSAS:
--
-- 1. contacts.vehicle_of_interest_id, con FK compuesta a vehicles. Nullable ->
--    NO ACTION (regla de 20260821140200). vehicles usa soft delete, así que
--    una unidad dada de baja o vendida sigue apuntada: la ficha la muestra con
--    su estado.
--
-- 2. contacts.vehicle_of_interest_set_by (enum VehicleInterestSource): quién
--    la cargó, una persona o el agente. El agente no pisa la de una persona.
--
-- 3. CHECK contacts_vehicle_of_interest_set_by_check: los dos o ninguno.
--
-- Escrita a mano, como las demás desde 20260821. Las sentencias de 1 y 2 son
-- exactamente lo que `prisma migrate diff` deriva del schema.
--
-- ORDEN: aditiva (columnas nuevas nullable). Migración primero, imagen
-- después, como siempre.
-- ---------------------------------------------------------------------------

-- CreateEnum
CREATE TYPE "VehicleInterestSource" AS ENUM ('HUMAN', 'AGENT');

-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "vehicle_of_interest_id" UUID,
ADD COLUMN     "vehicle_of_interest_set_by" "VehicleInterestSource";

-- CreateIndex
CREATE INDEX "contacts_organization_id_vehicle_of_interest_id_idx" ON "contacts"("organization_id", "vehicle_of_interest_id");

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_organization_id_vehicle_of_interest_id_fkey" FOREIGN KEY ("organization_id", "vehicle_of_interest_id") REFERENCES "vehicles"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- El punto 3.
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_vehicle_of_interest_set_by_check"
    CHECK (("vehicle_of_interest_id" IS NULL) = ("vehicle_of_interest_set_by" IS NULL));
