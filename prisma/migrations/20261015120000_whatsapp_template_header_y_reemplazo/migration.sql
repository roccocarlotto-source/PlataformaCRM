-- ---------------------------------------------------------------------------
-- Formato del mensaje de las reglas de WhatsApp (QR y cupón) y la plantilla
-- integrada al formulario de la regla.
--
-- 1. header_format: la plantilla puede llevar la imagen del QR como encabezado
--    (IMAGE) o ninguno (NONE). Toda plantilla existente queda en NONE, que es
--    exactamente lo que es: solo texto. No cambia nada para Meta y ninguna
--    regla pide una aprobación nueva.
--
-- 2. Hasta DOS plantillas vivas por regla, y no una. Si el negocio cambia el
--    formato o el texto, hace falta una plantilla nueva en Meta, y mientras
--    Meta la revisa la regla sigue mandando con la aprobada anterior. Por eso
--    whatsapp_templates_automation_active_unique ("una viva por regla") se
--    parte en dos:
--      - whatsapp_templates_automation_approved_unique: a lo sumo UNA aprobada
--        por regla — la que usa el worker;
--      - whatsapp_templates_automation_candidate_unique: a lo sumo UNA en
--        revisión o rechazada por regla — la versión nueva.
--    Cuando Meta aprueba la nueva, la aprobada anterior se da de baja en la
--    misma transacción que la promueve (whatsappTemplate.repository.ts).
--
--    Los datos existentes ya cumplen las dos: había a lo sumo una viva por
--    regla. La creación no puede fallar por datos.
--
--    whatsapp_templates_name_active_unique NO cambia: el WABA es compartido y
--    el nombre sigue siendo único entre las vivas.
--
-- Aditiva para el código viejo: la imagen anterior no lee header_format y
-- sigue tomando "la aprobada" (findApprovedWhatsappTemplate). Orden de
-- siempre: migración primero, imagen nueva después (docs/deployment.md §2.2).
-- ---------------------------------------------------------------------------

-- CreateEnum
CREATE TYPE "WhatsappTemplateHeaderFormat" AS ENUM ('NONE', 'IMAGE');

-- AlterTable
ALTER TABLE "whatsapp_templates" ADD COLUMN "header_format" "WhatsappTemplateHeaderFormat" NOT NULL DEFAULT 'NONE';

-- DropIndex
DROP INDEX "whatsapp_templates_automation_active_unique";

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_templates_automation_approved_unique"
  ON "whatsapp_templates" ("organization_id", "automation_id")
  WHERE "deleted_at" IS NULL AND "status" = 'APPROVED';

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_templates_automation_candidate_unique"
  ON "whatsapp_templates" ("organization_id", "automation_id")
  WHERE "deleted_at" IS NULL AND "status" <> 'APPROVED';
