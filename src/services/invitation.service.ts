import { Prisma } from "@prisma/client";
import { logger } from "../lib/logger";
import { prisma } from "../lib/prisma";
import { getSupabaseAdmin } from "../lib/supabaseAdmin";
import {
  acceptInvitationRowConditional,
  countInvitations,
  createInvitation as createInvitationRepo,
  expireDueInvitations,
  findInvitationById,
  findInvitationByIdUnscoped,
  findManyInvitations,
  findPendingInvitationByOrgAndEmail,
  findPendingInvitationsByEmail,
  hardDeleteInvitation,
  revokeInvitationConditional,
  type InvitationSortBy,
  type SortOrder,
} from "../repositories/invitation.repository";
import { findRoleByName } from "../repositories/role.repository";
import { createUser, findUserByEmail } from "../repositories/user.repository";
import type { InvitationAcceptIdentity, RoleName } from "../types/auth";
import { AppError } from "../utils/AppError";

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export interface ListInvitationsParams {
  page: number;
  pageSize: number;
  status?: "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED";
  sortBy: InvitationSortBy;
  sortOrder: SortOrder;
}

export async function listInvitations(
  organizationId: string,
  params: ListInvitationsParams,
) {
  // Perezoso: antes de listar, cualquier PENDING vencida de esta
  // organización pasa a EXPIRED — así el listado siempre refleja el estado
  // real, no el estado al momento de crearse.
  await expireDueInvitations({ organizationId });

  const { page, pageSize, sortBy, sortOrder, ...filters } = params;
  const skip = (page - 1) * pageSize;

  const [data, total] = await Promise.all([
    findManyInvitations(
      organizationId,
      filters,
      { skip, take: pageSize },
      { sortBy, sortOrder },
    ),
    countInvitations(organizationId, filters),
  ]);

  return {
    data,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
    },
  };
}

export interface CreateInvitationInput {
  email: string;
  role: RoleName;
}

// Estrategia de consistencia (no "atómica" — dos sistemas sin transacción
// compartida): se crea la Invitation en Prisma PRIMERO, se llama a Supabase
// DESPUÉS. Si Supabase falla, se hace hard delete de la Invitation que
// acaba de crear esta misma operación — deliberado, no una revocación: esa
// fila nunca llegó a existir funcionalmente. Si el hard delete también
// falla, se loguea como error crítico con el invitationId (mismo criterio
// de riesgo residual que onboarding.service.ts documenta para su propia
// compensación).
//
// findPendingInvitationByOrgAndEmail (abajo) es un pre-check de UX, NO la
// defensa contra la carrera: si dos requests concurrentes pasan ambos el
// pre-check, el índice único parcial invitations_org_email_pending_unique
// (manual_constraints.sql) rechaza el segundo INSERT — eso es lo que
// garantiza que a lo sumo una Invitation PENDING exista por
// (organizationId, email). El catch de P2002 de abajo solo traduce ese
// rechazo a un 409 legible en vez de dejarlo subir como 500 crudo.
export async function createInvitation(
  organizationId: string,
  actorUserId: string,
  input: CreateInvitationInput,
) {
  const email = normalizeEmail(input.email);

  await expireDueInvitations({ organizationId, email });

  const existingUser = await findUserByEmail(email);
  if (existingUser) {
    throw new AppError(
      "Ese email ya pertenece a un usuario existente",
      409,
    );
  }

  const existingPending = await findPendingInvitationByOrgAndEmail(
    organizationId,
    email,
  );
  if (existingPending) {
    throw new AppError(
      "Ya existe una invitación pendiente para ese email",
      409,
    );
  }

  const role = await findRoleByName(input.role);
  if (!role) {
    logger.error(
      { roleName: input.role },
      "No se encontró el rol indicado en el catálogo — falta el seed",
    );
    throw new AppError(
      "No se encontró el rol indicado. Contactá al administrador del sistema.",
      500,
    );
  }

  let invitation;
  try {
    invitation = await createInvitationRepo({
      organizationId,
      email,
      roleId: role.id,
      invitedById: actorUserId,
      expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
    });
  } catch (err) {
    // Invitation tiene un único índice único (el parcial de arriba) — a
    // diferencia de Stage/Contact no hace falta inspeccionar err.meta.target
    // para desambiguar entre varias constraints posibles, cualquier P2002
    // en este insert solo puede ser ese índice.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      throw new AppError(
        "Ya existe una invitación pendiente para ese email",
        409,
      );
    }
    throw err;
  }

  const supabaseAdmin = getSupabaseAdmin();
  const { data: authData, error: authError } =
    await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      data: { invitationId: invitation.id },
    });

  if (authError || !authData.user) {
    try {
      await hardDeleteInvitation(invitation.id);
    } catch (cleanupErr) {
      logger.error(
        { err: cleanupErr, orphanedInvitationId: invitation.id },
        "No se pudo revertir la Invitation tras un fallo en inviteUserByEmail — requiere limpieza manual",
      );
    }

    // Límite real de la plataforma: el email de auth.users es único en todo
    // el proyecto de Supabase, no por organización — invitar un email que
    // ya es identidad de Supabase (miembro de otra organización, u otra
    // invitación en curso en otra organización) falla acá, no antes.
    const isDuplicate =
      authError?.status === 422 ||
      /already registered|already exists/i.test(authError?.message ?? "");

    if (isDuplicate) {
      throw new AppError("Ese email ya está registrado en la plataforma", 409);
    }

    logger.error({ err: authError }, "Error invitando usuario en Supabase Auth");
    throw new AppError("No se pudo enviar la invitación", 500);
  }

  return invitation;
}

export async function revokeInvitation(organizationId: string, id: string) {
  await expireDueInvitations({ organizationId, id });

  const invitation = await findInvitationById(id, organizationId);
  if (!invitation) {
    throw new AppError("Invitación no encontrada", 404);
  }

  // Chequeo rápido de UX (mensaje específico en el caso común, no
  // concurrente) — NO es la defensa real. La defensa es la escritura
  // condicional de abajo: revokeInvitationConditional solo transiciona si
  // status sigue siendo PENDING en el momento exacto del UPDATE, sin
  // importar lo que este SELECT haya visto un instante antes.
  if (invitation.status !== "PENDING") {
    throw new AppError("Solo se puede revocar una invitación pendiente", 400);
  }

  const result = await revokeInvitationConditional(id, organizationId);
  if (result.count === 0) {
    // Perdió la carrera: otra transición (accept, u otro revoke) ganó
    // entre el SELECT de arriba y esta escritura. Nunca puede quedar
    // REVOKED con un User ya creado por un accept que ganó la carrera —
    // si accept ganó, este UPDATE simplemente no afecta ninguna fila.
    throw new AppError(
      "Esta invitación ya no está disponible para revocar (fue aceptada o venció)",
      409,
    );
  }

  const updated = await findInvitationById(id, organizationId);
  if (!updated) {
    throw new AppError("Invitación no encontrada tras revocar", 500);
  }
  return updated;
}

export interface AcceptInvitationInput {
  fullName: string;
  invitationId?: string;
}

function assertPending(status: string): void {
  switch (status) {
    case "PENDING":
      return;
    case "ACCEPTED":
      throw new AppError("Esta invitación ya fue aceptada", 409);
    case "REVOKED":
      throw new AppError(
        "Esta invitación fue revocada, pedile a tu administrador que te reinvite",
        410,
      );
    case "EXPIRED":
      throw new AppError(
        "Esta invitación venció, pedile a tu administrador que te reinvite",
        410,
      );
    default:
      throw new AppError("Invitación inválida", 400);
  }
}

// identity ya viene verificada (M1): verifyInvitationAcceptIdentity
// (middleware) es ahora el único punto que verifica el JWT — este service
// no vuelve a hacerlo, ni le hace falta el token crudo.
export async function acceptInvitation(
  identity: InvitationAcceptIdentity,
  input: AcceptInvitationInput,
) {
  const { userId, email } = identity;

  // Perezoso, sin scope de organización (todavía no la conocemos): expira
  // cualquier PENDING vencida de este email antes de decidir cuál aceptar.
  await expireDueInvitations({ email });

  let invitation;
  if (input.invitationId) {
    invitation = await findInvitationByIdUnscoped(input.invitationId);
    // Defensa en profundidad: el id no alcanza, el email del JWT (probado
    // por Supabase) tiene que coincidir con el de la invitación — nunca se
    // confía en que un invitationId ajeno no se cuele acá.
    if (!invitation || invitation.email !== email) {
      throw new AppError("Invitación no encontrada", 404);
    }
  } else {
    const pending = await findPendingInvitationsByEmail(email);
    if (pending.length === 0) {
      throw new AppError(
        "No se encontró ninguna invitación pendiente para tu email",
        404,
      );
    }
    if (pending.length > 1) {
      throw new AppError(
        "Hay más de una invitación pendiente para tu email — especificá invitationId",
        409,
      );
    }
    invitation = pending[0];
  }

  // Chequeos rápidos de UX (mensajes específicos en el caso común, no
  // concurrente) — NO son la defensa real contra la carrera. La defensa es
  // la escritura condicional dentro de la transacción, más abajo.
  assertPending(invitation.status);

  if (invitation.expiresAt.getTime() <= Date.now()) {
    await expireDueInvitations({ id: invitation.id });
    throw new AppError(
      "Esta invitación venció, pedile a tu administrador que te reinvite",
      410,
    );
  }

  const fullName = input.fullName.trim();

  try {
    return await prisma.$transaction(async (tx) => {
      // Compare-and-swap: primer paso de la transacción, antes de crear el
      // User. Solo transiciona si status sigue siendo PENDING en el
      // momento exacto de la escritura — así se resuelve tanto "accept vs
      // accept" (mismo userId, la PK/email de User respaldan como defensa
      // secundaria) como "accept vs revoke" (dos UPDATE distintos sobre la
      // misma fila de Invitation, sin ninguna colisión de User que los
      // arbitre). Si count === 0, ni siquiera se intenta crear el User —
      // nunca puede quedar un User huérfano de una aceptación que perdió
      // la carrera.
      const transition = await acceptInvitationRowConditional(
        invitation.id,
        tx,
      );
      if (transition.count === 0) {
        throw new AppError(
          "Esta invitación ya no está disponible para aceptar (fue aceptada, revocada o venció)",
          409,
        );
      }

      return createUser(
        {
          id: userId,
          organizationId: invitation.organizationId,
          roleId: invitation.roleId,
          email,
          fullName,
        },
        tx,
      );
    });
  } catch (err) {
    if (err instanceof AppError) {
      throw err;
    }
    // Backstop de defensa en profundidad: si por algún motivo ajeno a la
    // transición de Invitation el create de User choca contra su propia
    // unicidad (id/email), no debería alcanzarse nunca dado el orden de
    // arriba, pero se traduce igual en vez de dejarlo subir como 500 crudo.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      throw new AppError("Esta invitación ya fue aceptada", 409);
    }
    throw err;
  }
}
