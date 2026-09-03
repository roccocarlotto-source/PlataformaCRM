import type { QrSubscriptionChangeSource, QrSubscriptionStatus } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";

// ---------------------------------------------------------------------------
// Estado de suscripción del módulo QR y sus tablas de auditoría — módulo QR
// (docs/qr-integration.md, Fase 2). Portado de 0001/0004 del original: el
// "business" desapareció como tabla, sus atributos de facturación viven en
// Organization.
//
// NINGUNA de estas escrituras se llama fuera de una transacción que ya tomó
// lockOrganizationForUpdate: el estado de suscripción y su contador de
// auditoría se deciden sobre un valor leído, y sin serializar dos webhooks (o
// un webhook y un platform admin) se pisarían. Por eso las funciones reciben
// `db` sin default donde la escritura es parte de una secuencia.
// ---------------------------------------------------------------------------

export function findOrganizationQrBilling(organizationId: string, db: Db = prisma) {
  return db.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, qrSubscriptionStatus: true, qrBillingExempt: true },
  });
}

export function findOrganizationByMercadopagoSubscriptionId(
  qrMercadopagoSubscriptionId: string,
  db: Db = prisma,
) {
  return db.organization.findUnique({
    where: { qrMercadopagoSubscriptionId },
    select: { id: true },
  });
}

// Contador durable de display_number (DEC-064/066 original): se incrementa
// dentro de la misma transacción con lock que el claim/create, y devuelve el
// número que le toca a ESE QR. No es una sequence de Postgres a propósito —
// nextval() no es transaccional y quemaría un número aunque la transacción
// haga rollback (ver el comentario del campo en prisma/schema.prisma).
export async function assignNextQrDisplayNumber(organizationId: string, db: Db): Promise<number> {
  const updated = await db.organization.update({
    where: { id: organizationId },
    data: { nextQrDisplayNumber: { increment: 1 } },
    select: { nextQrDisplayNumber: true },
  });
  return updated.nextQrDisplayNumber - 1;
}

export function updateQrSubscriptionStatus(
  organizationId: string,
  qrSubscriptionStatus: QrSubscriptionStatus,
  db: Db,
) {
  return db.organization.update({
    where: { id: organizationId },
    data: { qrSubscriptionStatus },
    select: { id: true },
  });
}

export function updateQrBillingExempt(organizationId: string, qrBillingExempt: boolean, db: Db) {
  return db.organization.update({
    where: { id: organizationId },
    data: { qrBillingExempt },
    select: { id: true },
  });
}

// Ledger de idempotencia del webhook (D7 original). mercadopagoEventId es
// UNIQUE: la violación de unicidad ES la barrera de idempotencia, no un
// chequeo previo — un SELECT antes del INSERT dejaría una ventana entre dos
// entregas concurrentes de la misma notificación.
export function createPaymentEvent(
  data: { mercadopagoEventId: string; organizationId: string | null; eventType: string },
  db: Db,
) {
  return db.paymentEvent.create({ data });
}

export function createQrSubscriptionStatusChange(
  data: {
    organizationId: string;
    previousStatus: QrSubscriptionStatus;
    newStatus: QrSubscriptionStatus;
    source: QrSubscriptionChangeSource;
    changedByPlatformAdminId: string | null;
    reason: string | null;
  },
  db: Db,
) {
  return db.qrSubscriptionStatusChange.create({ data });
}

export function createQrBillingExemptionChange(
  data: {
    organizationId: string;
    previousValue: boolean;
    newValue: boolean;
    changedByPlatformAdminId: string;
    reason: string;
  },
  db: Db,
) {
  return db.qrBillingExemptionChange.create({ data });
}

export function findPlatformAdminByUserId(userId: string, db: Db = prisma) {
  return db.platformAdmin.findUnique({ where: { userId } });
}
