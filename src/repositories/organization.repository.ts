import { prisma, type Db } from "../lib/prisma";

export function findOrganizationBySlug(slug: string, db: Db = prisma) {
  return db.organization.findUnique({ where: { slug } });
}

export function createOrganization(data: { name: string; slug: string }, db: Db = prisma) {
  return db.organization.create({ data });
}

// Punto de serialización único por organización: lockea su fila con
// SELECT ... FOR UPDATE para volver atómica cualquier operación cuya
// decisión dependa de un conteo agregado sobre sus Users (ver
// countActiveAdmins en user.repository.ts / user.service.ts). Sin default
// para `db` a propósito — correr esto fuera de una transacción no
// tiene efecto real (el lock se libera al instante), mismo criterio que
// shiftUpFrom/shiftDownAfter en stage.repository.ts.
// Verifica que el SELECT ... FOR UPDATE bloqueó una fila (B-17 de
// docs/auditoria-2026-08-29.md). Un SELECT que no encuentra nada no es un
// error para Postgres: devuelve cero filas, no bloquea nada, y la función
// retornaba igual — el caller seguía como si hubiera serializado. Ese camino
// es inalcanzable en operación normal (todos los callers validan existencia
// antes, y ninguna de estas entidades tiene hard delete por la API, así que
// la fila existe físicamente aunque esté soft-deleted — el SQL no filtra
// deleted_at a propósito): si se llega acá con cero filas es un bug del
// caller, y por eso es un Error común y no un AppError. Mismo criterio que
// reindexStages/shiftUpFrom/shiftDownAfter (B-12) y hardDeleteInvitation
// (B-13): el resultado de la escritura —acá, del lock— no se ignora.
export async function lockOrganizationForUpdate(organizationId: string, db: Db): Promise<void> {
  const filas = await db.$queryRaw<
    { id: string }[]
  >`SELECT id FROM organizations WHERE id = ${organizationId}::uuid FOR UPDATE`;
  if (filas.length === 0) {
    throw new Error(
      `lockOrganizationForUpdate: no existe la organización ${organizationId} — no se tomó ningún lock`,
    );
  }
}
