-- ---------------------------------------------------------------------------
-- El módulo QR deja de facturarse aparte: viene incluido con la cuenta
-- (ítem 135 de docs/frontend-cambios-pendientes.md; D-02/F-08 de
-- docs/auditoria-2026-09-24-punta-a-punta.md).
--
-- QUÉ HABÍA. Desde 20260903120000_qr_integration el QR solo redirigía si la
-- organización tenía qr_subscription_status = 'ACTIVE' (lo movía el webhook de
-- MercadoPago o un platform admin) o qr_billing_exempt = true (solo un
-- platform admin). El default era INACTIVE, así que toda cuenta nueva tenía
-- el módulo QR apagado sin ningún camino para activarlo por su cuenta.
--
-- QUÉ PASA AHORA. Decisión de producto de Rocco: el QR viene incluido, sin
-- suscripción aparte. Todo QR no borrado redirige; el backend ya no lee
-- ninguna de estas columnas ni escribe ninguna de estas tablas, y el webhook
-- y los endpoints de platform admin que las movían se retiraron en el mismo
-- cambio. Ver docs/qr-integration.md, "Changelog".
--
-- DATOS QUE SE PIERDEN. Consulta de solo lectura contra producción del
-- 2026-09-25, antes de escribir esta migración: qr_payment_events 0 filas,
-- qr_subscription_status_changes 0 filas, qr_billing_exemption_changes 1 fila
-- (la verificación end-to-end del PR #155, sobre la organización de prueba
-- "Mi Empresa"); ninguna organización con qr_subscription_status ACTIVE ni
-- con qr_mercadopago_subscription_id, y una sola con qr_billing_exempt true
-- (la misma de prueba). Ningún dato comercial real.
--
-- ORDEN EN PRODUCCIÓN: IMAGEN NUEVA PRIMERO, ESTA MIGRACIÓN DESPUÉS — al revés
-- de lo habitual. La imagen vieja lee estas columnas (en /qr/resolve y en toda
-- lectura de organizations sin select) y respondería 500; la nueva no las
-- nombra y funciona igual contra el esquema viejo. Ver docs/deployment.md §2.2.
--
-- platform_admins QUEDA: además de la activación del QR (que se va) la usan
-- requirePlatformAdmin y GET /api/me.
--
-- Escrita a mano y no con `prisma migrate diff` tal cual: el diff también
-- propone dropear los índices GIN gin_trgm_ops de búsqueda, que viven fuera
-- del DSL de Prisma a propósito (ALTO-7) y no tienen nada que ver con esto.
--
-- Los DROP TABLE se llevan sus FKs, sus políticas/RLS y el CHECK
-- qr_subscription_status_changes_changed_by_only_for_admin. El DROP COLUMN
-- de qr_mercadopago_subscription_id se lleva su índice único. Los tipos van
-- al final: los usaban las columnas y tablas de arriba.
-- ---------------------------------------------------------------------------

-- DropTable
DROP TABLE "qr_payment_events";

-- DropTable
DROP TABLE "qr_subscription_status_changes";

-- DropTable
DROP TABLE "qr_billing_exemption_changes";

-- AlterTable
ALTER TABLE "organizations" DROP COLUMN "qr_subscription_status",
DROP COLUMN "qr_mercadopago_subscription_id",
DROP COLUMN "qr_billing_exempt";

-- DropEnum
DROP TYPE "QrSubscriptionChangeSource";

-- DropEnum
DROP TYPE "QrSubscriptionStatus";
