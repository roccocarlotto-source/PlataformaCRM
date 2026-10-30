import type { Payment, PaymentMethod } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { findOpportunityById } from "../repositories/opportunity.repository";
import {
  countPaymentsByOpportunity,
  createPayment as createPaymentRepo,
  deletePayment as deletePaymentRepo,
  findPaymentById,
  findPaymentsByOpportunity,
  lockPaymentForUpdate,
  updatePayment as updatePaymentRepo,
} from "../repositories/payment.repository";
import {
  countPaymentChangesByOpportunity,
  createPaymentChange,
  findPaymentChangesByOpportunity,
  type FotoDePago,
} from "../repositories/paymentChange.repository";
import { AppError } from "../utils/AppError";

// ---------------------------------------------------------------------------
// Pago del cliente (§43 de docs/frontend-cambios-pendientes.md).
//
// Un historial de cobros por oportunidad, cargado a mano. PURAMENTE
// INFORMATIVO: nada de acá toca la oportunidad, la entrega ni el outbox, y
// ningún otro flujo lee los pagos para decidir algo. Mismo criterio que
// Permuta (§41) y el detalle de financiación (§42).
//
// Sin reglas de estado, así que sin compare-and-swap (a diferencia de
// quote.service.ts): no hay invariante entre filas que dos escrituras
// concurrentes puedan romper. El único lock es el del historial (abajo), para
// que la foto "antes" sea la real. Crear un pago mientras alguien elimina la
// oportunidad deja un pago colgado de una oportunidad borrada — inalcanzable
// igual que sus cotizaciones (requireReachablePayment), y la FK sigue
// sosteniendo que la oportunidad exista.
//
// currency es una FOTO: la pone createPayment desde la oportunidad, nunca el
// cliente, y nadie la edita después.
//
// HISTORIAL (PR-17b): cada alta, corrección y borrado deja una fila en
// payment_changes con quién (actorUserId), cuándo y la foto del pago antes y
// después, en la MISMA transacción que el cambio: o quedan los dos o ninguno.
// La corrección y el borrado leen el "antes" con la fila bloqueada
// (lockPaymentForUpdate). Una corrección que no cambia nada no deja fila.
// ---------------------------------------------------------------------------

// 404 si la oportunidad no existe, es de otra organización o está eliminada.
// Mismo helper que quote.service.ts: los pagos son un sub-recurso de la
// oportunidad.
async function requireOpportunity(organizationId: string, opportunityId: string) {
  const opportunity = await findOpportunityById(opportunityId, organizationId);
  if (!opportunity) {
    throw new AppError("Oportunidad no encontrada", 404);
  }
  return opportunity;
}

// Un pago de una oportunidad eliminada deja de ser alcanzable por id, igual
// que no aparece en ningún historial: el mismo 404 que un id inexistente.
// Mismo criterio que requireReachableQuote.
async function requireReachablePayment(organizationId: string, id: string) {
  const payment = await findPaymentById(id, organizationId);
  if (!payment) {
    throw new AppError("Pago no encontrado", 404);
  }
  const opportunity = await findOpportunityById(payment.opportunityId, organizationId);
  if (!opportunity) {
    throw new AppError("Pago no encontrado", 404);
  }
  return payment;
}

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

export interface ListPaymentsParams {
  opportunityId: string;
  page: number;
  pageSize: number;
}

export async function listPaymentsByOpportunity(
  organizationId: string,
  params: ListPaymentsParams,
) {
  const { opportunityId, page, pageSize } = params;
  await requireOpportunity(organizationId, opportunityId);

  const skip = (page - 1) * pageSize;
  const [data, total] = await Promise.all([
    findPaymentsByOpportunity(organizationId, opportunityId, { skip, take: pageSize }),
    countPaymentsByOpportunity(organizationId, opportunityId),
  ]);

  return {
    data,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
    },
  };
}

export function getPaymentById(organizationId: string, id: string) {
  return requireReachablePayment(organizationId, id);
}

// El historial de pagos de una oportunidad, más reciente primero. Incluye los
// de pagos ya borrados: el historial es de la oportunidad, no del pago.
export async function listPaymentChangesByOpportunity(
  organizationId: string,
  params: ListPaymentsParams,
) {
  const { opportunityId, page, pageSize } = params;
  await requireOpportunity(organizationId, opportunityId);

  const skip = (page - 1) * pageSize;
  const [data, total] = await Promise.all([
    findPaymentChangesByOpportunity(organizationId, opportunityId, { skip, take: pageSize }),
    countPaymentChangesByOpportunity(organizationId, opportunityId),
  ]);

  return {
    data,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
    },
  };
}

// La foto de un pago para el historial. Exportada para el test sin base.
export function fotoDelPago(
  payment: Pick<Payment, "amount" | "currency" | "method" | "paidAt">,
): FotoDePago {
  return {
    amount: payment.amount.toFixed(2),
    currency: payment.currency,
    method: payment.method,
    // paid_at es @db.Date: medianoche UTC del día, así que el día es el
    // prefijo del ISO.
    paidAt: payment.paidAt.toISOString().slice(0, 10),
  };
}

export function mismaFoto(a: FotoDePago, b: FotoDePago): boolean {
  return (
    a.amount === b.amount &&
    a.currency === b.currency &&
    a.method === b.method &&
    a.paidAt === b.paidAt
  );
}

// ---------------------------------------------------------------------------
// Escritura
// ---------------------------------------------------------------------------

export interface CreatePaymentInput {
  opportunityId: string;
  amount: number;
  method: PaymentMethod;
  paidAt: Date;
}

export async function createPayment(
  organizationId: string,
  actorUserId: string,
  input: CreatePaymentInput,
) {
  const opportunity = await findOpportunityById(input.opportunityId, organizationId);
  if (!opportunity) {
    // 400 y no 404, mismo mensaje que createQuote: el recurso que se pide
    // crear es el pago, y lo inválido es un dato del body.
    throw new AppError(
      "El opportunityId indicado no existe, no pertenece a tu organización, o está eliminada",
      400,
    );
  }

  return prisma.$transaction(async (tx) => {
    const payment = await createPaymentRepo(
      {
        organizationId,
        opportunityId: input.opportunityId,
        amount: input.amount,
        // La FOTO de la moneda de la oportunidad en este momento.
        currency: opportunity.currency,
        method: input.method,
        paidAt: input.paidAt,
      },
      tx,
    );
    await createPaymentChange(
      {
        organizationId,
        opportunityId: payment.opportunityId,
        paymentId: payment.id,
        action: "CREATED",
        changedById: actorUserId,
        before: null,
        after: fotoDelPago(payment),
      },
      tx,
    );
    return payment;
  });
}

export interface UpdatePaymentInput {
  amount?: number;
  method?: PaymentMethod;
  paidAt?: Date;
}

export async function updatePayment(
  organizationId: string,
  actorUserId: string,
  id: string,
  input: UpdatePaymentInput,
) {
  await requireReachablePayment(organizationId, id);

  await prisma.$transaction(async (tx) => {
    if (!(await lockPaymentForUpdate(id, organizationId, tx))) {
      // Lo borraron entre la lectura y el lock.
      throw new AppError("Pago no encontrado", 404);
    }
    const antes = await findPaymentById(id, organizationId, tx);
    const result = await updatePaymentRepo(id, organizationId, input, tx);
    const despues = await findPaymentById(id, organizationId, tx);
    if (!antes || !despues || result.count === 0) {
      throw new AppError("Pago no encontrado", 404);
    }
    const fotoAntes = fotoDelPago(antes);
    const fotoDespues = fotoDelPago(despues);
    if (mismaFoto(fotoAntes, fotoDespues)) return;
    await createPaymentChange(
      {
        organizationId,
        opportunityId: despues.opportunityId,
        paymentId: id,
        action: "UPDATED",
        changedById: actorUserId,
        before: fotoAntes,
        after: fotoDespues,
      },
      tx,
    );
  });

  return requireReachablePayment(organizationId, id);
}

export async function deletePayment(organizationId: string, actorUserId: string, id: string) {
  await requireReachablePayment(organizationId, id);

  await prisma.$transaction(async (tx) => {
    if (!(await lockPaymentForUpdate(id, organizationId, tx))) {
      throw new AppError("Pago no encontrado", 404);
    }
    const antes = await findPaymentById(id, organizationId, tx);
    const result = await deletePaymentRepo(id, organizationId, tx);
    if (!antes || result.count === 0) {
      throw new AppError("Pago no encontrado", 404);
    }
    await createPaymentChange(
      {
        organizationId,
        opportunityId: antes.opportunityId,
        paymentId: id,
        action: "DELETED",
        changedById: actorUserId,
        before: fotoDelPago(antes),
        after: null,
      },
      tx,
    );
  });
}
