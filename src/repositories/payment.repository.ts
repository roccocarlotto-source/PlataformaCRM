import type { PaymentMethod, Prisma } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";

// ---------------------------------------------------------------------------
// Pago del cliente (§43 de docs/frontend-cambios-pendientes.md).
// organizationId en el WHERE de TODA lectura y escritura, igual que el resto
// de las entidades: la escritura misma es la garantía de aislamiento (M4), no
// el pre-check del service. Por eso update y delete son updateMany/deleteMany
// y no update/delete: estos últimos solo aceptan el id único.
// ---------------------------------------------------------------------------

// Orden del historial: cobro más nuevo primero. Dos pagos del mismo día se
// desempatan por created_at (el último cargado arriba) e id, para que el
// orden sea estable entre dos lecturas.
const newestFirst: Prisma.PaymentOrderByWithRelationInput[] = [
  { paidAt: "desc" },
  { createdAt: "desc" },
  { id: "desc" },
];

export function findPaymentsByOpportunity(
  organizationId: string,
  opportunityId: string,
  pagination: { skip: number; take: number },
  db: Db = prisma,
) {
  return db.payment.findMany({
    where: { organizationId, opportunityId },
    orderBy: newestFirst,
    skip: pagination.skip,
    take: pagination.take,
  });
}

export function countPaymentsByOpportunity(
  organizationId: string,
  opportunityId: string,
  db: Db = prisma,
) {
  return db.payment.count({ where: { organizationId, opportunityId } });
}

export function findPaymentById(id: string, organizationId: string, db: Db = prisma) {
  return db.payment.findFirst({ where: { id, organizationId } });
}

export interface CreatePaymentData {
  organizationId: string;
  opportunityId: string;
  amount: number;
  currency: string;
  method: PaymentMethod;
  paidAt: Date;
}

export function createPayment(data: CreatePaymentData, db: Db = prisma) {
  return db.payment.create({ data });
}

// Sin opportunityId ni currency: el pago no se muda de oportunidad y su moneda
// es la foto del momento de crearlo (ver el comentario del modelo).
export interface UpdatePaymentData {
  amount?: number;
  method?: PaymentMethod;
  paidAt?: Date;
}

export function updatePayment(
  id: string,
  organizationId: string,
  data: UpdatePaymentData,
  db: Db = prisma,
) {
  return db.payment.updateMany({ where: { id, organizationId }, data });
}

// DELETE físico (§43): un pago mal cargado se borra de verdad.
export function deletePayment(id: string, organizationId: string, db: Db = prisma) {
  return db.payment.deleteMany({ where: { id, organizationId } });
}
