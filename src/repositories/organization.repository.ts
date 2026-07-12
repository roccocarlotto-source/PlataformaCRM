import { prisma, type Db } from "../lib/prisma";

export function findOrganizationBySlug(slug: string, db: Db = prisma) {
  return db.organization.findUnique({ where: { slug } });
}

export function createOrganization(
  data: { name: string; slug: string },
  db: Db = prisma,
) {
  return db.organization.create({ data });
}

// Punto de serialización único por organización: lockea su fila con
// SELECT ... FOR UPDATE para volver atómica cualquier operación cuya
// decisión dependa de un conteo agregado sobre sus Users (ver
// countActiveAdmins en user.repository.ts / user.service.ts). Sin default
// para `db` a propósito — correr esto fuera de una transacción no
// tiene efecto real (el lock se libera al instante), mismo criterio que
// shiftUpFrom/shiftDownAfter en stage.repository.ts.
export async function lockOrganizationForUpdate(
  organizationId: string,
  db: Db,
): Promise<void> {
  await db.$queryRaw`SELECT id FROM organizations WHERE id = ${organizationId}::uuid FOR UPDATE`;
}
