// Reconstruido desde el contrato real del backend
// (src/controllers/ingestionEvent.controller.ts, ingestionEvent.service.ts,
// src/repositories/ingestionEvent.repository.ts, prisma/schema.prisma modelo
// IngestionEvent). No se agrega ningún campo que el backend no devuelva o no
// acepte.

// Las cuatro variantes del enum de Prisma. DUPLICATE está declarado pero ningún
// código lo escribe nunca —los duplicados no crean fila— así que filtrar por él
// devuelve una página vacía. Se acepta igual: restringir el tipo a los tres
// "reales" haría divergir el contrato HTTP del enum de la base.
export type IngestionStatus = "PENDING" | "PROCESSED" | "FAILED" | "DUPLICATE";

export const ESTADOS: readonly IngestionStatus[] = [
  "PENDING",
  "PROCESSED",
  "FAILED",
  "DUPLICATE",
] as const;

export const ETIQUETA_DE_ESTADO: Record<IngestionStatus, string> = {
  PENDING: "Pendiente",
  PROCESSED: "Procesado",
  FAILED: "Fallido",
  DUPLICATE: "Duplicado",
};

// Exactamente INGESTION_EVENT_PUBLIC_SELECT del repositorio: diez campos.
//
// SIN `rawPayload` ni `promotionNotes`, y no es un olvido — la proyección
// pública del backend los excluye a propósito: son las dos columnas JSONB de la
// tabla de mayor volumen del esquema, y con pageSize=100 una página podría pesar
// megabytes para un listado cuyo propósito es ver ESTADOS.
//
// Cuatro campos nullable, y cada null significa algo distinto:
//   batchId           null para SIEMPRE en los eventos de webhook (llegan de a
//                     uno, no pertenecen a ningún lote).
//   externalId        nullable en el modelo; por los caminos que existen hoy
//                     siempre viene con valor (se deriva del contenido si la
//                     fuente no manda X-External-Id).
//   errorMessage      solo tiene contenido en FAILED. Un reintento lo limpia.
//   promotedContactId solo tiene contenido en PROCESSED.
export interface IngestionEvent {
  id: string;
  organizationId: string;
  sourceId: string;
  batchId: string | null;
  externalId: string | null;
  status: IngestionStatus;
  errorMessage: string | null;
  promotedContactId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface IngestionEventListPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface IngestionEventListResponse {
  data: IngestionEvent[];
  pagination: IngestionEventListPagination;
}

export type SortOrder = "asc" | "desc";

// SIN `sortBy`, a propósito: el backend solo acepta "createdAt" y lo pone por
// default. Exponer un parámetro con un único valor posible sería ofrecer una
// opción que no existe — el índice compuesto que lo sostiene,
// (organization_id, source_id, created_at), es el único de la tabla.
export interface IngestionEventListQuery {
  page?: number;
  pageSize?: number;
  sourceId?: string;
  status?: IngestionStatus;
  batchId?: string;
  sortOrder?: SortOrder;
}
