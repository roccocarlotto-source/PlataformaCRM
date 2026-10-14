import type { Prisma } from "@prisma/client";
import { prisma, type Db } from "../../lib/prisma";

// ---------------------------------------------------------------------------
// El catálogo de tipos de service del taller (docs/servicios.md §2.6, D4):
// "Service 10.000 km", "Cambio de aceite", "Alineación". Cada uno con el
// intervalo hasta el próximo service, en meses (null = no fija). Soft delete:
// una orden vieja sigue mostrando el tipo que tuvo.
// ---------------------------------------------------------------------------

const campos = {
  id: true,
  name: true,
  nextServiceAfterMonths: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ServiceJobTypeSelect;

export async function findJobTypes(organizationId: string, soloActivos: boolean) {
  return prisma.serviceJobType.findMany({
    where: { organizationId, deletedAt: null, ...(soloActivos ? { isActive: true } : {}) },
    select: campos,
    orderBy: { name: "asc" },
  });
}

export async function findJobTypeById(organizationId: string, id: string) {
  return prisma.serviceJobType.findFirst({
    where: { id, organizationId, deletedAt: null },
    select: campos,
  });
}

/** Los tipos ACTIVOS de la organización entre estos ids (para validar los de
 *  una orden: uno de otra organización, borrado o inactivo no cuenta). */
export async function findJobTypesActivos(
  organizationId: string,
  ids: readonly string[],
  db: Db = prisma,
) {
  if (ids.length === 0) return [];
  return db.serviceJobType.findMany({
    where: { organizationId, id: { in: [...ids] }, deletedAt: null, isActive: true },
    select: { id: true, nextServiceAfterMonths: true },
  });
}

export async function createJobType(
  organizationId: string,
  data: { name: string; nextServiceAfterMonths: number | null; isActive: boolean },
) {
  return prisma.serviceJobType.create({ data: { organizationId, ...data }, select: campos });
}

export async function updateJobType(
  organizationId: string,
  id: string,
  data: Prisma.ServiceJobTypeUncheckedUpdateManyInput,
): Promise<number> {
  const r = await prisma.serviceJobType.updateMany({
    where: { id, organizationId, deletedAt: null },
    data,
  });
  return r.count;
}
