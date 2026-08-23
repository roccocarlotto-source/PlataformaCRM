// Reconstruido desde el contrato real del backend (src/controllers/stage.controller.ts,
// src/services/stage.service.ts, prisma/schema.prisma modelo Stage). No se
// agrega ningún campo que el backend no devuelva o no acepte.

// ⚠️ probability es Decimal(5,2) en Prisma — Prisma.Decimal implementa
// toJSON() devolviendo un STRING (verificado empíricamente:
// JSON.stringify({ probability: new Decimal("25.50") }) → '{"probability":"25.5"}').
// La API por lo tanto SIEMPRE devuelve probability como string, nunca como
// number, pese a que la escritura (create/update) acepte un number real
// (z.coerce.number() del lado del backend). Nunca tipar esto como number
// en lectura: cualquier .toFixed()/comparación numérica directa rompe en
// runtime, no en tipos.
export interface Stage {
  id: string;
  organizationId: string;
  pipelineId: string;
  name: string;
  order: number;
  probability: string;
  isWon: boolean;
  isLost: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface StageListPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface StageListResponse {
  data: Stage[];
  pagination: StageListPagination;
}

export type StageSortBy = "order" | "name" | "createdAt";
export type SortOrder = "asc" | "desc";

// pipelineId siempre se envía explícito en esta UI — nunca se usa el
// listado global sin scope (mezclaría `order` de distintos pipelines,
// que solo es único dentro de cada uno).
export interface StageListQuery {
  page?: number;
  pageSize?: number;
  pipelineId?: string;
  search?: string;
  sortBy?: StageSortBy;
  sortOrder?: SortOrder;
}

// order/probability van como number real en la escritura (el backend
// acepta number o string numérico vía z.coerce, pero el frontend siempre
// envía number real — la respuesta sigue siendo string, ver arriba).
// pipelineId es inmutable: no existe en UpdateStageInput (no editable
// una vez creada la etapa, ver stage.controller.ts updateStageSchema).
export interface CreateStageInput {
  pipelineId: string;
  name: string;
  order?: number;
  probability?: number;
  isWon?: boolean;
  isLost?: boolean;
}

export type UpdateStageInput = Partial<Omit<CreateStageInput, "pipelineId">>;
