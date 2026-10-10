import type { OrganizationIndustry } from "@prisma/client";
import {
  reemplazarSedesDelUsuario,
  sedesVigentesPorUsuario,
} from "../clinicas/repositories/sedesDeUsuarios.repository";
import { resolverSedesDelRol } from "../clinicas/services/sedesDeUsuarios.service";
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
  type UpdateUserData,
  type UserSortBy,
} from "../repositories/user.repository";
import { findRoleByName } from "../repositories/role.repository";
import { isRoleName, type RoleName } from "../types/auth";
import { AppError } from "../utils/AppError";
import { olvidarContextoDeAuth } from "./auth.service";

export interface ListUsersParams {
  page: number;
  pageSize: number;
  role?: RoleName;
  isActive?: boolean;
  sortBy: UserSortBy;
  sortOrder: SortOrder;
}

// `industry` (R20): en una clínica, cada usuario viaja con sus sedes vigentes
// (`branches`). En una automotora la respuesta es la de antes, sin la clave.
export async function listUsers(
  organizationId: string,
  params: ListUsersParams,
  industry?: OrganizationIndustry,
) {
  const { page, pageSize, sortBy, sortOrder, ...filters } = params;
  const skip = (page - 1) * pageSize;

  const [usuarios, total] = await Promise.all([
    findManyUsers(organizationId, filters, { skip, take: pageSize }, { sortBy, sortOrder }),
    countUsers(organizationId, filters),
  ]);
  const data = await conSedesSiEsClinica(organizationId, usuarios, industry);

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
//
// Exportada para poder testearla sin base (user.service.test.ts).
export function staysActiveAdmin(
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
  canUseInternalAgent?: boolean;
  // Las sedes de una Recepción de clínica (R20). Se ignora en una automotora.
  branchIds?: string[];
}

// En una clínica, los usuarios con sus sedes vigentes (`branches`, [] si no
// tiene: la pantalla marca a la Recepción sin sedes). En una automotora, tal
// cual: ni una clave más.
async function conSedesSiEsClinica<T extends { id: string }>(
  organizationId: string,
  usuarios: T[],
  industry: OrganizationIndustry | undefined,
): Promise<(T | (T & { branches: { id: string; name: string }[] }))[]> {
  if (industry !== "CLINICA") return usuarios;
  const sedes = await sedesVigentesPorUsuario(
    organizationId,
    usuarios.map((u) => u.id),
  );
  return usuarios.map((u) => ({ ...u, branches: sedes.get(u.id) ?? [] }));
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
  industry?: OrganizationIndustry,
) {
  try {
    const [usuario] = await conSedesSiEsClinica(
      organizationId,
      [await actualizarUsuario(organizationId, actorUserId, id, input, industry)],
      industry,
    );
    return usuario;
  } finally {
    // El cambio de rol o de estado vale desde el próximo request de ese
    // usuario, sin esperar a que venza la caché de autenticación. DESPUÉS de
    // la escritura (un request que cayera en el medio volvería a guardar el
    // estado viejo), y también si falló: olvidar de más solo cuesta una
    // consulta.
    olvidarContextoDeAuth(id);
  }
}

async function actualizarUsuario(
  organizationId: string,
  actorUserId: string,
  id: string,
  input: UpdateUserInput,
  industry: OrganizationIndustry | undefined,
) {
  if (id === actorUserId) {
    throw new AppError("No podés modificar tu propio usuario (rol o estado activo)", 400);
  }

  const user = await getUserById(organizationId, id);

  const data: UpdateUserData = {};

  if (input.isActive !== undefined) {
    data.isActive = input.isActive;
  }

  // Ítem 179. No interviene en la protección del último ADMIN de abajo: no
  // cambia quién administra la organización.
  if (input.canUseInternalAgent !== undefined) {
    data.canUseInternalAgent = input.canUseInternalAgent;
  }

  if (input.role !== undefined) {
    const role = await findRoleByName(input.role);
    if (!role) {
      // isOperational: false — falta el seed, error de configuración del
      // servidor, no del cliente (M-11 b).
      throw new AppError("No se encontró el rol indicado", 500, false);
    }
    data.roleId = role.id;
  }

  // R20: las sedes, solo en una clínica (null = no se tocan). Pasar a alguien a
  // Recepción exige sedes; un ADMIN queda sin ninguna (ve todas).
  const rolFinal = input.role ?? (isRoleName(user.role.name) ? user.role.name : undefined);
  const sedes =
    industry !== undefined && rolFinal !== undefined
      ? await resolverSedesDelRol(organizationId, industry, rolFinal, input.branchIds, {
          obligatorias: input.role === "RECEPCION" && user.role.name !== "RECEPCION",
        })
      : null;

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
      if (sedes !== null) {
        await reemplazarSedesDelUsuario(organizationId, id, sedes, tx);
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

  if (sedes === null) {
    // Lo de siempre (y lo único que pasa en una automotora).
    const result = await updateUserRepo(id, organizationId, data);
    if (result.count === 0) {
      throw new AppError("Usuario no encontrado", 404);
    }
  } else {
    // Clínica: el rol y las sedes en la misma transacción, para que una
    // Recepción no quede con el rol nuevo y sin las sedes pedidas.
    // Un PATCH con solo `branchIds` no tiene otra columna que escribir: un
    // updateMany sin datos devuelve count 0 y sería un 404 falso (el usuario
    // ya se validó con getUserById).
    await prisma.$transaction(async (tx) => {
      if (Object.keys(data).length > 0) {
        const result = await updateUserRepo(id, organizationId, data, tx);
        if (result.count === 0) {
          throw new AppError("Usuario no encontrado", 404);
        }
      }
      await reemplazarSedesDelUsuario(organizationId, id, sedes, tx);
    });
  }

  return getUserById(organizationId, id);
}

// Remover de la organización (soft delete). No toca Supabase Auth: la
// identidad queda intacta pero resolveAuthContext la va a rechazar por
// deletedAt != null en el próximo request — reversible del lado de
// Supabase (no lo tocamos), pero sin undelete de nuestro lado en este
// bloque.
export async function deleteUser(organizationId: string, actorUserId: string, id: string) {
  try {
    await removerUsuario(organizationId, actorUserId, id);
  } finally {
    // Mismo motivo que en updateUser.
    olvidarContextoDeAuth(id);
  }
}

async function removerUsuario(organizationId: string, actorUserId: string, id: string) {
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
          throw new AppError("No se puede eliminar al último ADMIN activo de la organización", 400);
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
