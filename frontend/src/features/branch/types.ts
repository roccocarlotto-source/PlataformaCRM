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
  // Vendedor por defecto de la sucursal (ítem 69). `null` = sin ninguno, que
  // es el estado de todas las sucursales anteriores a ese ítem y un estado
  // perfectamente válido.
  defaultOwnerId: string | null;
  // Datos de cobro (ítem 74) que el agente comparte con get_payment_info.
  // Independientes: cada uno en `null` = no configurado.
  paymentLinkUrl: string | null;
  bankTransferDetails: string | null;
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
  // UUID opcional Y nullable en el borde del backend (branchFields de
  // branch.controller.ts): `null` es la forma explícita de decir "sin vendedor
  // por defecto", y el formulario manda siempre la clave, con null cuando no se
  // eligió a nadie — igual que manda siempre name y timezone.
  defaultOwnerId?: string | null;
  // Datos de cobro (ítem 74), opcionales y nullable en el borde igual que
  // defaultOwnerId. El formulario manda siempre las dos claves, con null
  // cuando el campo quedó vacío: el backend rechaza el string vacío.
  // paymentLinkUrl tiene que empezar con http(s):// (mismo criterio que
  // destinationUrl del QR); bankTransferDetails es texto libre hasta 2000.
  paymentLinkUrl?: string | null;
  bankTransferDetails?: string | null;
}

// updateBranchSchema: los mismos campos, parciales, al menos uno. No hay
// campos inmutables (a diferencia de `type` en Source), así que acá sí es un
// Partial del create.
export type UpdateBranchInput = Partial<CreateBranchInput>;

// ---------------------------------------------------------------------------
// Conexión de la sucursal con Google Calendar (ítem 75) — CAMPOS_PUBLICOS de
// src/repositories/googleCalendarConnection.repository.ts. Nunca trae el
// refresh token: el backend lo excluye con un `select`.
// ---------------------------------------------------------------------------

// ACTIVE: conectada y utilizable. REVOKED: la desconectó un ADMIN (la fila
// queda, sin token). ERROR: Google rechazó el grant; lastErrorMessage dice por
// qué.
export type GoogleCalendarConnectionStatus = "ACTIVE" | "REVOKED" | "ERROR";

export interface GoogleCalendarConnection {
  id: string;
  organizationId: string;
  branchId: string;
  calendarId: string;
  status: GoogleCalendarConnectionStatus;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
  connectedAt: string;
  createdAt: string;
  updatedAt: string;
}

// La respuesta de POST /branches/:branchId/google-calendar/connect: la URL de
// autorización de Google, en el cuerpo y no como un 302 (ver iniciarConexion
// en el backend: un redirect no llevaría el header Authorization).
export interface GoogleCalendarAuthorization {
  authorizationUrl: string;
}
