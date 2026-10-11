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

export type OpcionesDelMail = { redirectTo?: string; data?: Record<string, unknown> } | undefined;

/** Corre `fn` con inviteUserByEmail real (GoTrue local), solo espiado: junta
 *  el email y las opciones de cada llamada. */
export async function espiarInvitaciones<T>(
  fn: () => Promise<T>,
): Promise<{ resultado: T; llamadas: { email: string; opciones: OpcionesDelMail }[] }> {
  const adminApi = getSupabaseAdmin().auth.admin as unknown as {
    inviteUserByEmail: (email: string, opciones?: OpcionesDelMail) => unknown;
  };
  const original = adminApi.inviteUserByEmail.bind(adminApi);
  const llamadas: { email: string; opciones: OpcionesDelMail }[] = [];
  adminApi.inviteUserByEmail = (email, opciones) => {
    llamadas.push({ email, opciones });
    return original(email, opciones);
  };
  try {
    return { resultado: await fn(), llamadas };
  } finally {
    adminApi.inviteUserByEmail = original;
  }
}

/** POST /api/invitations como ADMIN, con inviteUserByEmail espiado. */
export async function invitar(
  pedir: Pedir,
  org: OrgDePrueba,
  tokenDelAdmin: string,
  invitacion: { email: string; role: string; branchIds?: string[] },
): Promise<{ invitationId: string; opcionesDelMail: OpcionesDelMail }> {
  const { resultado: creada, llamadas } = await espiarInvitaciones(() =>
    pedir(org, "POST", "/api/invitations", invitacion, tokenDelAdmin),
  );
  if (creada.status !== 201) throw new Error(`invitar: ${JSON.stringify(creada.json)}`);
  return { invitationId: creada.json.id as string, opcionesDelMail: llamadas[0]?.opciones };
}

/** Acepta como lo hace AcceptInvitationPage: la sesión real del invitado y
 *  POST /api/invitations/accept con ella. El link del mail no se sigue: la
 *  contraseña se fija por la Admin API para iniciar sesión. */
export async function aceptar(
  pedir: Pedir,
  org: OrgDePrueba,
  email: string,
  invitationId: string,
  fullName: string,
): Promise<{ tokenDelInvitado: string; aceptar: Respuesta }> {
  const [identidad] = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM auth.users WHERE email = ${email}`;
  const password = "Invitacion-de-prueba-123!";
  const { error } = await getSupabaseAdmin().auth.admin.updateUserById(identidad.id, {
    password,
    email_confirm: true,
  });
  if (error) throw new Error(`updateUserById: ${error.message}`);
  const anon = createClient(env.SUPABASE_URL!, env.SUPABASE_ANON_KEY!);
  const sesion = await anon.auth.signInWithPassword({ email, password });
  if (sesion.error || !sesion.data.session) throw new Error(`signIn: ${sesion.error?.message}`);
  const tokenDelInvitado = sesion.data.session.access_token;
  const respuesta = await pedir(
    org,
    "POST",
    "/api/invitations/accept",
    { fullName, invitationId },
    tokenDelInvitado,
  );
  return { tokenDelInvitado, aceptar: respuesta };
}

export interface InvitacionAceptada {
  /** Las opciones con que se llamó a inviteUserByEmail (redirectTo, data). */
  opcionesDelMail: OpcionesDelMail;
  invitationId: string;
  /** La sesión real del invitado, como la deja el link del mail. */
  tokenDelInvitado: string;
  aceptar: Respuesta;
}

/** Una invitación de punta a punta, como en producción: invitar y aceptar. */
export async function invitarYAceptar(
  pedir: Pedir,
  org: OrgDePrueba,
  tokenDelAdmin: string,
  invitacion: { email: string; role: string; branchIds?: string[] },
  fullName: string,
): Promise<InvitacionAceptada> {
  const { invitationId, opcionesDelMail } = await invitar(pedir, org, tokenDelAdmin, invitacion);
  const aceptada = await aceptar(pedir, org, invitacion.email, invitationId, fullName);
  return { opcionesDelMail, invitationId, ...aceptada };
}
