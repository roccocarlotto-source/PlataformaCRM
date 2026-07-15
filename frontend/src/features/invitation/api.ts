import { request } from "../../lib/api";
import { getAccessToken } from "../../auth/getAccessToken";
import type {
  CreateInvitationInput,
  Invitation,
  InvitationListQuery,
  InvitationListResponse,
} from "./types";

// Reutiliza request()/getAccessToken tal cual. organizationId nunca viaja
// acá: se resuelve exclusivamente server-side desde el JWT.
//
// Sin getInvitation(id): GET /api/invitations/:id no existe (invitation.routes.ts
// solo expone GET /invitations (list), POST /invitations, DELETE /invitations/:id,
// POST /invitations/accept). Sin resendInvitation: no existe ese endpoint.
function buildListQueryString(query: InvitationListQuery): string {
  const params = new URLSearchParams();
  if (query.page !== undefined) params.set("page", String(query.page));
  if (query.pageSize !== undefined) params.set("pageSize", String(query.pageSize));
  if (query.status) params.set("status", query.status);
  if (query.sortBy) params.set("sortBy", query.sortBy);
  if (query.sortOrder) params.set("sortOrder", query.sortOrder);
  const queryString = params.toString();
  return queryString ? `?${queryString}` : "";
}

export function listInvitations(
  query: InvitationListQuery,
  signal?: AbortSignal,
): Promise<InvitationListResponse> {
  return request<InvitationListResponse>(`/invitations${buildListQueryString(query)}`, {
    getAccessToken,
    signal,
  });
}

export function createInvitation(input: CreateInvitationInput): Promise<Invitation> {
  return request<Invitation>("/invitations", {
    method: "POST",
    body: input,
    getAccessToken,
  });
}

// DELETE /invitations/:id representa la transición PENDING -> REVOKED —
// nunca un hard delete (ver revoke.service.ts).
export function revokeInvitation(id: string): Promise<Invitation> {
  return request<Invitation>(`/invitations/${id}`, {
    method: "DELETE",
    getAccessToken,
  });
}
