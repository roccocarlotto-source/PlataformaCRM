// Reconstruido desde el contrato real del backend (src/controllers/pipeline.controller.ts,
// src/services/pipeline.service.ts, prisma/schema.prisma modelo Pipeline). No se
// agrega ningún campo que el backend no devuelva o no acepte.

export interface Pipeline {
  id: string;
  organizationId: string;
  name: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface PipelineListPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface PipelineListResponse {
  data: Pipeline[];
  pagination: PipelineListPagination;
}

export type PipelineSortBy = "name" | "createdAt";
export type SortOrder = "asc" | "desc";

// Sin filtro isDefault: el backend no lo expone en el listado (ver
// pipeline.controller.ts listQuerySchema) — para saber cuál es el default
// hay que leerlo de cada fila.
export interface PipelineListQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  sortBy?: PipelineSortBy;
  sortOrder?: SortOrder;
}

// isDefault: el backend garantiza A LO SUMO un default por organización,
// NUNCA "siempre exactamente uno" — updatePipeline solo desmarca el
// default anterior cuando input.isDefault === true; un PATCH explícito
// { isDefault: false } no promueve ningún reemplazo, y la organización
// puede quedar en cero defaults. El frontend no inventa una regla más
// estricta que esa (Decisión A del informe de diseño de M4): el checkbox
// se puede desmarcar libremente.
export interface CreatePipelineInput {
  name: string;
  isDefault?: boolean;
}

export type UpdatePipelineInput = Partial<CreatePipelineInput>;
