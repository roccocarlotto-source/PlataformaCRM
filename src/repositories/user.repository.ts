import type { Prisma } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";

// Única consulta que resuelve la identidad de negocio de un usuario
// autenticado, con lo que el middleware de autenticación necesita para
// construir el AuthContext: organización y rol en la misma query.
export function findUserForAuth(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    include: {
      organization: true,
      role: true,
    },
  });
}

// Crea el perfil de negocio de un usuario ya existente en Supabase Auth.
// `id` debe ser el mismo UUID que auth.users.id (convención del proyecto,
// ver docs/project-overview.md sección 4). `email` se pasa por completitud,
// pero el trigger trg_set_user_email_from_auth lo va a sobreescribir siempre
// leyéndolo de auth.users — la app nunca controla ese campo.
export function createUser(
  data: {
    id: string;
    organizationId: string;
    roleId: string;
    email: string;
    fullName: string;
  },
  db: Db = prisma,
) {
  return db.user.create({ data });
}

// Valida que un id de usuario sea asignable como owner/assignee de un
// registro: tiene que existir, pertenecer a la misma organización, estar
// activo, y no haber sido removido de la organización (deletedAt: null).
// Las cuatro condiciones colapsan a un mismo resultado (null) a propósito —
// el llamador no necesita (ni debería) distinguir cuál falló.
export function findUserByIdInOrganization(
  id: string,
  organizationId: string,
  db: Db = prisma,
) {
  return db.user.findFirst({
    where: { id, organizationId, isActive: true, deletedAt: null },
  });
}

// email es único a nivel de toda la base (User.email @unique, sin scope por
// organización) — un mismo email nunca puede pertenecer a dos usuarios,
// sean de la misma organización o no, esté el otro activo, desactivado o
// removido (el índice único de Postgres no distingue deletedAt). Usado por
// invitation.service.ts para rechazar una invitación a un email que ya es
// usuario en cualquier organización, antes de intentar nada contra Supabase.
export function findUserByEmail(email: string, db: Db = prisma) {
  return db.user.findUnique({ where: { email } });
}

export interface UserFilters {
  role?: string;
  isActive?: boolean;
}

export type UserSortBy = "fullName" | "createdAt";
export type SortOrder = "asc" | "desc";

// Roster de una organización: siempre excluye usuarios removidos
// (deletedAt != null) — mismo criterio de soft delete que el resto de las
// entidades. No hay forma de listar removidos en este bloque (ver
// docs/project-overview.md, no se implementó undelete).
function buildWhere(
  organizationId: string,
  filters: UserFilters,
): Prisma.UserWhereInput {
  return {
    organizationId,
    deletedAt: null,
    ...(filters.role ? { role: { name: filters.role } } : {}),
    ...(filters.isActive !== undefined ? { isActive: filters.isActive } : {}),
  };
}

function buildOrderBy(
  sortBy: UserSortBy,
  sortOrder: SortOrder,
): Prisma.UserOrderByWithRelationInput {
  switch (sortBy) {
    case "fullName":
      return { fullName: sortOrder };
    case "createdAt":
    default:
      return { createdAt: sortOrder };
  }
}

export function findManyUsers(
  organizationId: string,
  filters: UserFilters,
  pagination: { skip: number; take: number },
  sort: { sortBy: UserSortBy; sortOrder: SortOrder },
  db: Db = prisma,
) {
  return db.user.findMany({
    where: buildWhere(organizationId, filters),
    include: { role: true },
    orderBy: buildOrderBy(sort.sortBy, sort.sortOrder),
    skip: pagination.skip,
    take: pagination.take,
  });
}

export function countUsers(
  organizationId: string,
  filters: UserFilters,
  db: Db = prisma,
) {
  return db.user.count({ where: buildWhere(organizationId, filters) });
}

// findFirst en vez de findUnique: además del id, exige organizationId (nunca
// confiar en que un id ajeno no se cuele) y deletedAt: null (un usuario
// removido queda invisible a esta consulta — es la única forma de "404" que
// necesita PATCH/DELETE, sin caso especial: mismo patrón que
// findCompanyById/findContactById/etc.).
export function findUserById(
  id: string,
  organizationId: string,
  db: Db = prisma,
) {
  return db.user.findFirst({
    where: { id, organizationId, deletedAt: null },
    include: { role: true },
  });
}

// Cuenta ADMIN activos y no removidos de una organización — usado para
// bloquear que la organización se quede sin ningún ADMIN que pueda
// administrarla (desactivar, degradar o eliminar al último rompe el
// sistema para siempre, sin intervención manual en la base). excludeId
// permite contar "los que quedan" al evaluar una acción sobre un usuario
// puntual, mismo patrón que countActivePipelines/findOldestActivePipeline.
export function countActiveAdmins(
  organizationId: string,
  excludeId?: string,
  db: Db = prisma,
) {
  return db.user.count({
    where: {
      organizationId,
      isActive: true,
      deletedAt: null,
      role: { name: "ADMIN" },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
  });
}

export interface UpdateUserData {
  isActive?: boolean;
  roleId?: string;
}

// updateMany en vez de update: el WHERE efectivo tiene que exigir
// organizationId además de id (M4) — la escritura en sí es la garantía de
// aislamiento, no solo el pre-check del service. updateMany no admite
// `include`, así que ya no devuelve la fila con el rol incluido — el
// service reconstruye la respuesta con un findUserById posterior tras
// confirmar count === 1 (ver user.service.ts).
export function updateUser(
  id: string,
  organizationId: string,
  data: UpdateUserData,
  db: Db = prisma,
) {
  return db.user.updateMany({ where: { id, organizationId }, data });
}

// Remover de la organización: deletedAt + isActive: false en la misma
// escritura (remover implica desactivar, nunca al revés) — sin undelete en
// este bloque, ver docs/project-overview.md. organizationId en el WHERE por
// el mismo motivo que updateUser (M4).
export function softDeleteUser(
  id: string,
  organizationId: string,
  db: Db = prisma,
) {
  return db.user.updateMany({
    where: { id, organizationId },
    data: { deletedAt: new Date(), isActive: false },
  });
}
