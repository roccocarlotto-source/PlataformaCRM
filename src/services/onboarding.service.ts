import { Prisma } from "@prisma/client";
import { logger } from "../lib/logger";
import { prisma } from "../lib/prisma";
import { getSupabaseAdmin } from "../lib/supabaseAdmin";
import { getSupabaseAnon } from "../lib/supabaseAnon";
import { findPendingInvitationByEmail } from "../repositories/invitation.repository";
import {
  createOrganization,
  findOrganizationBySlug,
} from "../repositories/organization.repository";
import { findRoleByName } from "../repositories/role.repository";
import { createUser, findUserByEmail } from "../repositories/user.repository";
import { AppError } from "../utils/AppError";
import { slugify } from "../utils/slug";

export interface OnboardingInput {
  organizationName: string;
  fullName: string;
  email: string;
  password: string;
  otp: string;
}

export interface OnboardingResult {
  organization: { id: string; name: string; slug: string };
  user: { id: string; email: string; fullName: string; role: "ADMIN" };
}

// ---------------------------------------------------------------------------
// ALTO-2 — el registro ahora exige probar el email antes de aceptarlo
// ---------------------------------------------------------------------------
//
// Hasta acá el onboarding llamaba a `admin.createUser({ email_confirm: true })`:
// marcaba la identidad como confirmada SIN NINGUNA PRUEBA. Cualquiera podía
// registrar una organización con ceo@empresa-victima.com y esa identidad
// quedaba confirmada en auth.users sin que la víctima hiciera nada. Dos
// consecuencias, y la primera es permanente:
//
//   - EMAIL SQUATTING. El email quedaba quemado: createInvitation lo rechaza
//     con 409 y inviteUserByEmail también. La víctima real ya no podía ser
//     invitada a su propia organización.
//   - `email_confirmed_at` falso: todo flujo futuro que confíe en "email
//     confirmado" arrancaba envenenado. ALTO-3 es exactamente ese flujo.
//
// EL REGISTRO PASA A DOS LLAMADAS HTTP, NO A DOS PASOS DE DATOS. Esa es la
// diferencia con la opción A del hallazgo (crear Organization/User recién al
// confirmar), que obligaba a mantener un estado intermedio a medio registrar.
// Acá Organization + User + identidad se siguen creando como una sola operación
// lógica; lo que se agrega antes es una prueba de control del email:
//
//   1. POST /api/onboarding/otp  -> requestOnboardingOtp
//   2. POST /api/onboarding      -> onboardOrganization, con el código
//
// POR QUÉ signInWithOtp Y NO UN OTP PROPIO. Se verificó contra
// @supabase/supabase-js (2.110.2, el resuelto por el ^2.45.4 del package.json)
// que no existe forma de emitir un código sin crear antes la fila en
// auth.users: `signInWithOtp` hace signup si el usuario no existe, y
// `generateLink` "handles the creation of the user for signup, invite and
// magiclink" —su propio JSDoc— y además NO envía el mail, así que exigiría un
// proveedor de email que este repo no tiene. Un OTP propio habría necesitado
// una dependencia nueva, una variable de entorno nueva y un proveedor a elegir.
//
// QUÉ GARANTIZA ESTO, EXACTAMENTE. Que `POST /api/onboarding` no cree
// Organization ni User sin un código válido. Eso vale siempre, con cualquier
// configuración del proyecto, y tiene test propio.
//
// Lo que NO garantiza por sí solo es el estado de la fila de auth.users: si el
// proyecto tiene `Confirm email` APAGADO, GoTrue autoconfirma en el alta y el
// paso 1 deja una identidad ya confirmada para cualquier email tipeado. Pero en
// esa configuración el `POST /auth/v1/signup` público de Supabase ya permite lo
// mismo, así que este endpoint no agrega una capacidad nueva. `Confirm email`
// tiene que estar ENCENDIDO — ya era un requisito documentado en
// docs/supabase-setup.md, y ahora también lo es de este flujo.
//
// REQUISITO OPERATIVO, y no está en este repo: para que el mail lleve el código
// de 6 dígitos, la plantilla "Magic Link" del proyecto de Supabase tiene que
// incluir `{{ .Token }}`. Es la propia librería la que lo dice: "Magic links and
// OTPs share the same implementation. To send users a one-time code instead of a
// magic link, modify the magic link email template to include {{ .Token }}".
// Con la plantilla por defecto el mail llega igual, pero con un enlace en vez de
// un código, y el registro no se puede completar. Mismo tipo de dependencia
// operativa que el SMTP que ya necesita inviteUserByEmail.
// ---------------------------------------------------------------------------

export interface RequestOnboardingOtpInput {
  email: string;
}

// Paso 1. Emite el código y lo manda por mail. Devuelve void a propósito: la
// respuesta es idéntica exista o no una cuenta con ese email, así que este
// endpoint no es un oráculo de enumeración de usuarios. Quien ya tiene cuenta
// recibe un código válido y rebota más adelante con 409, en onboardOrganization,
// donde ya hay una identidad probada del otro lado.
export async function requestOnboardingOtp(input: RequestOnboardingOtpInput): Promise<void> {
  const supabase = getSupabaseAnon();

  const { error } = await supabase.auth.signInWithOtp({
    email: input.email,
    options: {
      // Es un registro: si el email no existe todavía, la fila de auth.users
      // tiene que nacer acá. Nace SIN CONFIRMAR — la confirmación la sella
      // verifyOtp en el paso 2, que es el punto de todo el cambio.
      shouldCreateUser: true,
    },
  });

  if (error) {
    // El detalle va al log, no a la respuesta: el mensaje de Supabase puede
    // distinguir "usuario inexistente" de "demasiados intentos", y eso es
    // justamente lo que no queremos devolverle a un endpoint público.
    logger.error({ err: error }, "Error emitiendo el código de verificación de registro");
    throw new AppError("No se pudo enviar el código de verificación. Probá de nuevo.", 502);
  }
}

// Paso 2. Único flujo de registro público del sistema: verifica el código,
// fija la contraseña sobre la identidad ya probada, y crea la Organization y el
// primer usuario (ADMIN) como una única operación lógica. Ver
// docs/authentication-architecture.md sección 1 para la estrategia de
// consistencia entre auth.users y public.users.
export async function onboardOrganization(input: OnboardingInput): Promise<OnboardingResult> {
  const { organizationName, fullName, email, password, otp } = input;
  const slug = slugify(organizationName);

  // Pre-chequeo: falla rápido en el caso común (nombre repetido) sin tocar
  // Supabase. No elimina la carrera entre dos requests simultáneos — eso lo
  // resuelve la constraint única de la base más abajo.
  const existingOrganization = await findOrganizationBySlug(slug);
  if (existingOrganization) {
    throw new AppError("Ya existe una organización con ese nombre", 409);
  }

  // ---------------------------------------------------------------------
  // 1. Probar el email. Antes de esto no se escribe absolutamente nada.
  // ---------------------------------------------------------------------
  const supabaseAnon = getSupabaseAnon();
  const { data: verificado, error: otpError } = await supabaseAnon.auth.verifyOtp({
    email,
    token: otp,
    type: "email",
  });

  if (otpError || !verificado.user) {
    // No se distingue "código incorrecto" de "código vencido" de "nunca se
    // pidió un código para ese email": los tres son la misma respuesta para
    // quien está del otro lado. Distinguirlos convertiría este endpoint en un
    // oráculo sobre qué emails tienen un código pendiente.
    throw new AppError("El código de verificación es inválido o expiró", 401);
  }

  const authUserId = verificado.user.id;
  // El email canónico lo decide Supabase (normaliza mayúsculas), no el body.
  const emailVerificado = verificado.user.email ?? email;

  // ---------------------------------------------------------------------
  // 2. ¿Ese email ya es de alguien? Se pregunta DESPUÉS de verificar y ANTES
  //    de escribir, y el orden importa en las dos direcciones.
  //
  //    Antes no hacía falta: `admin.createUser` fallaba con 422 ante cualquier
  //    identidad existente y eso se traducía a 409. Con el OTP esa red
  //    desaparece —la identidad puede existir justamente porque la creamos
  //    nosotros al emitir el código— así que la pregunta hay que hacerla
  //    explícita, y hay que hacerla sobre el perfil de negocio, no sobre
  //    auth.users.
  // ---------------------------------------------------------------------
  const usuarioExistente = await findUserByEmail(emailVerificado);
  if (usuarioExistente) {
    // Sin compensación: esta identidad es de alguien y no se toca.
    throw new AppError("Ya existe una cuenta con ese email", 409);
  }

  // Una invitación pendiente también significa que el email ya está hablado.
  // Sin este chequeo, alguien invitado podría registrar su propia organización
  // y quedar imposibilitado de aceptar la invitación (un User pertenece a
  // exactamente una organización), además de dejar la invitación colgada.
  const invitacionPendiente = await findPendingInvitationByEmail(emailVerificado);
  if (invitacionPendiente) {
    throw new AppError(
      "Ese email tiene una invitación pendiente. Aceptala en vez de registrar una organización nueva.",
      409,
    );
  }

  // ---------------------------------------------------------------------
  // 3. Fijar contraseña y metadata sobre la identidad ya probada.
  //
  //    Acá SÍ va el cliente de service_role: modificar un usuario es una
  //    operación administrativa. Y ya no aparece `email_confirm: true` en
  //    ninguna parte — la confirmación la selló verifyOtp, que es lo que ALTO-2
  //    pedía.
  // ---------------------------------------------------------------------
  const supabaseAdmin = getSupabaseAdmin();

  const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(authUserId, {
    password,
    user_metadata: { full_name: fullName },
  });

  if (updateError) {
    await revertirIdentidad(authUserId);
    logger.error({ err: updateError }, "Error fijando la contraseña del usuario de Supabase Auth");
    throw new AppError("No se pudo crear la cuenta", 500);
  }

  try {
    const { organization, user } = await prisma.$transaction(async (tx) => {
      const role = await findRoleByName("ADMIN", tx);
      if (!role) {
        // Falta el seed (npm run prisma:seed) — error de configuración del
        // servidor, no algo que el usuario pueda resolver.
        throw new AppError(
          "No se encontró el rol ADMIN. Contactá al administrador del sistema.",
          500,
        );
      }

      const organization = await createOrganization({ name: organizationName, slug }, tx);

      const user = await createUser(
        {
          id: authUserId,
          organizationId: organization.id,
          roleId: role.id,
          email: emailVerificado,
          fullName,
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
      },
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: "ADMIN",
      },
    };
  } catch (err) {
    // Compensación: la transacción de Postgres ya revirtió Organization y
    // User, pero el usuario de Supabase Auth quedó creado — sin esto sería
    // una identidad huérfana sin perfil de negocio.
    //
    // Es seguro borrarla PORQUE los dos chequeos de arriba ya descartaron que
    // sea de alguien: no hay perfil de negocio con ese email, y no hay
    // invitación pendiente. Sin esos chequeos, esta línea podría destruir la
    // cuenta real de otra persona — el riesgo que el `admin.createUser` con
    // 422 cubría de arriba y que el OTP se llevó puesto.
    await revertirIdentidad(authUserId);

    if (err instanceof AppError) {
      throw err;
    }

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

    logger.error({ err }, "Error inesperado en la transacción de onboarding");
    throw new AppError("No se pudo completar el registro", 500);
  }
}

async function revertirIdentidad(authUserId: string): Promise<void> {
  try {
    await getSupabaseAdmin().auth.admin.deleteUser(authUserId);
  } catch (cleanupErr) {
    logger.error(
      { err: cleanupErr, orphanedAuthUserId: authUserId },
      "No se pudo revertir el usuario de Supabase Auth tras un fallo en el onboarding — requiere limpieza manual",
    );
  }
}
