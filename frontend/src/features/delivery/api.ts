import { getAccessToken } from "../../auth/getAccessToken";
import { request } from "../../lib/api";
import type { Delivery, DeliveryListResponse, UpdateDeliveryInput } from "./types";

// Reutiliza request()/getAccessToken tal cual, como el resto de las features.
// Sin createDelivery: la entrega nace sola en el backend al ganar la
// oportunidad (§40).

export function listOpportunityDeliveries(
  opportunityId: string,
  signal?: AbortSignal,
): Promise<DeliveryListResponse> {
  const params = new URLSearchParams({ opportunityId });
  return request<DeliveryListResponse>(`/deliveries?${params.toString()}`, {
    getAccessToken,
    signal,
  });
}

export function updateDelivery(id: string, input: UpdateDeliveryInput): Promise<Delivery> {
  return request<Delivery>(`/deliveries/${id}`, { method: "PATCH", body: input, getAccessToken });
}

export function confirmDelivery(id: string): Promise<Delivery> {
  return request<Delivery>(`/deliveries/${id}`, {
    method: "PATCH",
    body: { status: "DELIVERED" },
    getAccessToken,
  });
}
