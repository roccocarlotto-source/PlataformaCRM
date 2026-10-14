import { prisma, type Db } from "../lib/prisma";

// ---------------------------------------------------------------------------
// Los módulos activables de una organización (docs/servicios.md §1.2,
// organization_modules). Activo = la fila existe y disabled_at es NULL. Solo
// los escribe el service de Plataforma (services/organizationModules.service.ts);
// el contexto de autenticación los lee en findUserForAuth, no acá.
// ---------------------------------------------------------------------------

export function findOrganizationModule(organizationId: string, module: string, db: Db = prisma) {
  return db.organizationModule.findUnique({
    where: { organizationId_module: { organizationId, module } },
  });
}

/** Crea la fila (primera activación). */
export function createOrganizationModule(
  organizationId: string,
  module: string,
  enabledById: string,
  db: Db,
) {
  return db.organizationModule.create({ data: { organizationId, module, enabledById } });
}

/** Reactiva: limpia la baja. NO toca enabled_at ni enabled_by_id: la primera
 *  activación es la que define qué ventas reciben el primer service (§6.1). */
export function reactivateOrganizationModule(organizationId: string, module: string, db: Db) {
  return db.organizationModule.update({
    where: { organizationId_module: { organizationId, module } },
    data: { disabledAt: null, disabledById: null },
  });
}

/** Desactiva una fila activa. Devuelve cuántas cambió (0 si ya estaba
 *  desactivada o no existía). */
export async function disableOrganizationModule(
  organizationId: string,
  module: string,
  disabledById: string,
  db: Db,
): Promise<number> {
  const { count } = await db.organizationModule.updateMany({
    where: { organizationId, module, disabledAt: null },
    data: { disabledAt: new Date(), disabledById },
  });
  return count;
}

/** Los módulos activables vigentes de una organización, en orden. */
export async function activeModulesOfOrganization(
  organizationId: string,
  db: Db = prisma,
): Promise<string[]> {
  const filas = await db.organizationModule.findMany({
    where: { organizationId, disabledAt: null },
    select: { module: true },
    orderBy: { module: "asc" },
  });
  return filas.map((f) => f.module);
}
