// Reconstruido desde el contrato real del backend (src/controllers/branch.controller.ts,
// src/services/branch.service.ts, prisma/schema.prisma modelo Branch). Nació en
// la Fase 3 de docs/qr-integration.md solo con la lectura (GET /api/branches)
// para el selector de sucursal del módulo QR; el CRUD completo llegó con el
// ítem 20 de docs/frontend-cambios-pendientes.md (pantalla "Sucursales").

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

// createBranchSchema de branch.controller.ts: los dos campos son requeridos.
// `timezone` tiene que ser una zona IANA que el runtime reconozca
// (esZonaHorariaValida en src/utils/timezone.ts, que además rechaza offsets
// crudos como "-03:00"); el frontend la acota a una lista corta — ver
// timezones.ts — pero la validación real sigue siendo del backend.
export interface CreateBranchInput {
  name: string;
  timezone: string;
}

// updateBranchSchema: los mismos campos, parciales, al menos uno. No hay
// campos inmutables (a diferencia de `type` en Source), así que acá sí es un
// Partial del create.
export type UpdateBranchInput = Partial<CreateBranchInput>;
