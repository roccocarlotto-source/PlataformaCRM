import { request } from "../../lib/api";
import { getAccessToken } from "../../auth/getAccessToken";
import type {
  CreateVoucherInput,
  RedeemedVoucher,
  Voucher,
  VoucherWhatsappResult,
  VoucherWhatsappStatus,
} from "./types";

// El canje (ítem 176): authenticate + rate limiter, SIN restricción de rol.
// 200 con el cupón ya CONSUMED; 409 si ya estaba canjeado o venció (con
// consumedAt / expiresAt en ApiError.details); 404 si no existe o es de otra
// organización. Sin `signal`, mismo criterio que sendInternalAgentMessage:
// abortar el fetch no deshace un canje que ya pasó del otro lado.
export function redeemVoucher(id: string): Promise<RedeemedVoucher> {
  return request<RedeemedVoucher>(`/vouchers/${encodeURIComponent(id)}/redeem`, {
    method: "POST",
    getAccessToken,
  });
}

// "Crear cupón" a mano. ADMIN y USER; el backend acota al USER a lo que tiene
// asignado (403).
export function createVoucher(input: CreateVoucherInput): Promise<Voucher> {
  return request<Voucher>("/vouchers", { method: "POST", body: input, getAccessToken });
}

export function listContactVouchers(
  contactId: string,
  signal?: AbortSignal,
): Promise<{ data: Voucher[] }> {
  return request<{ data: Voucher[] }>(`/contacts/${encodeURIComponent(contactId)}/vouchers`, {
    getAccessToken,
    signal,
  });
}

export function getVoucherWhatsappStatus(
  id: string,
  signal?: AbortSignal,
): Promise<VoucherWhatsappStatus> {
  return request<VoucherWhatsappStatus>(`/vouchers/${encodeURIComponent(id)}/whatsapp`, {
    getAccessToken,
    signal,
  });
}

// Sin `signal`, como el canje: abortar no deshace un WhatsApp que ya salió.
export function sendVoucherWhatsapp(id: string): Promise<VoucherWhatsappResult> {
  return request<VoucherWhatsappResult>(`/vouchers/${encodeURIComponent(id)}/whatsapp`, {
    method: "POST",
    getAccessToken,
  });
}
