import { request } from "../../lib/api";
import { getAccessToken } from "../../auth/getAccessToken";
import type { Booking, BookingListQuery, BookingListResponse } from "./types";

// Reutiliza request()/getAccessToken tal cual. organizationId nunca viaja acá.
function buildListQueryString(query: BookingListQuery): string {
  const params = new URLSearchParams();
  if (query.page !== undefined) params.set("page", String(query.page));
  if (query.pageSize !== undefined) params.set("pageSize", String(query.pageSize));
  if (query.branchId) params.set("branchId", query.branchId);
  if (query.resourceId) params.set("resourceId", query.resourceId);
  if (query.serviceTypeId) params.set("serviceTypeId", query.serviceTypeId);
  if (query.contactId) params.set("contactId", query.contactId);
  if (query.status) params.set("status", query.status);
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);
  if (query.sortBy) params.set("sortBy", query.sortBy);
  if (query.sortOrder) params.set("sortOrder", query.sortOrder);
  const queryString = params.toString();
  return queryString ? `?${queryString}` : "";
}

export function listBookings(
  query: BookingListQuery,
  signal?: AbortSignal,
): Promise<BookingListResponse> {
  return request<BookingListResponse>(`/bookings${buildListQueryString(query)}`, {
    getAccessToken,
    signal,
  });
}

// PATCH /:id/cancel y no DELETE: cancelar no borra, transiciona a CANCELLED y
// la reserva queda como historia. Devuelve la reserva actualizada. Una que ya
// estaba cancelada es 409, con el mensaje del backend.
export function cancelBooking(id: string): Promise<Booking> {
  return request<Booking>(`/bookings/${id}/cancel`, { method: "PATCH", getAccessToken });
}
