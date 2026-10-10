import { Prisma, type OrganizationEdition, type OrganizationIndustry } from "@prisma/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { crearConfiguracionDeClinica } from "../clinicas/repositories/clinicSettings.repository";
import {
  CLINICA_HABILITADA,
  ESENCIAL_HABILITADA,
  ROLES_POR_RUBRO,
  edicionesDisponibles,
  rubrosDisponibles,
} from "../config/ediciones";
import { env } from "../config/env";
import { logger } from "../lib/logger";
import { prisma, type Db } from "../lib/prisma";
import { getSupabaseAdmin } from "../lib/supabaseAdmin";
import { findPendingInvitationByEmail } from "../repositories/invitation.repository";
import {
  createOrganization,
  createProcesoDeVentaFijo,
  contarDatosDeNegocio,
  contarInvitacionesPendientesConRoles,
  contarUsuariosConRoles,
  findActiveOrganizationEdition,
  findOrganizationBySlug,
  lockOrganizationForUpdate,
  rubroDeLaOrganizacionVigente,
  subirOrganizacionACompleta,
  updateOrganizationIndustry,
} from "../repositories/organization.repository";
import { findRoleByName } from "../repositories/role.repository";
import { createUser, findUserByEmail } from "../repositories/user.repository";
import { KNOWN_ROLES, type RoleName } from "../types/auth";
import { AppError } from "../utils/AppError";
import { slugify } from "../utils/slug";
import { vaciarContextosDeAuth } from "./auth.service";
import { esErrorDeEmailDuplicado, revertirIdentidad } from "./authIdentity.service";

// ---------------------------------------------------------------------------
// Alta de una organización nueva con su primer ADMIN, por un platform admin —
// Fase 4a del módulo SaaS.
//
// NO ES UN REGISTRO PÚBLICO. Quien llama es Rocco, logueado y verificado contra
// platform_admins en cada request (requirePlatformAdmin), cuando cierra un
// cliente nuevo. Eso es lo que permite que este flujo sea más simple que
// onboarding.service.ts, del que hereda la forma:
//
//   - No hay OTP. La prueba de control del email no la da quien registra, la
//     da el propio mail de invitación: la identidad nace SIN confirmar y se
//     confirma cuando el admin nuevo abre el link. Nadie puede "quemar" el
//     email de una víctima porque el único que puede llamar acá es el operador
//     de la plataforma.
//   - No hay password. `inviteUserByEmail` crea la identidad y manda el mail en
//     un solo paso; la contraseña la elige el invitado en /reset-password
//     (ResetPasswordPage no depende de ninguna Invitation, solo de que haya una
//     sesión de Supabase — la que deja el link de invite).
//   - Los pre-chequeos de onboarding se hacen ANTES de tocar Supabase, sin el
//     problema de oráculo que obligó a moverlos después del OTP allá (M-13):
//     acá el llamador ya está autenticado y es platform admin, no un endpoint
//     público.
//
// POR QUÉ NO SE USA Invitation. Su FK (organizationId, invitedById) →
// User(organizationId, id) exige que quien invita ya sea User de esa
// organización — imposible para una organización recién creada.
//
// DEPENDENCIAS INYECTABLES. Todo lo que toca Supabase o Postgres entra por
// `deps`, con los valores reales por defecto. Es lo que permite que el unit
// test cubra los cinco caminos que importan (409 por slug, 409 por email,
// camino feliz, fallo de Supabase, fallo de Prisma con compensación) sin
// Supabase ni base: `npm test` en CI solo tiene CORS_ORIGIN, y
// getSupabaseAdmin() tira si faltan SUPABASE_URL/SERVICE_ROLE_KEY. Los
// controllers y el test de integración no pasan deps y usan los defaults.
// ---------------------------------------------------------------------------

export interface CreateOrganizationWithFoundingAdminInput {
  organizationName: string;
  adminFullName: string;
  adminEmail: string;
  // docs/ediciones.md §1.1. Opcional por compatibilidad: sin ella, COMPLETA.
  edition?: OrganizationEdition;
  // docs/rubros.md §1.1. Opcional por compatibilidad: sin él, AUTOMOTORA.
  industry?: OrganizationIndustry;
}

export interface CreateOrganizationWithFoundingAdminResult {
  organization: {
    id: string;
    name: string;
    slug: string;
    edition: OrganizationEdition;
    industry: OrganizationIndustry;
  };
  admin: { id: string; email: string; fullName: string; role: "ADMIN" };
}

// Los tipos son el contrato MÍNIMO que el service usa de cada dependencia, no
// `typeof repositorio`: los repositorios devuelven clientes fluent de Prisma
// (Prisma__UserClient, etc.) que son Promises con extras, y exigir ese tipo
// exacto obligaría al test a fabricar uno. Las funciones reales encajan
// porque un PrismaPromise<T> es asignable a Promise<T>.
export interface OrganizationAdminDeps {
  supabaseAdmin: () => SupabaseClient;
  // Origen del frontend al que vuelve el link del mail de invitación. No
  // existe FRONTEND_URL/APP_URL: el primer valor de CORS_ORIGIN es, por
  // definición, el frontend que este backend sirve.
  frontendOrigin: string;
  findUserByEmail: (email: string) => Promise<{ id: string } | null>;
  findPendingInvitationByEmail: (email: string) => Promise<{ id: string } | null>;
  findOrganizationBySlug: (slug: string) => Promise<{ id: string } | null>;
  findRoleByName: (name: RoleName, db: Db) => Promise<{ id: string } | null>;
  createOrganization: (
    data: {
      name: string;
      slug: string;
      edition: OrganizationEdition;
      industry: OrganizationIndustry;
    },
    db: Db,
  ) => Promise<{
    id: string;
    name: string;
    slug: string;
    edition: OrganizationEdition;
    industry: OrganizationIndustry;
  }>;
  // El proceso de venta fijo de ESENCIAL (docs/ediciones.md §2.1).
  createProcesoDeVentaFijo: (organizationId: string, db: Db) => Promise<unknown>;
  // La llave ESENCIAL_HABILITADA (src/config/ediciones.ts). Inyectable para
  // que los tests cubran los dos valores sin tocar la constante.
  esencialHabilitada: boolean;
  // La configuración de la clínica (docs/rubros.md §1.3), en la transacción
  // del alta.
  createClinicSettings: (organizationId: string, db: Db) => Promise<unknown>;
  // La llave CLINICA_HABILITADA, inyectable por lo mismo que la de ESENCIAL.
  clinicaHabilitada: boolean;
  createUser: (
    data: { id: string; organizationId: string; roleId: string; email: string; fullName: string },
    db: Db,
  ) => Promise<{ id: string; email: string; fullName: string }>;
  transaction: <T>(fn: (tx: Db) => Promise<T>) => Promise<T>;
}

export function primaryCorsOrigin(corsOrigin: string = env.CORS_ORIGIN): string {
  return corsOrigin.split(",")[0].trim();
}

export const defaultOrganizationAdminDeps: OrganizationAdminDeps = {
  supabaseAdmin: getSupabaseAdmin,
  get frontendOrigin() {
    return primaryCorsOrigin();
  },
  findUserByEmail,
  findPendingInvitationByEmail,
  findOrganizationBySlug,
  findRoleByName,
  createOrganization,
  createProcesoDeVentaFijo,
  createUser,
  get esencialHabilitada() {
    return ESENCIAL_HABILITADA;
  },
  createClinicSettings: crearConfiguracionDeClinica,
  get clinicaHabilitada() {
    return CLINICA_HABILITADA;
  },
  transaction: (fn) => prisma.$transaction(fn),
};

export async function createOrganizationWithFoundingAdmin(
  input: CreateOrganizationWithFoundingAdminInput,
  deps: OrganizationAdminDeps = defaultOrganizationAdminDeps,
): Promise<CreateOrganizationWithFoundingAdminResult> {
  const { organizationName, adminFullName } = input;
  const edition = input.edition ?? "COMPLETA";

  // docs/ediciones.md §10, PR 4: ESENCIAL no se ofrece hasta el PR 5. Antes de
  // cualquier escritura (y del mail de invitación): un 400 acá no deja nada
  // que compensar.
  if (!edicionesDisponibles(deps.esencialHabilitada).includes(edition)) {
    throw new AppError(`La edición ${edition} todavía no está disponible.`, 400);
  }
  // docs/rubros.md §15, R3: lo mismo para CLINICA (CLINICA_HABILITADA).
  const industry = input.industry ?? "AUTOMOTORA";
  if (!rubrosDisponibles(deps.clinicaHabilitada).includes(industry)) {
    throw new AppError(`El rubro ${industry} todavía no está disponible.`, 400);
  }
  // Misma normalización que invitation.service.ts (normalizeEmail): el email
  // de public.users es único y se compara tal cual.
  const email = input.adminEmail.trim().toLowerCase();
  const slug = slugify(organizationName);

  // Mismo criterio que onboarding (M-13, bug 1): un nombre sin ningún carácter
  // ASCII alfanumérico slugifica a "" y no puede ser el identificador de nada.
  if (slug === "") {
    throw new AppError(
      "No se pudo generar un identificador a partir del nombre de la organización. Tiene que incluir al menos una letra o un número.",
      400,
    );
  }

  // ---------------------------------------------------------------------
  // 1. Pre-chequeos, antes de escribir nada en ningún lado. Cada uno
  //    responde 409 con el mismo mensaje que onboarding.service.ts.
  // ---------------------------------------------------------------------
  if (await deps.findUserByEmail(email)) {
    throw new AppError("Ya existe una cuenta con ese email", 409);
  }

  // Una invitación pendiente también significa que el email ya está hablado:
  // un User pertenece a exactamente una organización, así que crearle una
  // propia le impediría aceptar la invitación y la dejaría colgada.
  if (await deps.findPendingInvitationByEmail(email)) {
    throw new AppError(
      "Ese email tiene una invitación pendiente a otra organización. Resolvela antes de darle de alta una organización propia.",
      409,
    );
  }

  if (await deps.findOrganizationBySlug(slug)) {
    throw new AppError("Ya existe una organización con ese nombre", 409);
  }

  // ---------------------------------------------------------------------
  // 2. Identidad + mail de invitación, en un solo paso. Si falla, no hay
  //    nada que compensar: todavía no se escribió nada en Postgres.
  // ---------------------------------------------------------------------
  const supabaseAdmin = deps.supabaseAdmin();
  const redirectTo = `${deps.frontendOrigin}/reset-password`;

  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.inviteUserByEmail(
    email,
    { data: { full_name: adminFullName }, redirectTo },
  );

  if (authError || !authData.user) {
    // Identidad CONFIRMADA sin fila en public.users (un registro compensado a
    // medias, un usuario borrado de public.users): findUserByEmail no la ve,
    // GoTrue sí. Una identidad SIN confirmar no falla — GoTrue reenvía el
    // invite y devuelve éxito (B-22).
    if (esErrorDeEmailDuplicado(authError)) {
      throw new AppError("Ese email ya está registrado en la plataforma", 409);
    }

    logger.error({ err: authError }, "Error invitando al primer admin en Supabase Auth");
    throw new AppError("No se pudo enviar la invitación", 502);
  }

  const authUserId = authData.user.id;
  // El email canónico lo decide Supabase, como en onboarding.
  const emailCanonico = authData.user.email ?? email;

  // ---------------------------------------------------------------------
  // 3. Organization + User como una sola operación lógica. Si esto falla,
  //    la identidad de Supabase quedó creada y se compensa — es seguro
  //    borrarla porque el paso 1 ya descartó que sea de alguien.
  // ---------------------------------------------------------------------
  try {
    const { organization, user } = await deps.transaction(async (tx) => {
      const role = await deps.findRoleByName("ADMIN", tx);
      if (!role) {
        // Falta el seed (npm run prisma:seed) — error de configuración del
        // servidor. isOperational false: el mensaje es para el log (M-11 b).
        throw new AppError(
          "No se encontró el rol ADMIN. Contactá al administrador del sistema.",
          500,
          false,
        );
      }

      const organization = await deps.createOrganization(
        { name: organizationName, slug, edition, industry },
        tx,
      );
      // ESENCIAL nace con su proceso de venta fijo, en la misma transacción:
      // sin él no podría crear oportunidades (§2.1). COMPLETA, como siempre,
      // sin ninguno. Una clínica ESENCIAL también: queda invisible
      // (docs/rubros.md §2.1), sin bifurcar la transacción.
      if (edition === "ESENCIAL") {
        await deps.createProcesoDeVentaFijo(organization.id, tx);
      }
      // Una clínica nace con su configuración (docs/rubros.md §1.3). Una
      // automotora, como siempre, sin nada de clínica.
      if (industry === "CLINICA") {
        await deps.createClinicSettings(organization.id, tx);
      }
      const user = await deps.createUser(
        {
          id: authUserId,
          organizationId: organization.id,
          roleId: role.id,
          email: emailCanonico,
          fullName: adminFullName,
        },
        tx,
      );

      return { organization, user };
    });

    return {
      organization: {
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        edition: organization.edition,
        industry: organization.industry,
      },
      admin: { id: user.id, email: user.email, fullName: user.fullName, role: "ADMIN" },
    };
  } catch (err) {
    await revertirIdentidad(
      supabaseAdmin,
      authUserId,
      "el alta de organización por platform admin",
    );

    if (err instanceof AppError) {
      throw err;
    }

    // La carrera entre dos altas simultáneas con el mismo nombre/email la
    // cierra la constraint única; se traduce igual que en onboarding.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const target = Array.isArray(err.meta?.target)
        ? err.meta.target.join(",")
        : String(err.meta?.target ?? "");

      if (target.includes("slug")) {
        throw new AppError("Ya existe una organización con ese nombre", 409);
      }
      if (target.includes("email")) {
        throw new AppError("Ya existe una cuenta con ese email", 409);
      }
      throw new AppError("El registro ya existe", 409);
    }

    logger.error({ err }, "Error inesperado creando la organización por platform admin");
    throw new AppError("No se pudo crear la organización", 500);
  }
}

// ---------------------------------------------------------------------------
// Cambiar la edición de una organización (docs/ediciones.md §1.1). Solo un
// platform admin, y solo hacia arriba: ESENCIAL → COMPLETA. Bajar es un 409
// (deja datos de módulos que la edición simple no tiene; fuera de alcance).
// Pedir la edición que ya tiene es un 200 sin cambios: un reintento o un doble
// click no da error.
//
// Después de subir se vacía la caché de autenticación: la edición viaja en el
// AuthContext cacheado por usuario, y sin esto los usuarios de la
// organización seguirían viendo ESENCIAL hasta el TTL.
// ---------------------------------------------------------------------------
export interface CambiarEdicionDeps {
  subirACompleta: (organizationId: string) => Promise<number>;
  edicionActual: (
    organizationId: string,
  ) => Promise<{ id: string; edition: OrganizationEdition } | null>;
  vaciarCacheDeAuth: () => void;
}

const defaultCambiarEdicionDeps: CambiarEdicionDeps = {
  subirACompleta: (organizationId) => subirOrganizacionACompleta(organizationId),
  edicionActual: (organizationId) => findActiveOrganizationEdition(organizationId),
  vaciarCacheDeAuth: vaciarContextosDeAuth,
};

export async function cambiarEdicionDeOrganizacion(
  organizationId: string,
  edicionPedida: OrganizationEdition,
  deps: CambiarEdicionDeps = defaultCambiarEdicionDeps,
): Promise<{ id: string; edition: OrganizationEdition }> {
  if (edicionPedida === "COMPLETA" && (await deps.subirACompleta(organizationId)) === 1) {
    deps.vaciarCacheDeAuth();
    return { id: organizationId, edition: "COMPLETA" };
  }

  const actual = await deps.edicionActual(organizationId);
  if (!actual) {
    throw new AppError("Organización no encontrada", 404);
  }
  if (actual.edition === edicionPedida) {
    return actual;
  }
  throw new AppError(
    "No se puede bajar de edición: solo se puede pasar de ESENCIAL a COMPLETA.",
    409,
  );
}

// ---------------------------------------------------------------------------
// Cambiar el rubro de una organización (docs/rubros.md §1.1, D1). Solo un
// platform admin, y solo mientras la organización no tenga:
//   - datos de negocio (contactos, turnos, conversaciones, vehículos),
//     contando también los dados de baja: son datos igual;
//   - usuarios vigentes con un rol que el rubro nuevo no admite
//     (ROLES_POR_RUBRO: USER al pasar a CLINICA, RECEPCION al pasar a
//     AUTOMOTORA), ni invitaciones pendientes con uno de esos roles (R12).
// En cualquier otro caso, 409. Pedir el rubro que ya tiene es un 200 sin
// cambios, como en la edición. CLINICA solo si CLINICA_HABILITADA (400).
//
// Los chequeos y la escritura van en una transacción con la fila de la
// organización bloqueada (FOR UPDATE): dos cambios simultáneos no se pisan.
// Un contacto creado en ese mismo instante por otro camino no toma ese lock;
// es una carrera aceptada para una operación manual de plataforma sobre una
// organización recién creada.
//
// Al pasar a CLINICA se crea su configuración (ClinicSettings); al volver a
// AUTOMOTORA no se borra nada (queda sin uso). Después se vacía la caché de
// autenticación: el rubro viaja en el AuthContext.
// ---------------------------------------------------------------------------
export interface CambiarRubroDeps {
  clinicaHabilitada: boolean;
  transaction: <T>(fn: (tx: Db) => Promise<T>) => Promise<T>;
  vaciarCacheDeAuth: () => void;
}

const defaultCambiarRubroDeps: CambiarRubroDeps = {
  get clinicaHabilitada() {
    return CLINICA_HABILITADA;
  },
  transaction: (fn) => prisma.$transaction(fn),
  vaciarCacheDeAuth: vaciarContextosDeAuth,
};

export const RUBRO_CON_DATOS =
  "No se puede cambiar el rubro: la organización ya tiene contactos, turnos, conversaciones o vehículos.";

export async function cambiarRubroDeOrganizacion(
  organizationId: string,
  rubroPedido: OrganizationIndustry,
  deps: CambiarRubroDeps = defaultCambiarRubroDeps,
): Promise<{ id: string; industry: OrganizationIndustry }> {
  if (!rubrosDisponibles(deps.clinicaHabilitada).includes(rubroPedido)) {
    throw new AppError(`El rubro ${rubroPedido} todavía no está disponible.`, 400);
  }

  const cambio = await deps.transaction(async (tx) => {
    const actual = await rubroDeLaOrganizacionVigente(organizationId, tx);
    if (!actual) {
      throw new AppError("Organización no encontrada", 404);
    }
    if (actual.industry === rubroPedido) {
      return { id: organizationId, industry: rubroPedido, cambio: false };
    }
    await lockOrganizationForUpdate(organizationId, tx);

    if ((await contarDatosDeNegocio(organizationId, tx)) > 0) {
      throw new AppError(RUBRO_CON_DATOS, 409);
    }
    const noAdmitidos = KNOWN_ROLES.filter((rol) => !ROLES_POR_RUBRO[rubroPedido].includes(rol));
    if (
      noAdmitidos.length > 0 &&
      ((await contarUsuariosConRoles(organizationId, noAdmitidos, tx)) > 0 ||
        (await contarInvitacionesPendientesConRoles(organizationId, noAdmitidos, tx)) > 0)
    ) {
      throw new AppError(
        `No se puede cambiar el rubro: la organización tiene usuarios con un rol que ${rubroPedido} no admite (${noAdmitidos.join(", ")}).`,
        409,
      );
    }

    await updateOrganizationIndustry(organizationId, rubroPedido, tx);
    if (rubroPedido === "CLINICA") {
      await crearConfiguracionDeClinica(organizationId, tx);
    }
    return { id: organizationId, industry: rubroPedido, cambio: true };
  });

  if (cambio.cambio) {
    deps.vaciarCacheDeAuth();
  }
  return { id: cambio.id, industry: cambio.industry };
}
