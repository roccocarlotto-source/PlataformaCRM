// Reconstruido desde el contrato real del backend (src/controllers/branch.controller.ts,
// src/services/branch.service.ts, prisma/schema.prisma modelo Branch). Alcance
// de Fase 3 de docs/qr-integration.md (decisión 5): únicamente lectura
// (GET /api/branches) para el selector de sucursal del módulo QR — no se
// implementa CRUD de sucursales (feature aparte, fuera de este plan).

export interface Branch {
  id: string;
  organizationId: string;
  name: string;
  timezone: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface BranchListPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface BranchListResponse {
  data: Branch[];
  pagination: BranchListPagination;
}

export type BranchSortBy = "name" | "createdAt";
export type SortOrder = "asc" | "desc";

// listQuerySchema de branch.controller.ts: page/pageSize/search/sortBy/sortOrder.
// `search` existe en el contrato pero BranchSelect no lo usa (select simple,
// mismo criterio que UserSelect) — se tipa porque es real, no porque se consuma.
export interface BranchListQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  sortBy?: BranchSortBy;
  sortOrder?: SortOrder;
}
