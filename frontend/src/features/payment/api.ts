import { getAccessToken } from "../../auth/getAccessToken";
import { request } from "../../lib/api";
import type { CreatePaymentInput, Payment, PaymentListResponse, UpdatePaymentInput } from "./types";

// Reutiliza request()/getAccessToken tal cual, como el resto de las features.

// El tope real del backend para pageSize (payment.controller.ts). Se pide una
// sola página: una oportunidad con más de 100 pagos no es un caso de una
// automotora, y si pasara, PaymentSection lo avisa en vez de sumar de menos
// en silencio.
export const PAYMENTS_PAGE_SIZE = 100;

export function listOpportunityPayments(
  opportunityId: string,
  signal?: AbortSignal,
): Promise<PaymentListResponse> {
  const params = new URLSearchParams({ opportunityId, pageSize: String(PAYMENTS_PAGE_SIZE) });
  return request<PaymentListResponse>(`/payments?${params.toString()}`, {
    getAccessToken,
    signal,
  });
}

export function createPayment(input: CreatePaymentInput): Promise<Payment> {
  return request<Payment>("/payments", { method: "POST", body: input, getAccessToken });
}

export function updatePayment(id: string, input: UpdatePaymentInput): Promise<Payment> {
  return request<Payment>(`/payments/${id}`, { method: "PATCH", body: input, getAccessToken });
}

export function deletePayment(id: string): Promise<void> {
  return request<void>(`/payments/${id}`, { method: "DELETE", getAccessToken });
}
