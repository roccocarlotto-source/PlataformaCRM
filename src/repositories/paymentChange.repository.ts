import { Prisma, type PaymentChangeAction } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";

// ---------------------------------------------------------------------------
// Historial de pagos (PaymentChange, PR-17b). Solo payment.service escribe
// acá, en la misma transacción que el cambio del pago. Ver el comentario del
// modelo en schema.prisma.
// ---------------------------------------------------------------------------

// La foto de un pago en el historial: strings, para que el JSON guardado no
// dependa de cómo serializa Prisma un Decimal o una fecha. type y no
// interface: Prisma lo pide asignable a un objeto JSON (firma de índice).
export type FotoDePago = {
  amount: string;
  currency: string;
  method: string;
  paidAt: string;
};

export interface CreatePaymentChangeData {
  organizationId: string;
  opportunityId: string;
  paymentId: string;
  action: PaymentChangeAction;
  changedById: string;
  before: FotoDePago | null;
  after: FotoDePago | null;
}

export function createPaymentChange(data: CreatePaymentChangeData, db: Db = prisma) {
  return db.paymentChange.create({
    data: {
      ...data,
      // Json? de Prisma: null de JS no se acepta; Prisma.DbNull es el NULL de
      // la columna, que es lo que afirma el CHECK de la migración.
      before: data.before ?? Prisma.DbNull,
      after: data.after ?? Prisma.DbNull,
    },
  });
}

export function findPaymentChangesByOpportunity(
  organizationId: string,
  opportunityId: string,
  pagination: { skip: number; take: number },
  db: Db = prisma,
) {
  return db.paymentChange.findMany({
    where: { organizationId, opportunityId },
    orderBy: [{ changedAt: "desc" }, { id: "desc" }],
    skip: pagination.skip,
    take: pagination.take,
    include: { changedBy: { select: { id: true, fullName: true } } },
  });
}

export function countPaymentChangesByOpportunity(
  organizationId: string,
  opportunityId: string,
  db: Db = prisma,
) {
  return db.paymentChange.count({ where: { organizationId, opportunityId } });
}
