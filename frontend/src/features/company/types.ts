// Reconstruido desde el contrato real del backend (src/controllers/company.controller.ts,
// src/services/company.service.ts, prisma/schema.prisma modelo Company). No se
// agrega ningún campo que el backend no devuelva o no acepte.

export interface Company {
  id: string;
  organizationId: string;
  ownerId: string | null;
  name: string;
  domain: string | null;
  industry: string | null;
  phone: string | null;
  city: string | null;
  country: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface CompanyListPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface CompanyListResponse {
  data: Company[];
  pagination: CompanyListPagination;
}

export type CompanySortBy = "name" | "createdAt" | "industry";
export type SortOrder = "asc" | "desc";

// ownerId: soporte de capa API (tipado + serialización) implementado acá.
// El filtro VISUAL por nombre en CompanyListPage y el selector de
// asignación/reasignación en CompanyFormPage quedan diferidos — no porque
// falte esta capa, sino porque mostrar un nombre real (en vez de un UUID
// crudo, que no es un control visual aceptable) requiere GET /api/users,
// que el frontend no consume todavía. Esto no depende de que exista una
// pantalla de administración de Users: GET /api/users puede consumirse de
// forma independiente en cuanto se necesite el picker.
export interface CompanyListQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  industry?: string;
  ownerId?: string;
  sortBy?: CompanySortBy;
  sortOrder?: SortOrder;
}

// ownerId: opcional en create y en update, igual que en el backend
// (companyFields en company.controller.ts). Si se omite en create, el
// backend asigna a quien crea (resolveOwnerId) — comportamiento server-side,
// no algo que el frontend deba replicar. Deliberadamente tipado como
// `string` (nunca `string | null`): el backend NO soporta limpiar ownerId a
// null vía PATCH (company.service.ts solo lo cambia con `if (input.ownerId)`,
// chequeo truthy) — no inventar esa nullability acá.
export interface CreateCompanyInput {
  name: string;
  domain?: string;
  industry?: string;
  phone?: string;
  city?: string;
  country?: string;
  ownerId?: string;
}

export type UpdateCompanyInput = Partial<CreateCompanyInput>;
