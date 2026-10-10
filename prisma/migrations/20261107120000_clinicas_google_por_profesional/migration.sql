-- ---------------------------------------------------------------------------
-- PR R8 de docs/rubros.md (§15, §4.6, D4, D16-D18): un calendario de Google por
-- profesional de una clínica.
--
-- TODO ADITIVO Y NULLABLE. No reescribe ninguna fila existente y no toca las
-- columnas viejas de canal de google_calendar_connections (eso es R21, D18):
--   - resources.google_calendar_id: el calendario del profesional. Solo lo
--     escribe una clínica; NULL = sin calendario propio (como hoy).
--   - bookings.google_calendar_id: en qué calendario quedó el evento, cuando no
--     es el de la sede. NULL = el de la conexión, como toda reserva de hoy.
--   - google_calendar_channels.resource_id: el profesional dueño del canal. Las
--     filas de hoy (una por conexión, el calendario de la sede) quedan en NULL,
--     que es exactamente lo que son. FK compuesta NO ACTION (nullable, regla de
--     20260821140200).
--   - google_calendar_channels.last_error_at / last_error_message: el último
--     error del canal de ese calendario.
--
-- Ninguna conexión cambia y nadie tiene que reconectar: los canales vivos de
-- hoy siguen con el mismo channel_id y el mismo token firmado.
--
-- ORDEN DE DESPLIEGUE: esta migración va ANTES del código. El código viejo no
-- conoce las columnas (Prisma ignora lo que su cliente no conoce).
-- ---------------------------------------------------------------------------

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN "google_calendar_id" VARCHAR(255);

-- AlterTable
ALTER TABLE "google_calendar_channels" ADD COLUMN "last_error_at" TIMESTAMP(3),
ADD COLUMN "last_error_message" VARCHAR(500),
ADD COLUMN "resource_id" UUID;

-- AlterTable
ALTER TABLE "resources" ADD COLUMN "google_calendar_id" VARCHAR(255);

-- CreateIndex
CREATE INDEX "google_calendar_channels_organization_id_resource_id_idx" ON "google_calendar_channels"("organization_id", "resource_id");

-- AddForeignKey
ALTER TABLE "google_calendar_channels" ADD CONSTRAINT "google_calendar_channels_organization_id_resource_id_fkey" FOREIGN KEY ("organization_id", "resource_id") REFERENCES "resources"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;
