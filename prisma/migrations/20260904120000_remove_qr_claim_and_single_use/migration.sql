-- ---------------------------------------------------------------------------
-- Elimina el QR físico (claim) y el QR de un solo uso del módulo QR
-- (docs/qr-integration.md, sección "Qué se desvió del plan"). Decisión de
-- Rocco: el generador de QR queda como un link digital reusable por
-- sucursal; la fidelización automatizada se resuelve mandando ese link
-- directo desde el CRM (feature nueva, todavía sin construir), no con algo
-- para escanear. "Vamos a fondo": se borran columnas y el enum, no solo el
-- código que los usaba.
--
-- POR QUÉ ES SEGURO SIN BACKFILL: QR Reviews está en piloto sin negocios
-- reales dados de alta (decisión 4 original, docs/qr-integration.md) — nunca
-- existió una fila con branch_id NULL en producción. branch_id/name/
-- destination_url pasan a NOT NULL sin ningún UPDATE previo porque no hay
-- ninguna fila que lo necesite.
--
-- ORDEN: los dos CHECK que mencionan las columnas que se van, después la FK
-- compuesta que cambia de ON DELETE NO ACTION a RESTRICT (regla de
-- 20260821140200: columna referenciante nullable -> NO ACTION, NOT NULL ->
-- RESTRICT — branch_id pasa a NOT NULL en esta misma migración), después las
-- columnas, después el enum que ya no tiene ninguna columna que lo use, y
-- por último los NOT NULL.
-- ---------------------------------------------------------------------------

-- DropCheckConstraint
alter table public.qr_codes drop constraint if exists qr_codes_name_destination_iff_claimed;
alter table public.qr_codes drop constraint if exists qr_codes_used_at_only_single_use;

-- DropForeignKey (se recrea más abajo con ON DELETE RESTRICT)
ALTER TABLE "qr_codes" DROP CONSTRAINT "qr_codes_organization_id_branch_id_fkey";

-- DropColumn
ALTER TABLE "qr_codes" DROP COLUMN "qr_type",
DROP COLUMN "used_at",
DROP COLUMN "claimed_at";

-- DropEnum
DROP TYPE "QrType";

-- AlterTable: branch_id/name/destination_url ya no admiten null — el único
-- estado válido de una fila hoy es "reclamada" (ver nota de backfill arriba).
ALTER TABLE "qr_codes" ALTER COLUMN "branch_id" SET NOT NULL,
ALTER COLUMN "name" SET NOT NULL,
ALTER COLUMN "destination_url" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "qr_codes" ADD CONSTRAINT "qr_codes_organization_id_branch_id_fkey" FOREIGN KEY ("organization_id", "branch_id") REFERENCES "branches"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
