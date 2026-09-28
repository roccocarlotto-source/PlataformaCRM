import { request } from "../../lib/api";
import { getAccessToken } from "../../auth/getAccessToken";
import type { RedeemedVoucher } from "./types";

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
