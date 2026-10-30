// Contrato de /api/payments (§43 de docs/frontend-cambios-pendientes.md), tal
// como lo serializa el backend (payment.controller.ts /
// payment.repository.ts). Los pagos NO viajan embebidos en la Opportunity: se
// piden aparte, como Quote y Delivery.

export type PaymentMethod = "CASH" | "TRANSFER" | "CARD" | "CHECK" | "OTHER";

export interface Payment {
  id: string;
  organizationId: string;
  opportunityId: string;
  // Decimal(14,2) → string en lectura, mismo caso que Opportunity.amount.
  amount: string;
  // FOTO de la moneda de la oportunidad al crear el pago: no la sigue si la
  // oportunidad cambia de moneda después.
  currency: string;
  method: PaymentMethod;
  // Fecha sola serializada como ISO a medianoche UTC ("2026-09-16T00:00:00.000Z").
  paidAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentListResponse {
  // Cobro más nuevo primero.
  data: Payment[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

// Sin currency: la pone el backend desde la oportunidad.
export interface CreatePaymentInput {
  opportunityId: string;
  amount: number;
  method: PaymentMethod;
  // "YYYY-MM-DD".
  paidAt: string;
}

// opportunityId no se edita: un pago no se muda de oportunidad.
export type UpdatePaymentInput = Partial<Omit<CreatePaymentInput, "opportunityId">>;

// Historial de pagos (PR-17b): GET /payments/changes. La foto del pago antes
// y después de cada cambio; before es null en un alta, after en un borrado.
export interface FotoDePago {
  amount: string;
  currency: string;
  method: string;
  paidAt: string;
}

export type PaymentChangeAction = "CREATED" | "UPDATED" | "DELETED";

export interface PaymentChange {
  id: string;
  paymentId: string;
  action: PaymentChangeAction;
  changedAt: string;
  changedBy: { id: string; fullName: string };
  before: FotoDePago | null;
  after: FotoDePago | null;
}

export interface PaymentChangeListResponse {
  data: PaymentChange[];
  pagination: PaymentListResponse["pagination"];
}
