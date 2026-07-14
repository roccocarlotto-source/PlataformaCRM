// Reconstruido desde el contrato real del backend (src/controllers/contact.controller.ts,
// src/services/contact.service.ts, prisma/schema.prisma modelo Contact). No se
// agrega ningún campo que el backend no devuelva o no acepte.

export type LifecycleStage = "LEAD" | "MQL" | "SQL" | "CUSTOMER" | "CHURNED";

export interface Contact {
  id: string;
  organizationId: string;
  companyId: string | null;
  ownerId: string | null;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  jobTitle: string | null;
  lifecycleStage: LifecycleStage;
  source: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface ContactListPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ContactListResponse {
  data: Contact[];
  pagination: ContactListPagination;
}

export type ContactSortBy = "firstName" | "lastName" | "createdAt" | "lifecycleStage";
export type SortOrder = "asc" | "desc";

// Filtros expuestos en M3: search (cubre firstName/lastName/email vía OR
// server-side), companyId, lifecycleStage, sortBy/sortOrder. ownerId se
// tipa (igual criterio que Company) pero sin filtro visual — ver M2, mismo
// motivo: sin GET /api/users no hay forma de mostrar nombres reales.
// firstName/lastName/email/source individuales no se exponen como filtros
// separados: search ya cubre el caso de uso, y agregarlos sin un control
// visual real sería un campo sin consumidor.
export interface ContactListQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  companyId?: string;
  ownerId?: string;
  lifecycleStage?: LifecycleStage;
  sortBy?: ContactSortBy;
  sortOrder?: SortOrder;
}

// companyId/ownerId: opcionales, tipados como `string` (nunca `string | null`)
// — el backend no soporta limpiarlos a null vía PATCH (contact.service.ts:
// `if (input.companyId)`/`if (input.ownerId)`, chequeo truthy).
//
// email/phone/jobTitle/source: aunque contact.service.ts tipa su
// UpdateContactInput interno como `string | null`, el schema Zod real de
// contact.controller.ts (`contactFields`) solo tiene `.optional()`, sin
// `.nullable()` — un PATCH con `email: null` sería rechazado por Zod antes
// de llegar al service. El contrato HTTP real (lo único que el frontend
// puede ejercitar) es "string opcional", nunca null explícito — se tipa
// acá según ese contrato real, no según el tipo interno del backend.
export interface CreateContactInput {
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  jobTitle?: string;
  lifecycleStage?: LifecycleStage;
  source?: string;
  companyId?: string;
  ownerId?: string;
}

export type UpdateContactInput = Partial<CreateContactInput>;
