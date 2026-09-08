import { request, uploadFile } from "../../lib/api";
import { getAccessToken } from "../../auth/getAccessToken";
import type {
  CreateVehicleInput,
  UpdateVehicleInput,
  UpdateVehiclePhotoInput,
  UploadVehiclePhotoOptions,
  Vehicle,
  VehicleChangeLogQuery,
  VehicleChangeLogResponse,
  VehicleDetail,
  VehicleListQuery,
  VehicleListResponse,
  VehiclePhoto,
} from "./types";

// Reutiliza request()/uploadFile()/getAccessToken tal cual — mismo molde que
// features/company/api.ts y features/import/api.ts. organizationId nunca
// viaja: se resuelve server-side desde el JWT.

// `status` es multi-selección: un params.append por valor (?status=A&status=B),
// que es la forma que listVehiclesQuerySchema (statusListSchema) recibe como
// array desde Express. No se une con comas aunque el backend también lo
// acepte: la query repetida es la forma canónica y la que URLSearchParams
// produce sin transformar nada.
function buildListQueryString(query: VehicleListQuery): string {
  const params = new URLSearchParams();
  if (query.page !== undefined) params.set("page", String(query.page));
  if (query.pageSize !== undefined) params.set("pageSize", String(query.pageSize));
  if (query.branchId) params.set("branchId", query.branchId);
  for (const status of query.status ?? []) params.append("status", status);
  if (query.condition) params.set("condition", query.condition);
  if (query.make) params.set("make", query.make);
  if (query.model) params.set("model", query.model);
  if (query.minPriceUsd !== undefined) params.set("minPriceUsd", String(query.minPriceUsd));
  if (query.maxPriceUsd !== undefined) params.set("maxPriceUsd", String(query.maxPriceUsd));
  // "true"/"false" explícitos (queryBooleanSchema); solo se manda cuando el
  // filtro está activo — false es lo mismo que no filtrar.
  if (query.consignmentOnly) params.set("consignmentOnly", "true");
  if (query.q) params.set("q", query.q);
  if (query.sortBy) params.set("sortBy", query.sortBy);
  if (query.sortOrder) params.set("sortOrder", query.sortOrder);
  const queryString = params.toString();
  return queryString ? `?${queryString}` : "";
}

export function listVehicles(
  query: VehicleListQuery,
  signal?: AbortSignal,
): Promise<VehicleListResponse> {
  return request<VehicleListResponse>(`/vehicles${buildListQueryString(query)}`, {
    getAccessToken,
    signal,
  });
}

export function getVehicle(id: string, signal?: AbortSignal): Promise<VehicleDetail> {
  return request<VehicleDetail>(`/vehicles/${id}`, { getAccessToken, signal });
}

export function createVehicle(input: CreateVehicleInput): Promise<Vehicle> {
  return request<Vehicle>("/vehicles", { method: "POST", body: input, getAccessToken });
}

export function updateVehicle(id: string, input: UpdateVehicleInput): Promise<Vehicle> {
  return request<Vehicle>(`/vehicles/${id}`, { method: "PATCH", body: input, getAccessToken });
}

export function deleteVehicle(id: string): Promise<void> {
  return request<void>(`/vehicles/${id}`, { method: "DELETE", getAccessToken });
}

function buildChangeLogQueryString(query: VehicleChangeLogQuery): string {
  const params = new URLSearchParams();
  if (query.page !== undefined) params.set("page", String(query.page));
  if (query.pageSize !== undefined) params.set("pageSize", String(query.pageSize));
  const queryString = params.toString();
  return queryString ? `?${queryString}` : "";
}

export function getVehicleChangeLog(
  id: string,
  query: VehicleChangeLogQuery,
  signal?: AbortSignal,
): Promise<VehicleChangeLogResponse> {
  return request<VehicleChangeLogResponse>(
    `/vehicles/${id}/change-log${buildChangeLogQueryString(query)}`,
    { getAccessToken, signal },
  );
}

// ---------------------------------------------------------------------------
// Galería. Las cuatro escrituras devuelven la galería completa que quedó
// (VehiclePhoto[] con URLs firmadas), no la foto tocada: el cliente repinta
// con eso sin un segundo request.
// ---------------------------------------------------------------------------

// POST multipart: el archivo va en el campo "photo" (CAMPO_ARCHIVO de
// vehiclePhotoUpload.ts); slot e isCover como campos de texto, isCover en
// "true"/"false" porque multer no tipa (uploadVehiclePhotoBodySchema).
export function uploadVehiclePhoto(
  vehicleId: string,
  file: File,
  options: UploadVehiclePhotoOptions = {},
): Promise<VehiclePhoto[]> {
  const form = new FormData();
  form.append("photo", file);
  if (options.slot !== undefined) form.append("slot", options.slot);
  if (options.isCover !== undefined) form.append("isCover", String(options.isCover));
  return uploadFile<VehiclePhoto[]>(`/vehicles/${vehicleId}/photos`, form, { getAccessToken });
}

export function updateVehiclePhoto(
  vehicleId: string,
  photoId: string,
  input: UpdateVehiclePhotoInput,
): Promise<VehiclePhoto[]> {
  return request<VehiclePhoto[]>(`/vehicles/${vehicleId}/photos/${photoId}`, {
    method: "PATCH",
    body: input,
    getAccessToken,
  });
}

// 200 con la galería restante, no 204 (ver deleteVehiclePhotoHandler).
export function deleteVehiclePhoto(vehicleId: string, photoId: string): Promise<VehiclePhoto[]> {
  return request<VehiclePhoto[]>(`/vehicles/${vehicleId}/photos/${photoId}`, {
    method: "DELETE",
    getAccessToken,
  });
}

// PUT con TODOS los ids de la galería en el orden nuevo (reorderVehiclePhotosSchema:
// { photoIds }); computeReorderedPositions rechaza una lista incompleta.
export function reorderVehiclePhotos(
  vehicleId: string,
  photoIds: string[],
): Promise<VehiclePhoto[]> {
  return request<VehiclePhoto[]>(`/vehicles/${vehicleId}/photos/reorder`, {
    method: "PUT",
    body: { photoIds },
    getAccessToken,
  });
}
