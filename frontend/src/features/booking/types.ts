// Reconstruido desde el contrato real del backend (src/controllers/booking.controller.ts,
// src/repositories/booking.repository.ts, prisma/schema.prisma modelo Booking).
// Nació con el ítem 75 de docs/frontend-cambios-pendientes.md con la lectura y
// la cancelación; el ítem 77 (calendario de la Agenda) sumó el alta manual.

export type BookingStatus = "CONFIRMED" | "CANCELLED" | "COMPLETED" | "NO_SHOW";

// Sin include en el repositorio: llegan los ids crudos, y los nombres se
// resuelven del lado del cliente (sucursal, recurso, servicio, contacto).
export interface Booking {
  id: string;
  organizationId: string;
  branchId: string;
  serviceTypeId: string;
  resourceId: string;
  contactId: string;
  opportunityId: string | null;
  // Instantes reales en ISO (UTC). Se muestran en la zona de la sucursal.
  startsAt: string;
  endsAt: string;
  status: BookingStatus;
  googleEventId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BookingListPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface BookingListResponse {
  data: Booking[];
  pagination: BookingListPagination;
}

export type BookingSortBy = "startsAt" | "createdAt";
export type SortOrder = "asc" | "desc";

// listQuerySchema de booking.controller.ts. `from`/`to` son instantes ISO 8601
// CON zona (el backend rechaza uno sin zona) y filtran sobre startsAt:
// startsAt >= from y startsAt < to.
export interface BookingListQuery {
  page?: number;
  pageSize?: number;
  branchId?: string;
  resourceId?: string;
  serviceTypeId?: string;
  contactId?: string;
  status?: BookingStatus;
  from?: string;
  to?: string;
  sortBy?: BookingSortBy;
  sortOrder?: SortOrder;
}

// createBookingSchema de booking.controller.ts. SIN endsAt: sale de la duración
// del servicio. `startsAt` es un instante ISO CON zona. `force` (ítem 77) es
// solo de ADMIN: saltea el horario de trabajo y la grilla, nunca la capacidad
// ni el pasado; un no-ADMIN que lo manda recibe 403. Sin opportunityId: el
// calendario no lo ofrece.
export interface CreateBookingInput {
  resourceId: string;
  serviceTypeId: string;
  contactId: string;
  startsAt: string;
  force?: boolean;
}
