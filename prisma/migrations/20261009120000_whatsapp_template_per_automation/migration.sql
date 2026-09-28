-- ---------------------------------------------------------------------------
-- Ítem 181 de docs/frontend-cambios-pendientes.md (rama
-- feat/plantilla-whatsapp-por-automatizacion): la plantilla de WhatsApp pasa
-- a ser de cada REGLA de automatización, no de la organización. Con dos reglas
-- que mandan WhatsApp en la misma organización (el QR de reseñas del 159 y el
-- cupón de descuento del 177), una sola plantilla no alcanza: el texto de una
-- le queda mal a la otra.
--
-- TRES COSAS:
--
-- 1. whatsapp_templates.automation_id (NOT NULL) — la regla que manda con
--    esta plantilla. FK compuesta (organization_id, automation_id) ->
--    automations (organization_id, id), RESTRICT: el mismo patrón que
--    qr_follow_ups y discount_voucher_follow_ups (C-3), así la regla tiene que
--    ser de la misma organización. RESTRICT no molesta en la práctica: las
--    automatizaciones se borran con soft delete.
--
-- 2. whatsapp_templates_org_active_unique -> whatsapp_templates_automation_
--    active_unique: a lo sumo UNA activa por (organización, regla), en lugar
--    de una por organización. Sirve además el EXISTS del reclamo de las dos
--    colas (claimNextQrFollowUp, claimNextDiscountVoucherFollowUp), que ahora
--    pregunta por la regla que agendó la fila.
--
-- 3. whatsapp_templates_name_active_unique NO cambia: el WABA de Meta sigue
--    compartido entre organizaciones, y ahí el nombre identifica a la
--    plantilla.
--
-- SIN BACKFILL, A PROPÓSITO. No hay forma automática de saber a qué regla
-- pertenecía una plantilla creada cuando el concepto era "una por
-- organización". El SET NOT NULL FALLA si la tabla tiene filas (activas o
-- borradas) sin automation_id: mejor que el deploy se frene a que se inventen
-- asignaciones. En un entorno con datos reales, antes del deploy se agrega la
-- columna nullable, se completa a mano asignando cada plantilla a la regla
-- opportunity.send_qr_followup de su organización (el único caso que existía
-- antes de este ítem) y recién ahí se corre esta migración (ver "Cómo se
-- aplica" en el ítem 181). En el Supabase local la tabla estaba vacía al
-- escribirla.
--
-- Escrita a mano, no generada por `prisma migrate dev`: mismo motivo que el
-- resto de las migraciones desde 20260821 (la shadow database no tiene el
-- schema auth). El ALTER de la columna y la FK son exactamente lo que `prisma
-- migrate diff` deriva del schema, para que no aparezca drift; los índices
-- parciales son lo que el DSL de Prisma no expresa.
--
-- Al diagnóstico (docs/auditoria-2026-08-21-diagnostico.sql) entran en este
-- mismo cambio: el índice nuevo reemplaza al viejo en la fila 7 (siguen
-- siendo 12) y la FK compuesta nueva a la fila 16 (74 -> 75).
--
-- La imagen vieja contra este esquema lee bien (ignora la columna), pero su
-- alta de plantilla falla (inserta sin automation_id) y su reclamo acepta
-- la plantilla de cualquier regla de la organización: la imagen nueva se
-- deploya junto con la migración, sin ventana larga entre las dos.
-- ---------------------------------------------------------------------------

-- AlterTable
-- En dos pasos y con IF NOT EXISTS, y no el ADD COLUMN ... NOT NULL de una
-- que da `prisma migrate diff` (el estado final es el mismo, sin drift): así
-- el procedimiento manual del encabezado —agregar la columna, completarla y
-- recién después correr esta migración— no choca con "la columna ya existe".
-- Si quedó alguna fila sin completar, el SET NOT NULL falla y frena el deploy.
ALTER TABLE "whatsapp_templates" ADD COLUMN IF NOT EXISTS "automation_id" UUID;
ALTER TABLE "whatsapp_templates" ALTER COLUMN "automation_id" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "whatsapp_templates" ADD CONSTRAINT "whatsapp_templates_organization_id_automation_id_fkey" FOREIGN KEY ("organization_id", "automation_id") REFERENCES "automations"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- DropIndex
DROP INDEX "whatsapp_templates_org_active_unique";

-- CreateIndex
-- El punto 2 del encabezado.
CREATE UNIQUE INDEX "whatsapp_templates_automation_active_unique"
  ON "whatsapp_templates" ("organization_id", "automation_id")
  WHERE "deleted_at" IS NULL;
