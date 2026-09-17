import type { Prisma } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";

// ---------------------------------------------------------------------------
// Entrega (§40 de docs/frontend-cambios-pendientes.md). organizationId en el
// WHERE de TODA lectura y escritura, igual que el resto de las entidades: la
// escritura misma es la garantía de aislamiento (M4), no el pre-check del
// service.
// ---------------------------------------------------------------------------

// Lo que la ficha de la oportunidad muestra junto a la entrega: quién la
// confirmó y qué unidad se entregó (la FOTO de vehicleId, ver schema.prisma).
// Solo campos de exhibición — nunca los precios internos del vehículo, mismo
// recorte que quoteInclude.
export const deliveryInclude = {
  deliveredBy: { select: { id: true, fullName: true } },
  vehicle: {
    select: {
      id: true,
      internalCode: true,
      make: true,
      model: true,
      trim: true,
      year: true,
      status: true,
    },
  },
} satisfies Prisma.DeliveryInclude;

export interface DeliveryChecklistItem {
  label: string;
  checked: boolean;
}

function asJson(checklist: readonly DeliveryChecklistItem[]) {
  return checklist as unknown as Prisma.InputJsonValue;
}

export function findDeliveryById(id: string, organizationId: string, db: Db = prisma) {
  return db.delivery.findFirst({ where: { id, organizationId }, include: deliveryInclude });
}

// A lo sumo una fila, por el UNIQUE (organization_id, opportunity_id).
export function findDeliveryByOpportunity(
  organizationId: string,
  opportunityId: string,
  db: Db = prisma,
) {
  return db.delivery.findFirst({
    where: { organizationId, opportunityId },
    include: deliveryInclude,
  });
}

export interface CreateDeliveryData {
  organizationId: string;
  opportunityId: string;
  vehicleId: string;
  checklist: readonly DeliveryChecklistItem[];
}

// Nace PENDING (default de la columna). Solo la llama delivery.service.ts,
// desde la transacción de opportunity.service.ts que mueve la unidad a SOLD.
export function createDelivery(data: CreateDeliveryData, db: Db) {
  return db.delivery.create({
    data: { ...data, checklist: asJson(data.checklist) },
  });
}

export interface UpdatePendingDeliveryData {
  checklist?: readonly DeliveryChecklistItem[];
  scheduledAt?: Date | null;
}

// Editar checklist/fecha programada: solo mientras sigue PENDING,
// condicionado en la escritura misma. Una entrega que alguien confirmó entre
// el pre-check y este UPDATE da count 0 y no se pisa — una vez DELIVERED es
// un registro histórico. Mismo contrato que updateDraftQuoteContent.
export function updatePendingDelivery(
  id: string,
  organizationId: string,
  data: UpdatePendingDeliveryData,
  db: Db = prisma,
) {
  const { checklist, ...rest } = data;
  return db.delivery.updateMany({
    where: { id, organizationId, status: "PENDING" },
    data: {
      ...rest,
      ...(checklist !== undefined ? { checklist: asJson(checklist) } : {}),
    },
  });
}

// "Confirmar entrega" como compare-and-swap, mismo contrato que
// transitionQuoteConditional: PENDING -> DELIVERED solo si sigue PENDING en
// el momento exacto del UPDATE, y en la misma escritura quién y cuándo.
// `count === 0` significa que otra escritura ganó; el caller SIEMPRE verifica
// count.
export function confirmDeliveryConditional(
  id: string,
  organizationId: string,
  data: { deliveredById: string; deliveredAt: Date },
  db: Db = prisma,
) {
  return db.delivery.updateMany({
    where: { id, organizationId, status: "PENDING" },
    data: { status: "DELIVERED", ...data },
  });
}
