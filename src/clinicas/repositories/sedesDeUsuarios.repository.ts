import { prisma, type Db } from "../../lib/prisma";

// ---------------------------------------------------------------------------
// Las sedes de los usuarios y de las invitaciones de una clínica
// (docs/rubros.md §11.5, migración 20261105120000). organizationId en cada
// WHERE, como en el resto de los repositorios.
//
// Las sedes borradas (branches.deleted_at) NO borran filas: las lecturas las
// ignoran, igual que sedesDelActor (findUserForAuth).
// ---------------------------------------------------------------------------

/** De estas sedes, las que existen en la organización y no están borradas. */
export async function sedesVigentesDeLaOrganizacion(
  organizationId: string,
  branchIds: readonly string[],
  db: Db = prisma,
): Promise<string[]> {
  if (branchIds.length === 0) return [];
  const filas = await db.branch.findMany({
    where: { organizationId, id: { in: [...branchIds] }, deletedAt: null },
    select: { id: true },
  });
  return filas.map((f) => f.id);
}

/** Las sedes vigentes de cada usuario, ordenadas por nombre de la sede. */
export async function sedesVigentesPorUsuario(
  organizationId: string,
  userIds: readonly string[],
  db: Db = prisma,
): Promise<Map<string, { id: string; name: string }[]>> {
  const porUsuario = new Map<string, { id: string; name: string }[]>();
  if (userIds.length === 0) return porUsuario;
  const filas = await db.userBranch.findMany({
    where: { organizationId, userId: { in: [...userIds] }, branch: { deletedAt: null } },
    select: { userId: true, branch: { select: { id: true, name: true } } },
    orderBy: [{ branch: { name: "asc" } }, { branchId: "asc" }],
  });
  for (const fila of filas) {
    const lista = porUsuario.get(fila.userId) ?? [];
    lista.push(fila.branch);
    porUsuario.set(fila.userId, lista);
  }
  return porUsuario;
}

/** Reemplaza las sedes de un usuario por estas (vacío = ninguna). */
export async function reemplazarSedesDelUsuario(
  organizationId: string,
  userId: string,
  branchIds: readonly string[],
  db: Db,
): Promise<void> {
  await db.userBranch.deleteMany({ where: { organizationId, userId } });
  if (branchIds.length > 0) {
    await db.userBranch.createMany({
      data: branchIds.map((branchId) => ({ organizationId, userId, branchId })),
    });
  }
}

export async function guardarSedesDeLaInvitacion(
  organizationId: string,
  invitationId: string,
  branchIds: readonly string[],
  db: Db,
): Promise<void> {
  if (branchIds.length === 0) return;
  await db.invitationBranch.createMany({
    data: branchIds.map((branchId) => ({ organizationId, invitationId, branchId })),
  });
}

/** Las sedes vigentes de cada invitación, ordenadas por nombre de la sede. */
export async function sedesVigentesPorInvitacion(
  organizationId: string,
  invitationIds: readonly string[],
  db: Db = prisma,
): Promise<Map<string, { id: string; name: string }[]>> {
  const porInvitacion = new Map<string, { id: string; name: string }[]>();
  if (invitationIds.length === 0) return porInvitacion;
  const filas = await db.invitationBranch.findMany({
    where: {
      organizationId,
      invitationId: { in: [...invitationIds] },
      branch: { deletedAt: null },
    },
    select: { invitationId: true, branch: { select: { id: true, name: true } } },
    orderBy: [{ branch: { name: "asc" } }, { branchId: "asc" }],
  });
  for (const fila of filas) {
    const lista = porInvitacion.get(fila.invitationId) ?? [];
    lista.push(fila.branch);
    porInvitacion.set(fila.invitationId, lista);
  }
  return porInvitacion;
}

/** Al aceptar una invitación: sus sedes vigentes pasan a ser las del usuario,
 *  en la transacción que crea el usuario. Una sede borrada entre la
 *  invitación y la aceptación no se copia. */
export async function copiarSedesDeLaInvitacion(
  organizationId: string,
  invitationId: string,
  userId: string,
  db: Db,
): Promise<number> {
  const filas = await db.invitationBranch.findMany({
    where: { organizationId, invitationId, branch: { deletedAt: null } },
    select: { branchId: true },
  });
  if (filas.length === 0) return 0;
  const { count } = await db.userBranch.createMany({
    data: filas.map((f) => ({ organizationId, userId, branchId: f.branchId })),
    skipDuplicates: true,
  });
  return count;
}

/** Recepción de esta sede, activa, con sus tareas abiertas: para elegir a
 *  quién va un aviso (§11.4). */
export async function recepcionDeLaSede(
  organizationId: string,
  branchId: string,
  db: Db = prisma,
): Promise<{ id: string; createdAt: Date; tareasAbiertas: number }[]> {
  const usuarios = await db.user.findMany({
    where: {
      organizationId,
      isActive: true,
      deletedAt: null,
      role: { name: "RECEPCION" },
      userBranches: { some: { organizationId, branchId } },
    },
    select: {
      id: true,
      createdAt: true,
      _count: {
        select: {
          assignedActivities: { where: { completedAt: null, deletedAt: null, type: "TASK" } },
        },
      },
    },
  });
  return usuarios.map((u) => ({
    id: u.id,
    createdAt: u.createdAt,
    tareasAbiertas: u._count.assignedActivities,
  }));
}
