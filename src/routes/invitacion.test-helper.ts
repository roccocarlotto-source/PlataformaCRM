import { createClient } from "@supabase/supabase-js";
import { env } from "../config/env";
import { prisma } from "../lib/prisma";
import { getSupabaseAdmin } from "../lib/supabaseAdmin";
import type { OrgDePrueba, Respuesta } from "./gateDeModulos.test-helper";

type Pedir = (
  org: OrgDePrueba,
  metodo: string,
  path: string,
  body?: unknown,
  token?: string | null,
) => Promise<Respuesta>;

export interface InvitacionAceptada {
  /** Las opciones con que se llamó a inviteUserByEmail (redirectTo, data). */
  opcionesDelMail: { redirectTo?: string; data?: Record<string, unknown> } | undefined;
  invitationId: string;
  /** La sesión real del invitado, como la deja el link del mail. */
  tokenDelInvitado: string;
  aceptar: Respuesta;
}

/** Una invitación de punta a punta, como en producción: POST /api/invitations
 *  como ADMIN (con inviteUserByEmail real, solo espiado para leer sus
 *  opciones), la sesión real del invitado y POST /api/invitations/accept con
 *  ella, que es lo que hace AcceptInvitationPage. El link del mail no se
 *  sigue: la contraseña se fija por la Admin API para iniciar sesión. */
export async function invitarYAceptar(
  pedir: Pedir,
  org: OrgDePrueba,
  tokenDelAdmin: string,
  invitacion: { email: string; role: string; branchIds?: string[] },
  fullName: string,
): Promise<InvitacionAceptada> {
  const adminApi = getSupabaseAdmin().auth.admin as unknown as {
    inviteUserByEmail: (email: string, opciones?: InvitacionAceptada["opcionesDelMail"]) => unknown;
  };
  const original = adminApi.inviteUserByEmail.bind(adminApi);
  let opcionesDelMail: InvitacionAceptada["opcionesDelMail"];
  adminApi.inviteUserByEmail = (email, opciones) => {
    opcionesDelMail = opciones;
    return original(email, opciones);
  };
  let creada: Respuesta;
  try {
    creada = await pedir(org, "POST", "/api/invitations", invitacion, tokenDelAdmin);
  } finally {
    adminApi.inviteUserByEmail = original;
  }
  if (creada.status !== 201) throw new Error(`invitar: ${JSON.stringify(creada.json)}`);
  const invitationId = creada.json.id as string;

  const [identidad] = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM auth.users WHERE email = ${invitacion.email}`;
  const password = "Invitacion-de-prueba-123!";
  const { error } = await getSupabaseAdmin().auth.admin.updateUserById(identidad.id, {
    password,
    email_confirm: true,
  });
  if (error) throw new Error(`updateUserById: ${error.message}`);
  const anon = createClient(env.SUPABASE_URL!, env.SUPABASE_ANON_KEY!);
  const sesion = await anon.auth.signInWithPassword({ email: invitacion.email, password });
  if (sesion.error || !sesion.data.session) throw new Error(`signIn: ${sesion.error?.message}`);
  const tokenDelInvitado = sesion.data.session.access_token;

  const aceptar = await pedir(
    org,
    "POST",
    "/api/invitations/accept",
    { fullName, invitationId },
    tokenDelInvitado,
  );
  return { opcionesDelMail, invitationId, tokenDelInvitado, aceptar };
}
