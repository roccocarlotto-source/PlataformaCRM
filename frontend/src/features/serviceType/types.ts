// Reconstruido desde el contrato real del backend (src/controllers/serviceType.controller.ts,
// src/services/serviceType.service.ts, prisma/schema.prisma modelo ServiceType).
// Nació con el ítem 75 de docs/frontend-cambios-pendientes.md.

export interface ServiceType {
  id: string;
  organizationId: string;
  branchId: string;
  resourceId: string;
  name: string;
  // Minutos, entero, 1..1440.
  durationMin: number;
  // 1 = turno exclusivo, N = clase con cupo.
  capacity: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface ServiceTypeListPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ServiceTypeListResponse {
  data: ServiceType[];
  pagination: ServiceTypeListPagination;
}

export type ServiceTypeSortBy = "name" | "createdAt" | "durationMin";
export type SortOrder = "asc" | "desc";

// listQuerySchema de serviceType.controller.ts.
export interface ServiceTypeListQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  branchId?: string;
  resourceId?: string;
  sortBy?: ServiceTypeSortBy;
  sortOrder?: SortOrder;
}

// createServiceTypeSchema. capacity es opcional: sin ella el backend pone 1.
export interface CreateServiceTypeInput {
  branchId: string;
  resourceId: string;
  name: string;
  durationMin: number;
  capacity?: number;
}

// updateServiceTypeSchema: los mismos campos, parciales. branchId SÍ se puede
// cambiar (a diferencia de Resource), pero el service exige que venga junto con
// resourceId: el recurso viejo pertenece a la sucursal vieja.
export type UpdateServiceTypeInput = Partial<CreateServiceTypeInput>;
