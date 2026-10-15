import type { Prisma } from "@prisma/client";
import { emitOutboxEvent } from "../../repositories/outboxEvent.repository";
import type { ServiceOrderStatus } from "../config/estados";
import {
  TRIGGER_ORDEN_CAMBIA_DE_ESTADO,
  TRIGGER_ORDEN_ENTREGADA,
  type PayloadDeLaOrden,
} from "./config";

/** Emite, en la transacción del cambio, `service_order.status_changed` y, si el
 *  destino es Entregado, además `service_order.delivered` (§3.3). Lo llaman
 *  el alta de la orden (`from` null) y el cambio de estado: si la transacción
 *  se revierte, no queda ningún evento. */
export async function emitirEventosDeLaOrden(
  orden: {
    organizationId: string;
    serviceOrderId: string;
    customerVehicleId: string;
    contactId: string;
    branchId: string;
    from: ServiceOrderStatus | null;
    to: ServiceOrderStatus;
    ahora: Date;
  },
  tx: Prisma.TransactionClient,
): Promise<void> {
  const payload: PayloadDeLaOrden = {
    serviceOrderId: orden.serviceOrderId,
    customerVehicleId: orden.customerVehicleId,
    contactId: orden.contactId,
    branchId: orden.branchId,
    from: orden.from,
    to: orden.to,
  };
  await emitOutboxEvent(
    { organizationId: orden.organizationId, eventType: TRIGGER_ORDEN_CAMBIA_DE_ESTADO, payload },
    tx,
  );
  if (orden.to === "ENTREGADO") {
    await emitOutboxEvent(
      {
        organizationId: orden.organizationId,
        eventType: TRIGGER_ORDEN_ENTREGADA,
        payload: { ...payload, deliveredAt: orden.ahora.toISOString() },
      },
      tx,
    );
  }
}
