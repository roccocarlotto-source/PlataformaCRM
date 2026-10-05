// Reconstruido desde el contrato real del backend
// (src/controllers/ingestionEvent.controller.ts, ingestionEvent.service.ts,
// src/repositories/ingestionEvent.repository.ts, prisma/schema.prisma modelo
// IngestionEvent). No se agrega ningún campo que el backend no devuelva o no
// acepte.

// Las cinco variantes del enum de Prisma. DUPLICATE está declarado pero ningún
// código lo escribe nunca —los duplicados no crean fila— así que filtrar por él
// devuelve una página vacía. Se acepta igual: restringir el tipo a los tres
// "reales" haría divergir el contrato HTTP del enum de la base.
//
// DEAD_LETTER (B-30: agotó los reintentos de promoción) faltaba acá y la celda
// de estado de esas filas salía vacía; se agregó con su etiqueta. No está en
// ESTADOS (las opciones del filtro): sumarlo es una opción nueva del filtro, no
// un arreglo visual, y queda para cuando se decida.
export type IngestionStatus = "PENDING" | "PROCESSED" | "FAILED" | "DUPLICATE" | "DEAD_LETTER";

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
  DEAD_LETTER: "Agotó los reintentos",
};

// Color del Badge de cada estado en el listado: lo que falló se tiene que ver
// de un vistazo entre cien filas procesadas.
export const VARIANTE_DE_ESTADO: Record<
  IngestionStatus,
  "neutral" | "info" | "success" | "danger"
> = {
  PENDING: "info",
  PROCESSED: "success",
  FAILED: "danger",
  DUPLICATE: "neutral",
  DEAD_LETTER: "danger",
};

// Exactamente la proyección pública del repositorio: los diez campos de
// INGESTION_EVENT_PUBLIC_SELECT más telefonoDescartado (F5-a).
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
//   telefonoDescartado F5-a: el teléfono que la ingesta no pudo normalizar y
//                     dejó afuera del contacto (PROCESSED con revisión
//                     manual). Derivado de promotionNotes en el backend.
export interface IngestionEvent {
  id: string;
  organizationId: string;
  sourceId: string;
  // El nombre de la fuente viene con la fila, también si la fuente fue
  // eliminada. Opcional: un backend anterior no lo manda.
  source?: { id: string; name: string; deletedAt: string | null };
  batchId: string | null;
  externalId: string | null;
  status: IngestionStatus;
  errorMessage: string | null;
  promotedContactId: string | null;
  telefonoDescartado: string | null;
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
