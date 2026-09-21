import { ApiError, request } from "../../lib/api";
import { getAccessToken } from "../../auth/getAccessToken";
import type {
  Branch,
  BranchListQuery,
  BranchListResponse,
  CreateBranchInput,
  GoogleCalendarAuthorization,
  GoogleCalendarConnection,
  UpdateBranchInput,
} from "./types";

// Reutiliza request()/getAccessToken tal cual. organizationId nunca viaja acá:
// se resuelve exclusivamente server-side desde el JWT.
function buildListQueryString(query: BranchListQuery): string {
  const params = new URLSearchParams();
  if (query.page !== undefined) params.set("page", String(query.page));
  if (query.pageSize !== undefined) params.set("pageSize", String(query.pageSize));
  if (query.search) params.set("search", query.search);
  if (query.sortBy) params.set("sortBy", query.sortBy);
  if (query.sortOrder) params.set("sortOrder", query.sortOrder);
  const queryString = params.toString();
  return queryString ? `?${queryString}` : "";
}

export function listBranches(
  query: BranchListQuery,
  signal?: AbortSignal,
): Promise<BranchListResponse> {
  return request<BranchListResponse>(`/branches${buildListQueryString(query)}`, {
    getAccessToken,
    signal,
  });
}

// Único consumidor: el formulario de edición (BranchFormPage). BranchSelect y
// QrListPage siguen resolviendo nombres contra la lista, como antes.
export function getBranch(id: string, signal?: AbortSignal): Promise<Branch> {
  return request<Branch>(`/branches/${id}`, { getAccessToken, signal });
}

export function createBranch(input: CreateBranchInput): Promise<Branch> {
  return request<Branch>("/branches", {
    method: "POST",
    body: input,
    getAccessToken,
  });
}

export function updateBranch(id: string, input: UpdateBranchInput): Promise<Branch> {
  return request<Branch>(`/branches/${id}`, {
    method: "PATCH",
    body: input,
    getAccessToken,
  });
}

// 204 sin body — request() devuelve undefined en ese caso. El 400 del RESTRICT
// (recursos/servicios/QRs activos o Google Calendar conectado) llega como
// rechazo con el mensaje del backend, que la pantalla muestra tal cual.
export function deleteBranch(id: string): Promise<void> {
  return request<void>(`/branches/${id}`, {
    method: "DELETE",
    getAccessToken,
  });
}

// ---------------------------------------------------------------------------
// Google Calendar de la sucursal (ítem 75).
// ---------------------------------------------------------------------------

// null = la sucursal nunca se conectó. El backend lo dice con un 404 ("Esta
// sucursal no tiene Google Calendar conectado"), que acá es un estado normal
// de la pantalla y no un error: se traduce a null para que la sección muestre
// "Conectar" en vez de un ErrorState. Cualquier otro error sigue siendo error.
export async function getGoogleCalendarConnection(
  branchId: string,
  signal?: AbortSignal,
): Promise<GoogleCalendarConnection | null> {
  try {
    return await request<GoogleCalendarConnection>(`/branches/${branchId}/google-calendar`, {
      getAccessToken,
      signal,
    });
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

// Firma el state y devuelve la URL de autorización de Google. POST y bajo
// /connect: es una escritura aunque parezca una lectura (el state firmado
// habilita a escribir en el callback), ver googleCalendarConnection.routes.ts.
export function startGoogleCalendarConnection(
  branchId: string,
): Promise<GoogleCalendarAuthorization> {
  return request<GoogleCalendarAuthorization>(`/branches/${branchId}/google-calendar/connect`, {
    method: "POST",
    getAccessToken,
  });
}

// 204 sin body. Revoca contra Google (best-effort) y deja la fila en REVOKED.
export function disconnectGoogleCalendar(branchId: string): Promise<void> {
  return request<void>(`/branches/${branchId}/google-calendar`, {
    method: "DELETE",
    getAccessToken,
  });
}
