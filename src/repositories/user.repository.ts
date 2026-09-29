import type { Prisma } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";

// Única consulta que resuelve la identidad de negocio de un usuario
// autenticado, con lo que el middleware de autenticación necesita para
// construir el AuthContext: organización y rol en la misma query.
//
// UN SOLO SELECT CON JOIN, y no el `include` de antes — F6 de
// docs/prueba-en-vivo-2026-09-29.md (PR "menos idas a la base"). Prisma 5
// resuelve un `include` con una query POR relación, en serie: users, después
// organizations, después roles. Eran tres idas a la base en CADA request
// autenticado, y con Render y Supabase en regiones distintas cada ida cuesta
// ~100 ms. Esto es una.
//
// Lo que NO cambia, a propósito: se sigue leyendo en cada request (no hay
// caché), así que un usuario desactivado, removido o con el rol cambiado se
// ve en el request siguiente, igual que antes. Y trae exactamente lo que
// resolveAuthContext mira: los estados del usuario, el deletedAt de la
// organización y el nombre del rol.
export interface UsuarioParaAuth {
  id: string;
  organizationId: string;
  email: string;
  fullName: string;
  isActive: boolean;
  deletedAt: Date | null;
  organization: { deletedAt: Date | null };
  role: { name: string };
}

interface FilaUsuarioParaAuth {
  id: string;
  organization_id: string;
  email: string;
  full_name: string;
  is_active: boolean;
  deleted_at: Date | null;
  organization_deleted_at: Date | null;
  role_name: string;
}

export async function findUserForAuth(userId: string): Promise<UsuarioParaAuth | null> {
  const filas = await prisma.$queryRaw<FilaUsuarioParaAuth[]>`
    SELECT u.id, u.organization_id, u.email, u.full_name, u.is_active, u.deleted_at,
           o.deleted_at AS organization_deleted_at,
           r.name AS role_name
    FROM users u
    JOIN organizations o ON o.id = u.organization_id
    JOIN roles r ON r.id = u.role_id
    WHERE u.id = ${userId}::uuid`;
  const fila = filas[0];
  if (!fila) return null;
  return {
    id: fila.id,
    organizationId: fila.organization_id,
    email: fila.email,
    fullName: fila.full_name,
    isActive: fila.is_active,
    deletedAt: fila.deleted_at,
    organization: { deletedAt: fila.organization_deleted_at },
    role: { name: fila.role_name },
  };
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
export function findUserByIdInOrganization(id: string, organizationId: string, db: Db = prisma) {
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
function buildWhere(organizationId: string, filters: UserFilters): Prisma.UserWhereInput {
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

export function countUsers(organizationId: string, filters: UserFilters, db: Db = prisma) {
  return db.user.count({ where: buildWhere(organizationId, filters) });
}

// findFirst en vez de findUnique: además del id, exige organizationId (nunca
// confiar en que un id ajeno no se cuele) y deletedAt: null (un usuario
// removido queda invisible a esta consulta — es la única forma de "404" que
// necesita PATCH/DELETE, sin caso especial: mismo patrón que
// findCompanyById/findContactById/etc.).
export function findUserById(id: string, organizationId: string, db: Db = prisma) {
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
export function countActiveAdmins(organizationId: string, excludeId?: string, db: Db = prisma) {
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
  canUseInternalAgent?: boolean;
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
export function softDeleteUser(id: string, organizationId: string, db: Db = prisma) {
  return db.user.updateMany({
    where: { id, organizationId },
    data: { deletedAt: new Date(), isActive: false },
  });
}
