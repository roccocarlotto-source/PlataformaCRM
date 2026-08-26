import { Prisma } from "@prisma/client";
import { logger } from "../lib/logger";
import { prisma } from "../lib/prisma";
import { getSupabaseAdmin } from "../lib/supabaseAdmin";
import {
  createOrganization,
  findOrganizationBySlug,
} from "../repositories/organization.repository";
import { findRoleByName } from "../repositories/role.repository";
import { createUser } from "../repositories/user.repository";
import { AppError } from "../utils/AppError";
import { slugify } from "../utils/slug";

export interface OnboardingInput {
  organizationName: string;
  fullName: string;
  email: string;
  password: string;
}

export interface OnboardingResult {
  organization: { id: string; name: string; slug: string };
  user: { id: string; email: string; fullName: string; role: "ADMIN" };
}

// Único flujo de registro público del sistema: crea la Organization, el
// primer usuario (ADMIN) y la identidad en Supabase Auth, como una única
// operación lógica. Ver docs/authentication-architecture.md sección 1 para
// la estrategia de consistencia entre auth.users y public.users.
export async function onboardOrganization(input: OnboardingInput): Promise<OnboardingResult> {
  const { organizationName, fullName, email, password } = input;
  const slug = slugify(organizationName);

  // Pre-chequeo: falla rápido en el caso común (nombre repetido) sin tocar
  // Supabase. No elimina la carrera entre dos requests simultáneos — eso lo
  // resuelve la constraint única de la base más abajo.
  const existingOrganization = await findOrganizationBySlug(slug);
  if (existingOrganization) {
    throw new AppError("Ya existe una organización con ese nombre", 409);
  }

  const supabaseAdmin = getSupabaseAdmin();

  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });

  if (authError || !authData.user) {
    const isDuplicate =
      authError?.status === 422 ||
      /already registered|already exists/i.test(authError?.message ?? "");

    if (isDuplicate) {
      throw new AppError("Ya existe una cuenta con ese email", 409);
    }

    logger.error({ err: authError }, "Error creando usuario en Supabase Auth");
    throw new AppError("No se pudo crear la cuenta", 500);
  }

  const authUserId = authData.user.id;

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
          email,
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
    try {
      await supabaseAdmin.auth.admin.deleteUser(authUserId);
    } catch (cleanupErr) {
      logger.error(
        { err: cleanupErr, orphanedAuthUserId: authUserId },
        "No se pudo revertir el usuario de Supabase Auth tras un fallo en el onboarding — requiere limpieza manual",
      );
    }

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
