import { request } from "../../lib/api";
import { getAccessToken } from "../../auth/getAccessToken";

// POST /api/invitations/accept — NO pasa por authenticate estándar (ver
// invitation.routes.ts / verifyInvitationAcceptIdentity), pero el frontend
// no necesita saber eso: reutiliza request()/getAccessToken tal cual, mismo
// mecanismo que cualquier otra llamada autenticada — la sesión de Supabase
// obtenida del link de invitación ya es una sesión válida como cualquier
// otra para supabase.auth.getSession().
export interface AcceptInvitationInput {
  fullName: string;
  invitationId?: string;
}

// Shape crudo de la fila User creada (user.repository.ts createUser: sin
// include, así que sin `role` anidado) — no se consume ningún campo hoy,
// se tipa igual para no devolver `unknown` sin necesidad.
export interface AcceptedUser {
  id: string;
  organizationId: string;
  roleId: string;
  email: string;
  fullName: string;
}

export function acceptInvitation(input: AcceptInvitationInput): Promise<AcceptedUser> {
  return request<AcceptedUser>("/invitations/accept", {
    method: "POST",
    body: input,
    getAccessToken,
  });
}
