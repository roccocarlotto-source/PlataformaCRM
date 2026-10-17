import { logger } from "../../lib/logger";
import { prisma } from "../../lib/prisma";
import { esErrorDeEmailDuplicado, revertirIdentidad } from "../../services/authIdentity.service";
import {
  createOrganizationWithFoundingAdmin,
  defaultOrganizationAdminDeps,
  type CreateOrganizationWithFoundingAdminResult,
  type OrganizationAdminDeps,
} from "../../services/organizationAdmin.service";
import { activarModulo } from "../../services/organizationModules.service";
import { AppError } from "../../utils/AppError";
import {
  nombreDeLaDemo,
  ORGANIZACION,
  ROL_DEL_USUARIO,
  ZONA_DE_LA_DEMO,
  type ClaveDeUsuario,
} from "./config";
import {
  cargarDatosDeEjemplo,
  type OpcionesDeLaDemo,
  type ResumenDeDatosDeEjemplo,
  type UsuariosDeLaDemo,
} from "./datosDeEjemplo";

// ---------------------------------------------------------------------------
// Alta del Taller Demo (docs/taller-demo.md), por un platform admin:
// POST /api/admin/organizations/taller-demo. Misma forma que la Clínica Demo
// (src/clinicas/demo/clinicaDemo.service.ts), con tres diferencias:
//
//   1. Nace en MODO DEMO (opción tallerDemo del alta → organizations.is_demo):
//      es el único camino que pone la bandera, y va antes que cualquier dato
//      porque los teléfonos inventados pueden existir.
//   2. Activa el módulo Servicios en el alta (activarModulo, el mismo camino
//      que Plataforma → Organizaciones → Activar Servicios).
//   3. Crea TRES usuarios: el admin como fundador (la invitación real de
//      siempre) y dos más (vendedor y encargado del taller) con el mismo
//      mecanismo del fundador —identidad en Supabase Auth + fila en users,
//      sin fila de Invitation— y no por createInvitation. Dos motivos: la
//      invitación lleva como "quien invita" a un usuario de la misma
//      organización (FK compuesta), y así los tres existen desde el alta y los
//      datos de ejemplo ya se les pueden asignar (tareas, órdenes, sucursales).
//
//      El mail de cada uno sale por inviteUserByEmail, que tiene un cupo por
//      hora bajo en el correo integrado de Supabase (2 por hora sin SMTP
//      propio). Por eso la identidad se crea PRIMERO con createUser (no manda
//      nada) y el mail va después, a mejor esfuerzo: si el cupo lo frena, el
//      usuario existe igual y `invitacionEnviada` queda en false. Se reenvía
//      desde Plataforma → Organizaciones → "Reenviar invitación", que en una
//      demo cubre a todos los usuarios que no abrieron el mail
//      (reenviarInvitacionDelAdministrador).
// ---------------------------------------------------------------------------

export interface UsuarioDeLaDemoInput {
  fullName: string;
  email: string;
}

export interface CrearTallerDemoInput {
  /** "Este" → "Taller Demo Este" (slug taller-demo-este). */
  sufijo?: string;
  usuarios: Record<ClaveDeUsuario, UsuarioDeLaDemoInput>;
}

export interface UsuarioDeLaDemoCreado {
  id: string;
  email: string;
  fullName: string;
  role: "ADMIN" | "USER";
  /** Si salió el mail para elegir la contraseña. El del admin sale siempre
   *  (sin él no hay alta). */
  invitacionEnviada: boolean;
}

export interface TallerDemoCreado extends CreateOrganizationWithFoundingAdminResult {
  usuarios: Record<ClaveDeUsuario, UsuarioDeLaDemoCreado>;
  datosDeEjemplo: ResumenDeDatosDeEjemplo;
}

export const EMAILS_REPETIDOS = "Los tres usuarios de la demo tienen que tener emails distintos.";
export const DATOS_DE_EJEMPLO_FALLIDOS =
  "El Taller Demo se creó, pero no se pudieron cargar los datos de ejemplo. Borralo a mano antes de volver a intentar.";
export function usuarioDeLaDemoFallido(clave: ClaveDeUsuario): string {
  return `El Taller Demo se creó, pero no se pudo crear el usuario "${clave}". Borralo a mano antes de volver a intentar.`;
}

const ORDEN: ClaveDeUsuario[] = ["admin", "vendedor", "taller"];

export async function crearTallerDemo(
  input: CrearTallerDemoInput,
  deps: OrganizationAdminDeps = defaultOrganizationAdminDeps,
  opciones: OpcionesDeLaDemo = {},
): Promise<TallerDemoCreado> {
  // Misma normalización que el alta y las invitaciones.
  const emails = Object.fromEntries(
    ORDEN.map((clave) => [clave, input.usuarios[clave].email.trim().toLowerCase()]),
  ) as Record<ClaveDeUsuario, string>;
  if (new Set(Object.values(emails)).size !== ORDEN.length) {
    throw new AppError(EMAILS_REPETIDOS, 400);
  }
  // Los pre-chequeos de los dos usuarios extra, ANTES de crear nada: un 409
  // acá no deja ninguna organización a medias. (Los del admin los hace el
  // alta, con los mismos mensajes.)
  for (const clave of ["vendedor", "taller"] as const) {
    if (await deps.findUserByEmail(emails[clave])) {
      throw new AppError("Ya existe una cuenta con ese email", 409);
    }
    if (await deps.findPendingInvitationByEmail(emails[clave])) {
      throw new AppError(
        "Ese email tiene una invitación pendiente a otra organización. Resolvela antes de darle de alta una organización propia.",
        409,
      );
    }
  }

  const creada = await createOrganizationWithFoundingAdmin(
    {
      organizationName: nombreDeLaDemo(input.sufijo),
      adminFullName: input.usuarios.admin.fullName,
      adminEmail: emails.admin,
      edition: "COMPLETA",
      industry: "AUTOMOTORA",
      defaultPhoneCountryCode: ORGANIZACION.defaultPhoneCountryCode,
      preferredCurrency: ORGANIZACION.preferredCurrency,
      timezone: ZONA_DE_LA_DEMO,
    },
    deps,
    { tallerDemo: true },
  );
  const organizationId = creada.organization.id;
  const platformAdminUserId = opciones.platformAdminUserId ?? creada.admin.id;

  const usuarios: Record<ClaveDeUsuario, UsuarioDeLaDemoCreado> = {
    admin: { ...creada.admin, invitacionEnviada: true },
    vendedor: await crearUsuarioDeLaDemo(organizationId, "vendedor", input, emails, deps),
    taller: await crearUsuarioDeLaDemo(organizationId, "taller", input, emails, deps),
  };

  try {
    await activarModulo(organizationId, "servicios", platformAdminUserId);
    const ids: UsuariosDeLaDemo = {
      admin: usuarios.admin.id,
      vendedor: usuarios.vendedor.id,
      taller: usuarios.taller.id,
    };
    const datosDeEjemplo = await cargarDatosDeEjemplo(organizationId, ids, {
      ...opciones,
      platformAdminUserId,
    });
    return { ...creada, usuarios, datosDeEjemplo };
  } catch (err) {
    // La organización y sus usuarios ya existen: no se compensan (los mails
    // ya salieron). Se informa para que Rocco la borre a mano.
    logger.error(
      { err, organizationId },
      "No se pudieron cargar los datos de ejemplo del Taller Demo",
    );
    throw new AppError(DATOS_DE_EJEMPLO_FALLIDOS, 500);
  }
}

// Un usuario más de la demo, con el mecanismo del fundador: identidad en
// Supabase Auth (createUser, sin mail) + fila en users; el mail después, a
// mejor esfuerzo. Si la fila en users falla, se revierte la identidad.
async function crearUsuarioDeLaDemo(
  organizationId: string,
  clave: "vendedor" | "taller",
  input: CrearTallerDemoInput,
  emails: Record<ClaveDeUsuario, string>,
  deps: OrganizationAdminDeps,
): Promise<UsuarioDeLaDemoCreado> {
  const fullName = input.usuarios[clave].fullName.trim();
  const email = emails[clave];
  const supabaseAdmin = deps.supabaseAdmin();

  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    email_confirm: false,
    user_metadata: { full_name: fullName },
  });
  if (error || !data.user) {
    if (esErrorDeEmailDuplicado(error)) {
      throw new AppError("Ese email ya está registrado en la plataforma", 409);
    }
    logger.error(
      { err: error, organizationId, clave },
      "Error creando la identidad de un usuario del Taller Demo",
    );
    throw new AppError(usuarioDeLaDemoFallido(clave), 502);
  }
  const authUserId = data.user.id;
  const emailCanonico = data.user.email ?? email;

  let creado: { id: string; email: string; fullName: string };
  try {
    const rol = await deps.findRoleByName(ROL_DEL_USUARIO[clave], prisma);
    if (!rol) {
      throw new AppError(
        "No se encontró el rol USER. Contactá al administrador del sistema.",
        500,
        false,
      );
    }
    creado = await deps.createUser(
      { id: authUserId, organizationId, roleId: rol.id, email: emailCanonico, fullName },
      prisma,
    );
  } catch (err) {
    await revertirIdentidad(
      supabaseAdmin,
      authUserId,
      `el alta del usuario ${clave} del Taller Demo`,
    );
    if (err instanceof AppError) throw err;
    logger.error({ err, organizationId, clave }, "Error creando un usuario del Taller Demo");
    throw new AppError(usuarioDeLaDemoFallido(clave), 500);
  }

  // El mail: GoTrue reenvía el invite a una identidad sin confirmar (B-22).
  // Si el cupo del correo lo frena, queda para "Reenviar invitación".
  const { error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(emailCanonico, {
    data: { full_name: fullName },
    redirectTo: `${deps.frontendOrigin}/reset-password`,
  });
  if (inviteError) {
    logger.warn(
      { err: inviteError, organizationId, clave },
      "Taller Demo: no salió el mail de invitación de un usuario; reenviarlo desde Plataforma",
    );
  }
  return {
    id: creado.id,
    email: creado.email,
    fullName: creado.fullName,
    role: ROL_DEL_USUARIO[clave],
    invitacionEnviada: !inviteError,
  };
}
