// Reconstruido desde el contrato real del backend (src/routes/invitation.routes.ts,
// src/controllers/invitation.controller.ts, src/services/invitation.service.ts,
// src/repositories/invitation.repository.ts, prisma/schema.prisma modelo
// Invitation). No se agrega ningún campo que el backend no devuelva o no
// acepte: no hay token propio (ver informe de diseño de M7, sección P).

export type InvitationStatus = "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED";

export const INVITATION_STATUSES: InvitationStatus[] = [
  "PENDING",
  "ACCEPTED",
  "REVOKED",
  "EXPIRED",
];

export const INVITATION_STATUS_LABELS: Record<InvitationStatus, string> = {
  PENDING: "Pendiente",
  ACCEPTED: "Aceptada",
  REVOKED: "Revocada",
  EXPIRED: "Vencida",
};

// roleId/invitedById viajan como UUID crudo — ni findManyInvitations ni
// findInvitationById usan `include` (a diferencia de user.repository.ts,
// que sí incluye `role`). No se inventa una resolución que el contrato no
// da: ver invitation/relationResolution.ts para invitedById (resoluble vía
// GET /api/users existente) y el fallback "—" para roleId (no resoluble,
// no existe GET /api/roles).
export interface Invitation {
  id: string;
  organizationId: string;
  email: string;
  roleId: string;
  invitedById: string;
  status: InvitationStatus;
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InvitationListPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface InvitationListResponse {
  data: Invitation[];
  pagination: InvitationListPagination;
}

export type InvitationSortBy = "createdAt" | "expiresAt";
export type SortOrder = "asc" | "desc";

// Filtros reales de GET /api/invitations (invitation.controller.ts
// listQuerySchema): solo status. Sin búsqueda por email — el contrato no
// la expone.
export interface InvitationListQuery {
  page?: number;
  pageSize?: number;
  status?: InvitationStatus;
  sortBy?: InvitationSortBy;
  sortOrder?: SortOrder;
}

// role (no roleId): el backend resuelve roleId server-side desde este
// string — el cliente nunca envía un roleId crudo. organizationId nunca es
// un campo de este input (sale de req.auth.organizationId).
export interface CreateInvitationInput {
  email: string;
  role: "ADMIN" | "USER";
}
