import { request } from "../../lib/api";
import { getAccessToken } from "../../auth/getAccessToken";
import type {
  ClaimQrInput,
  CreateDigitalQrInput,
  QrCode,
  QrCodeListQuery,
  QrCodeListResponse,
  UpdateQrInput,
} from "./types";

// Reutiliza request()/getAccessToken tal cual — sin cliente Supabase propio
// (el original leía qr_codes vía PostgREST/RLS; acá todo pasa por la API).
// organizationId nunca viaja: se resuelve server-side desde el JWT.
//
// Sin getQrCode(id): no existe GET /api/qr/:id en el backend (qr.routes.ts
// tiene GET del listado, POST claim/digital, PATCH y DELETE — nada más).
// Por eso la edición se hace en un diálogo con la fila ya cargada en el
// listado, no en una ruta /qr/:id/edit que tendría que refetchear el
// registro (ver QrFormDialog.tsx).
function buildListQueryString(query: QrCodeListQuery): string {
  const params = new URLSearchParams();
  if (query.page !== undefined) params.set("page", String(query.page));
  if (query.pageSize !== undefined) params.set("pageSize", String(query.pageSize));
  if (query.branchId) params.set("branchId", query.branchId);
  if (query.sortBy) params.set("sortBy", query.sortBy);
  if (query.sortOrder) params.set("sortOrder", query.sortOrder);
  const queryString = params.toString();
  return queryString ? `?${queryString}` : "";
}

export function listQrCodes(
  query: QrCodeListQuery,
  signal?: AbortSignal,
): Promise<QrCodeListResponse> {
  return request<QrCodeListResponse>(`/qr${buildListQueryString(query)}`, {
    getAccessToken,
    signal,
  });
}

export function createDigitalQrCode(input: CreateDigitalQrInput): Promise<QrCode> {
  return request<QrCode>("/qr/digital", {
    method: "POST",
    body: input,
    getAccessToken,
  });
}

export function claimQrCode(input: ClaimQrInput): Promise<QrCode> {
  return request<QrCode>("/qr/claim", {
    method: "POST",
    body: input,
    getAccessToken,
  });
}

export function updateQrCode(id: string, input: UpdateQrInput): Promise<QrCode> {
  return request<QrCode>(`/qr/${id}`, {
    method: "PATCH",
    body: input,
    getAccessToken,
  });
}

export function deleteQrCode(id: string): Promise<void> {
  return request<void>(`/qr/${id}`, {
    method: "DELETE",
    getAccessToken,
  });
}
