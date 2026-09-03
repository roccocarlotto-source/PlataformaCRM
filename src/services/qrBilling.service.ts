import type { QrSubscriptionStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { lockOrganizationForUpdate } from "../repositories/organization.repository";
import {
  createQrBillingExemptionChange,
  createQrSubscriptionStatusChange,
  findOrganizationQrBilling,
  updateQrBillingExempt,
  updateQrSubscriptionStatus,
} from "../repositories/qrBilling.repository";
import { AppError } from "../utils/AppError";

// ---------------------------------------------------------------------------
// Activación manual del módulo QR por un platform admin — puerto de
// admin_set_subscription_status (0001 original, D8/D9/D10) y
// set_billing_exemption (0004, DEC-057..062). docs/qr-integration.md, Fase 2.
//
// LA AUTORIZACIÓN NO VIVE ACÁ: la hace requirePlatformAdmin antes del
// controller (el equivalente del `if not exists (select 1 from platform_admins
// where user_id = auth.uid())` que el original repetía en cada función). Lo
// que este service recibe es un platformAdminUserId ya verificado, y lo
// escribe en la fila de auditoría — obligatorio por el CHECK
// qr_subscription_status_changes_changed_by_only_for_admin de Fase 1 (y por el
// NOT NULL de qr_billing_exemption_changes).
//
// El 404 rápido de afuera es UX; la defensa es el lock: dos platform admins, o
// un platform admin y el webhook de MercadoPago, decidiendo sobre el mismo
// estado se serializan en la fila de la organización.
// ---------------------------------------------------------------------------

const ORGANIZACION_NO_ENCONTRADA = "Organización no encontrada";

async function getOrganizationQrBillingOrThrow(organizationId: string) {
  const org = await findOrganizationQrBilling(organizationId);
  if (!org) {
    throw new AppError(ORGANIZACION_NO_ENCONTRADA, 404);
  }
  return org;
}

export interface AdminSetQrSubscriptionStatusInput {
  organizationId: string;
  newStatus: QrSubscriptionStatus;
  reason: string | null;
  platformAdminUserId: string;
}

// Toda llamada autorizada se audita, AUNQUE el estado no cambie (p. ej.
// confirmar "sigue activa") — diferencia deliberada respecto del camino del
// webhook, que solo registra transiciones reales. Es lo que hacía el original.
export async function adminSetQrSubscriptionStatus(input: AdminSetQrSubscriptionStatusInput) {
  await getOrganizationQrBillingOrThrow(input.organizationId);

  return prisma.$transaction(async (tx) => {
    await lockOrganizationForUpdate(input.organizationId, tx);

    const org = await findOrganizationQrBilling(input.organizationId, tx);
    if (!org) {
      throw new AppError(ORGANIZACION_NO_ENCONTRADA, 404);
    }

    if (org.qrSubscriptionStatus !== input.newStatus) {
      await updateQrSubscriptionStatus(input.organizationId, input.newStatus, tx);
    }

    return createQrSubscriptionStatusChange(
      {
        organizationId: input.organizationId,
        previousStatus: org.qrSubscriptionStatus,
        newStatus: input.newStatus,
        source: "PLATFORM_ADMIN",
        changedByPlatformAdminId: input.platformAdminUserId,
        reason: input.reason,
      },
      tx,
    );
  });
}

export interface SetQrBillingExemptionInput {
  organizationId: string;
  newValue: boolean;
  reason: string;
  platformAdminUserId: string;
}

// reason es obligatorio y no vacío, y lo valida el controller (Zod) ANTES de
// llegar acá — el NOT NULL de la columna es defensa en profundidad, no la única
// guarda (DEC-061). Se audita aunque newValue sea igual al valor actual
// (DEC-062: el operador lo confirmó, queda dicho por qué).
export async function setQrBillingExemption(input: SetQrBillingExemptionInput) {
  await getOrganizationQrBillingOrThrow(input.organizationId);

  return prisma.$transaction(async (tx) => {
    await lockOrganizationForUpdate(input.organizationId, tx);

    const org = await findOrganizationQrBilling(input.organizationId, tx);
    if (!org) {
      throw new AppError(ORGANIZACION_NO_ENCONTRADA, 404);
    }

    await updateQrBillingExempt(input.organizationId, input.newValue, tx);

    return createQrBillingExemptionChange(
      {
        organizationId: input.organizationId,
        previousValue: org.qrBillingExempt,
        newValue: input.newValue,
        changedByPlatformAdminId: input.platformAdminUserId,
        reason: input.reason,
      },
      tx,
    );
  });
}
