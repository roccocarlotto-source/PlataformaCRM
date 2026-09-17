import type { PaymentMethod } from "@prisma/client";
import { findOpportunityById } from "../repositories/opportunity.repository";
import {
  countPaymentsByOpportunity,
  createPayment as createPaymentRepo,
  deletePayment as deletePaymentRepo,
  findPaymentById,
  findPaymentsByOpportunity,
  updatePayment as updatePaymentRepo,
} from "../repositories/payment.repository";
import { AppError } from "../utils/AppError";

// ---------------------------------------------------------------------------
// Pago del cliente (§43 de docs/frontend-cambios-pendientes.md).
//
// Un historial de cobros por oportunidad, cargado a mano. PURAMENTE
// INFORMATIVO: nada de acá toca la oportunidad, la entrega ni el outbox, y
// ningún otro flujo lee los pagos para decidir algo. Mismo criterio que
// Permuta (§41) y el detalle de financiación (§42).
//
// Sin reglas de estado, así que sin lock ni compare-and-swap (a diferencia de
// quote.service.ts): no hay invariante entre filas que dos escrituras
// concurrentes puedan romper. Crear un pago mientras alguien elimina la
// oportunidad deja un pago colgado de una oportunidad borrada — inalcanzable
// igual que sus cotizaciones (requireReachablePayment), y la FK sigue
// sosteniendo que la oportunidad exista.
//
// currency es una FOTO: la pone createPayment desde la oportunidad, nunca el
// cliente, y nadie la edita después.
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

// ---------------------------------------------------------------------------
// Escritura
// ---------------------------------------------------------------------------

export interface CreatePaymentInput {
  opportunityId: string;
  amount: number;
  method: PaymentMethod;
  paidAt: Date;
}

export async function createPayment(organizationId: string, input: CreatePaymentInput) {
  const opportunity = await findOpportunityById(input.opportunityId, organizationId);
  if (!opportunity) {
    // 400 y no 404, mismo mensaje que createQuote: el recurso que se pide
    // crear es el pago, y lo inválido es un dato del body.
    throw new AppError(
      "El opportunityId indicado no existe, no pertenece a tu organización, o está eliminada",
      400,
    );
  }

  return createPaymentRepo({
    organizationId,
    opportunityId: input.opportunityId,
    amount: input.amount,
    // La FOTO de la moneda de la oportunidad en este momento.
    currency: opportunity.currency,
    method: input.method,
    paidAt: input.paidAt,
  });
}

export interface UpdatePaymentInput {
  amount?: number;
  method?: PaymentMethod;
  paidAt?: Date;
}

export async function updatePayment(organizationId: string, id: string, input: UpdatePaymentInput) {
  await requireReachablePayment(organizationId, id);

  const result = await updatePaymentRepo(id, organizationId, input);
  if (result.count === 0) {
    // Lo borraron entre la lectura y el UPDATE.
    throw new AppError("Pago no encontrado", 404);
  }

  return requireReachablePayment(organizationId, id);
}

export async function deletePayment(organizationId: string, id: string) {
  await requireReachablePayment(organizationId, id);

  const result = await deletePaymentRepo(id, organizationId);
  if (result.count === 0) {
    throw new AppError("Pago no encontrado", 404);
  }
}
