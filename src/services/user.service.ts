import { prisma } from "../lib/prisma";
import { lockOrganizationForUpdate } from "../repositories/organization.repository";
import {
  countActiveAdmins,
  countUsers,
  findManyUsers,
  findUserById,
  softDeleteUser,
  updateUser as updateUserRepo,
  type SortOrder,
  type UserSortBy,
} from "../repositories/user.repository";
import { findRoleByName } from "../repositories/role.repository";
import type { RoleName } from "../types/auth";
import { AppError } from "../utils/AppError";

export interface ListUsersParams {
  page: number;
  pageSize: number;
  role?: RoleName;
  isActive?: boolean;
  sortBy: UserSortBy;
  sortOrder: SortOrder;
}

export async function listUsers(organizationId: string, params: ListUsersParams) {
  const { page, pageSize, sortBy, sortOrder, ...filters } = params;
  const skip = (page - 1) * pageSize;

  const [data, total] = await Promise.all([
    findManyUsers(
      organizationId,
      filters,
      { skip, take: pageSize },
      { sortBy, sortOrder },
    ),
    countUsers(organizationId, filters),
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

export async function getUserById(organizationId: string, id: string) {
  // findUserById ya excluye deletedAt != null — un usuario removido no
  // tiene forma de "aparecer" acá, mismo patrón que el resto de las
  // entidades con soft delete. Sin undelete en este bloque.
  const user = await findUserById(id, organizationId);
  if (!user) {
    throw new AppError("Usuario no encontrado", 404);
  }
  return user;
}

// true si, después de aplicar el cambio propuesto, el usuario seguiría
// siendo un ADMIN activo — para decidir si hace falta proteger al último.
function staysActiveAdmin(
  current: { isActive: boolean; role: { name: string } },
  nextIsActive: boolean | undefined,
  nextRole: RoleName | undefined,
): boolean {
  const isActive = nextIsActive ?? current.isActive;
  const roleName = nextRole ?? current.role.name;
  return isActive && roleName === "ADMIN";
}

export interface UpdateUserInput {
  isActive?: boolean;
  role?: RoleName;
}

// No es un editor genérico: solo isActive (activar/desactivar, reversible)
// y role (promover/degradar). email/id/organizationId nunca son campos de
// este schema — ni siquiera llegan a esta función. deletedAt tampoco: no
// hay undelete en este bloque, así que un usuario removido ya no aparece
// (getUserById -> 404) y PATCH no tiene forma de revivirlo.
export async function updateUser(
  organizationId: string,
  actorUserId: string,
  id: string,
  input: UpdateUserInput,
) {
  if (id === actorUserId) {
    throw new AppError(
      "No podés modificar tu propio usuario (rol o estado activo)",
      400,
    );
  }

  const user = await getUserById(organizationId, id);

  const data: { isActive?: boolean; roleId?: string } = {};

  if (input.isActive !== undefined) {
    data.isActive = input.isActive;
  }

  if (input.role !== undefined) {
    const role = await findRoleByName(input.role);
    if (!role) {
      throw new AppError("No se encontró el rol indicado", 500);
    }
    data.roleId = role.id;
  }

  const wasActiveAdmin = user.isActive && user.role.name === "ADMIN";
  const willStayActiveAdmin = staysActiveAdmin(user, input.isActive, input.role);

  if (wasActiveAdmin && !willStayActiveAdmin) {
    // Protección real contra la carrera de "último ADMIN": lockea la fila
    // de la organización ANTES de contar, así una segunda transacción
    // concurrente que dependa del mismo conteo queda bloqueada hasta que
    // esta commitee — al desbloquearse, re-lee el estado ya actualizado y
    // rechaza correctamente si ya no queda otro admin. Revalida al usuario
    // dentro de la transacción por si su estado cambió entre el chequeo
    // barato de arriba y la adquisición del lock.
    return prisma.$transaction(async (tx) => {
      await lockOrganizationForUpdate(organizationId, tx);

      const freshUser = await findUserById(id, organizationId, tx);
      if (!freshUser) {
        throw new AppError("Usuario no encontrado", 404);
      }

      if (freshUser.isActive && freshUser.role.name === "ADMIN") {
        const remainingAdmins = await countActiveAdmins(organizationId, id, tx);
        if (remainingAdmins === 0) {
          throw new AppError(
            "No se puede modificar al último ADMIN activo de la organización",
            400,
          );
        }
      }

      const result = await updateUserRepo(id, organizationId, data, tx);
      if (result.count === 0) {
        throw new AppError("Usuario no encontrado", 404);
      }

      // updateMany no admite `include` — reconstruye la respuesta (con rol)
      // con una lectura dentro de la misma transacción, solo después de
      // confirmar que la escritura realmente afectó una fila.
      const updated = await findUserById(id, organizationId, tx);
      if (!updated) {
        throw new AppError("Usuario no encontrado", 404);
      }
      return updated;
    });
  }

  const result = await updateUserRepo(id, organizationId, data);
  if (result.count === 0) {
    throw new AppError("Usuario no encontrado", 404);
  }

  return getUserById(organizationId, id);
}

// Remover de la organización (soft delete). No toca Supabase Auth: la
// identidad queda intacta pero resolveAuthContext la va a rechazar por
// deletedAt != null en el próximo request — reversible del lado de
// Supabase (no lo tocamos), pero sin undelete de nuestro lado en este
// bloque.
export async function deleteUser(
  organizationId: string,
  actorUserId: string,
  id: string,
) {
  if (id === actorUserId) {
    throw new AppError("No podés eliminar tu propio usuario", 400);
  }

  const user = await getUserById(organizationId, id);

  if (user.isActive && user.role.name === "ADMIN") {
    // Mismo mecanismo de locking que updateUser — ver comentario ahí.
    await prisma.$transaction(async (tx) => {
      await lockOrganizationForUpdate(organizationId, tx);

      const freshUser = await findUserById(id, organizationId, tx);
      if (!freshUser) {
        throw new AppError("Usuario no encontrado", 404);
      }

      if (freshUser.isActive && freshUser.role.name === "ADMIN") {
        const remainingAdmins = await countActiveAdmins(organizationId, id, tx);
        if (remainingAdmins === 0) {
          throw new AppError(
            "No se puede eliminar al último ADMIN activo de la organización",
            400,
          );
        }
      }

      const result = await softDeleteUser(id, organizationId, tx);
      if (result.count === 0) {
        throw new AppError("Usuario no encontrado", 404);
      }
    });
    return;
  }

  const result = await softDeleteUser(id, organizationId);
  if (result.count === 0) {
    throw new AppError("Usuario no encontrado", 404);
  }
}
