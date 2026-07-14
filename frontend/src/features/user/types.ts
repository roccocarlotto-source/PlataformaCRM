// Reconstruido desde el contrato real del backend (src/controllers/user.controller.ts,
// src/services/user.service.ts, prisma/schema.prisma modelo User). Alcance de M5:
// únicamente lectura (GET /api/users) para resolver el selector de owner de
// Opportunity — no se implementa administración de Users (fuera de alcance,
// ver docs/project-overview.md).

export interface Role {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface User {
  id: string;
  organizationId: string;
  roleId: string;
  email: string;
  fullName: string;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  role: Role;
}

export interface UserListPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface UserListResponse {
  data: User[];
  pagination: UserListPagination;
}

export type UserSortBy = "fullName" | "createdAt";
export type SortOrder = "asc" | "desc";

// GET /api/users es ADMIN-only (user.routes.ts) y no tiene filtro `search` ni
// GET /api/users/:id — a diferencia de Company/Contact/Pipeline/Stage. M5 solo
// consume el listado (page/pageSize/isActive/sortBy/sortOrder) para el
// selector de owner; nunca un picker con búsqueda de texto porque el
// contrato no la soporta.
export interface UserListQuery {
  page?: number;
  pageSize?: number;
  role?: "ADMIN" | "USER";
  isActive?: boolean;
  sortBy?: UserSortBy;
  sortOrder?: SortOrder;
}
