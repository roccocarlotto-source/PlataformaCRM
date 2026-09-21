// Reconstruido desde el contrato real del backend (src/controllers/resource.controller.ts,
// src/controllers/workingHours.controller.ts, src/services/workingHours.service.ts,
// prisma/schema.prisma modelos Resource y WorkingHours). Nació con el ítem 75 de
// docs/frontend-cambios-pendientes.md: el módulo de Agenda estaba completo en el
// backend y no tenía ninguna pantalla.

export type ResourceType = "PERSON" | "ROOM" | "CLASS";

export interface Resource {
  id: string;
  organizationId: string;
  branchId: string;
  name: string;
  type: ResourceType;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface ResourceListPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ResourceListResponse {
  data: Resource[];
  pagination: ResourceListPagination;
}

export type ResourceSortBy = "name" | "createdAt" | "type";
export type SortOrder = "asc" | "desc";

// listQuerySchema de resource.controller.ts.
export interface ResourceListQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  branchId?: string;
  type?: ResourceType;
  sortBy?: ResourceSortBy;
  sortOrder?: SortOrder;
}

// createResourceSchema: los tres campos son requeridos.
export interface CreateResourceInput {
  branchId: string;
  name: string;
  type: ResourceType;
}

// updateResourceSchema: name y type, parciales. SIN branchId — un recurso no
// cambia de sucursal (ver resource.service.ts), y mandarlo es un 400, no un
// campo que se ignora. Por eso no es un Partial del create.
export interface UpdateResourceInput {
  name?: string;
  type?: ResourceType;
}

// ---------------------------------------------------------------------------
// Horario de trabajo — GET/PUT /api/resources/:resourceId/working-hours.
// ---------------------------------------------------------------------------

export type Weekday =
  "MONDAY" | "TUESDAY" | "WEDNESDAY" | "THURSDAY" | "FRIDAY" | "SATURDAY" | "SUNDAY";

// La API habla "HH:MM" (la base guarda minutos; la traducción vive en el
// controller). "24:00" es válido como fin: medianoche del día siguiente.
export interface WorkingHoursSlot {
  weekday: Weekday;
  startTime: string;
  endTime: string;
}

// La misma forma para el GET, el cuerpo del PUT y su respuesta.
export interface WorkingHoursPayload {
  workingHours: WorkingHoursSlot[];
}
