import { getAccessToken } from "../../auth/getAccessToken";
import { downloadFile, request, uploadFile } from "../../lib/api";
import type {
  Ajustes,
  Codificacion,
  DetalleDelLote,
  FilaDelLote,
  Lote,
  OpcionesDeImportacion,
  Paginado,
  Politica,
  Separador,
  SubidaDeArchivo,
  TipoDePlan,
  TipoImportable,
} from "./types";

// Plataforma → Importar datos: /api/admin/organizations/:organizationId/imports.

function base(organizationId: string): string {
  return `/admin/organizations/${organizationId}/imports`;
}

export function getOpciones(organizationId: string, signal?: AbortSignal) {
  return request<OpcionesDeImportacion>(`${base(organizationId)}/options`, {
    getAccessToken,
    signal,
  });
}

export interface PedidoDeSubida {
  entityType: TipoImportable;
  sourceId?: string;
  sourceName?: string;
  separador?: Separador;
  codificacion?: Codificacion;
  hoja?: string;
}

export function subirArchivo(organizationId: string, archivo: File, pedido: PedidoDeSubida) {
  const form = new FormData();
  for (const [clave, valor] of Object.entries(pedido)) {
    if (valor !== undefined && valor !== "") form.append(clave, valor);
  }
  form.append("file", archivo);
  return uploadFile<SubidaDeArchivo>(base(organizationId), form, { getAccessToken });
}

export function listarLotes(organizationId: string, signal?: AbortSignal) {
  return request<Paginado<Lote>>(`${base(organizationId)}?pageSize=10`, { getAccessToken, signal });
}

export function getLote(organizationId: string, batchId: string, signal?: AbortSignal) {
  return request<DetalleDelLote>(`${base(organizationId)}/${batchId}`, { getAccessToken, signal });
}

export function configurarLote(organizationId: string, batchId: string, ajustes: Ajustes) {
  return request<Lote>(`${base(organizationId)}/${batchId}/config`, {
    method: "PUT",
    body: ajustes,
    getAccessToken,
  });
}

export function listarFilas(
  organizationId: string,
  batchId: string,
  filtro: { tipo?: TipoDePlan; page: number; pageSize: number },
  signal?: AbortSignal,
) {
  const params = new URLSearchParams({
    page: String(filtro.page),
    pageSize: String(filtro.pageSize),
  });
  if (filtro.tipo) params.set("tipo", filtro.tipo);
  return request<Paginado<FilaDelLote>>(`${base(organizationId)}/${batchId}/rows?${params}`, {
    getAccessToken,
    signal,
  });
}

export function decidirFilas(
  organizationId: string,
  batchId: string,
  rowIds: string[],
  decision: Politica | null,
) {
  return request<{ actualizadas: number }>(`${base(organizationId)}/${batchId}/rows`, {
    method: "PATCH",
    body: { rowIds, decision },
    getAccessToken,
  });
}

export function confirmarLote(organizationId: string, batchId: string) {
  return request<{ confirmadas: number }>(`${base(organizationId)}/${batchId}/confirm`, {
    method: "POST",
    getAccessToken,
  });
}

export function cancelarLote(organizationId: string, batchId: string) {
  return request<{ borradas: number }>(`${base(organizationId)}/${batchId}/cancel`, {
    method: "POST",
    getAccessToken,
  });
}

export function deshacerLote(organizationId: string, batchId: string) {
  return request<Lote>(`${base(organizationId)}/${batchId}/undo`, {
    method: "POST",
    getAccessToken,
  });
}

export function descargarCsv(organizationId: string, batchId: string, cual: "failed" | "changes") {
  return downloadFile(`${base(organizationId)}/${batchId}/${cual}.csv`, { getAccessToken });
}
