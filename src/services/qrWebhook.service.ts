import { Prisma, type QrSubscriptionStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { lockOrganizationForUpdate } from "../repositories/organization.repository";
import {
  createPaymentEvent,
  createQrSubscriptionStatusChange,
  findOrganizationByMercadopagoSubscriptionId,
  findOrganizationQrBilling,
  updateQrSubscriptionStatus,
} from "../repositories/qrBilling.repository";

// ---------------------------------------------------------------------------
// Webhook de MercadoPago (suscripciones "preapproval") — puerto de
// mercadopago-webhook/index.ts + la mitad de _shared/mercadopago.ts que no es
// firma (la firma vive en utils/mercadopagoSignature.ts) +
// record_mercadopago_status_change (0001 original). docs/qr-integration.md,
// Fase 2.
//
// SUPUESTO HEREDADO DEL ORIGINAL, no verificado contra un sandbox real: esto
// apunta al producto "preapproval" (suscripciones) de MercadoPago, matcheado
// con una Organization por qrMercadopagoSubscriptionId. Confirmar el mapeo de
// estados contra una integración real antes de confiar en él en producción.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Puras — exportadas para tests.
// ---------------------------------------------------------------------------

// AUD-05 original: preapprovalId (dataId) es input influenciado por un
// atacante (query string) — encodeURIComponent garantiza que solo pueda ocupar
// UN segmento de path después de `/preapproval/`, sea cual sea su formato
// real. No valida qué forma tiene un id de MercadoPago; hace imposible que el
// valor altere la estructura de la URL saliente (traversal, query, fragmento).
export function buildPreapprovalUrl(preapprovalId: string): string {
  return `https://api.mercadopago.com/preapproval/${encodeURIComponent(preapprovalId)}`;
}

// TF-005 original: la clave de idempotencia identifica a la NOTIFICACIÓN, nunca
// al recurso que describe. MercadoPago manda una notificación por transición
// de estado (authorized, después paused, después cancelled) y TODAS llevan el
// mismo `data.id` (el id del preapproval). Keyear por `data.id` haría que la
// segunda y la tercera transición real parecieran replays de la primera y se
// descartaran en silencio. El `id` de nivel superior del payload es único por
// entrega y es la clave correcta.
export function extractNotificationId(body: { id?: unknown }): string | null {
  if (body.id === undefined || body.id === null) return null;
  return String(body.id);
}

const ACTIVE_PREAPPROVAL_STATUSES = new Set(["authorized"]);
const INACTIVE_PREAPPROVAL_STATUSES = new Set(["cancelled", "paused"]);

export function mapPreapprovalStatus(preapprovalStatus: string): QrSubscriptionStatus | null {
  if (ACTIVE_PREAPPROVAL_STATUSES.has(preapprovalStatus)) {
    return "ACTIVE";
  }
  if (INACTIVE_PREAPPROVAL_STATUSES.has(preapprovalStatus)) {
    return "INACTIVE";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Re-fetch del recurso contra la API de MercadoPago. NUNCA se confía en el
// `status` que trae el payload del webhook (la firma no cubre el body — ver
// utils/mercadopagoSignature.ts): el recurso se vuelve a pedir con el access
// token, que es lo que la guía de MercadoPago indica.
//
// Inyectable (mismo criterio que el cliente de Google Calendar en
// googleCalendarSync.service.ts): los tests de integración pasan un doble y
// nunca hablan con MercadoPago.
// ---------------------------------------------------------------------------

export interface PreapprovalResource {
  id: string;
  status: string;
}

export type FetchPreapproval = (
  preapprovalId: string,
  accessToken: string,
) => Promise<PreapprovalResource>;

export const fetchPreapprovalReal: FetchPreapproval = async (preapprovalId, accessToken) => {
  const res = await fetch(buildPreapprovalUrl(preapprovalId), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`MercadoPago API returned ${res.status} for preapproval ${preapprovalId}`);
  }
  const body = (await res.json()) as { id?: unknown; status?: unknown };
  if (typeof body.id !== "string" || typeof body.status !== "string") {
    throw new Error(
      `MercadoPago API returned an unexpected preapproval shape for ${preapprovalId}`,
    );
  }
  return { id: body.id, status: body.status };
};

// ---------------------------------------------------------------------------
// Registro del cambio de estado — equivalente a record_mercadopago_status_change.
// ---------------------------------------------------------------------------

export type RecordMercadopagoStatusChangeResult =
  { outcome: "recorded"; statusChanged: boolean } | { outcome: "duplicate" };

// Transacción con lock sobre la organización, igual que el `for update` del
// original: el INSERT en el ledger va PRIMERO — si es una entrega repetida, el
// UNIQUE de mercadopagoEventId lo rechaza y la transacción entera se revierte
// sin haber tocado el estado. Recién después, y solo si el estado realmente
// cambia, se actualiza la organización y se escribe la auditoría (source =
// MERCADOPAGO_WEBHOOK, changedByPlatformAdminId = null: el CHECK
// qr_subscription_status_changes_changed_by_only_for_admin de Fase 1 exige
// exactamente eso).
export async function recordMercadopagoStatusChange(input: {
  organizationId: string;
  newStatus: QrSubscriptionStatus;
  mercadopagoEventId: string;
  eventType: string;
}): Promise<RecordMercadopagoStatusChangeResult> {
  try {
    return await prisma.$transaction(async (tx) => {
      await lockOrganizationForUpdate(input.organizationId, tx);

      const org = await findOrganizationQrBilling(input.organizationId, tx);
      if (!org) {
        // Inalcanzable en operación normal: el caller acaba de resolver la
        // organización por qrMercadopagoSubscriptionId. Error común y no
        // AppError, mismo criterio que lockOrganizationForUpdate.
        throw new Error(
          `recordMercadopagoStatusChange: no existe la organización ${input.organizationId}`,
        );
      }

      await createPaymentEvent(
        {
          mercadopagoEventId: input.mercadopagoEventId,
          organizationId: input.organizationId,
          eventType: input.eventType,
        },
        tx,
      );

      if (org.qrSubscriptionStatus === input.newStatus) {
        return { outcome: "recorded", statusChanged: false };
      }

      await updateQrSubscriptionStatus(input.organizationId, input.newStatus, tx);
      await createQrSubscriptionStatusChange(
        {
          organizationId: input.organizationId,
          previousStatus: org.qrSubscriptionStatus,
          newStatus: input.newStatus,
          source: "MERCADOPAGO_WEBHOOK",
          changedByPlatformAdminId: null,
          reason: null,
        },
        tx,
      );

      return { outcome: "recorded", statusChanged: true };
    });
  } catch (err) {
    // mercadopago_event_id es el único UNIQUE que este INSERT puede violar:
    // la notificación ya se procesó. MercadoPago reintenta entregas, así que
    // es un no-op esperado e idempotente, no un fallo.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { outcome: "duplicate" };
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Orquestación de una notificación ya firmada y ya parseada — los pasos 3 a 8
// de la guía, en ese orden exacto. Los pasos 1 y 2 (headers, firma) son del
// controller, porque ocurren ANTES de leer el body.
// ---------------------------------------------------------------------------

export type ProcessMercadopagoNotificationResult =
  | {
      outcome: "ignored";
      reason: "event_type" | "unmapped_status" | "no_linked_organization";
      status?: string;
    }
  | { outcome: "missing_notification_id" }
  | { outcome: "duplicate" }
  | { outcome: "ok"; statusChanged: boolean };

export async function processMercadopagoNotification(input: {
  dataId: string;
  body: { id?: unknown; type?: unknown };
  accessToken: string;
  fetchPreapproval: FetchPreapproval;
}): Promise<ProcessMercadopagoNotificationResult> {
  if (input.body.type !== "subscription_preapproval") {
    // Firmada correctamente pero no es un evento sobre el que esta integración
    // actúe — un no-op intencional, no un error.
    return { outcome: "ignored", reason: "event_type" };
  }

  const notificationId = extractNotificationId(input.body);
  if (!notificationId) {
    return { outcome: "missing_notification_id" };
  }

  const preapproval = await input.fetchPreapproval(input.dataId, input.accessToken);

  const newStatus = mapPreapprovalStatus(preapproval.status);
  if (!newStatus) {
    return { outcome: "ignored", reason: "unmapped_status", status: preapproval.status };
  }

  const organization = await findOrganizationByMercadopagoSubscriptionId(preapproval.id);
  if (!organization) {
    return { outcome: "ignored", reason: "no_linked_organization" };
  }

  const recorded = await recordMercadopagoStatusChange({
    organizationId: organization.id,
    newStatus,
    mercadopagoEventId: notificationId,
    eventType: preapproval.status,
  });

  if (recorded.outcome === "duplicate") {
    return { outcome: "duplicate" };
  }
  return { outcome: "ok", statusChanged: recorded.statusChanged };
}
