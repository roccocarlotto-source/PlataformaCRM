// Reconstruido desde el contrato real del backend (src/controllers/user.controller.ts,
// src/services/user.service.ts, prisma/schema.prisma modelo User). Alcance de M5:
// únicamente lectura (GET /api/users) para resolver el selector de owner de
// Opportunity — no se implementa administración de Users (fuera de alcance,
// ver docs/project-overview.md).

import type { RoleName } from "../../auth/AuthContext";

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
  // Ítem 179: si un ADMIN le habilitó el agente de IA interno. Para un ADMIN
  // no cambia nada (siempre tiene acceso), pero se guarda igual.
  canUseInternalAgent: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  role: Role;
  // R20: las sedes vigentes del usuario, solo en una clínica ([] = sin sedes).
  // Una automotora no tiene la clave.
  branches?: { id: string; name: string }[];
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
  role?: RoleName;
  isActive?: boolean;
  sortBy?: UserSortBy;
  sortOrder?: SortOrder;
}

// M7: PATCH /api/users/:id (user.controller.ts, updateUserSchema) — SOLO
// isActive, role y (desde el ítem 179) canUseInternalAgent.
// email/fullName/id/organizationId no son campos de este schema, ni siquiera
// llegan al service — no se agregan acá tampoco.
export interface UpdateUserInput {
  isActive?: boolean;
  role?: RoleName;
  canUseInternalAgent?: boolean;
  // R20: las sedes de una Recepción de clínica. El backend las ignora en una
  // automotora.
  branchIds?: string[];
}
