import { prisma, type Db } from "../../lib/prisma";

// ---------------------------------------------------------------------------
// Los profesionales de una prestación de clínica (docs/rubros.md §4.3,
// migración 20261102120000).
//
// LOS PROFESIONALES DE UNA PRESTACIÓN = su profesional principal
// (ServiceType.resourceId, que no se toca) MÁS las filas de
// service_type_resources. Las lecturas hacen esa unión siempre, así que nada
// depende de que el principal tenga su fila.
//
// organizationId en cada WHERE, como en el resto de los repositorios.
// ---------------------------------------------------------------------------

export interface Profesional {
  id: string;
  name: string;
  branchId: string;
}

/** ¿El recurso atiende la prestación? Principal o con su fila. Para ACEPTAR un
 *  recurso que no es el del servicio (disponibilidad y reserva): una
 *  automotora no tiene filas, así que para ella sigue siendo "solo el
 *  principal". */
export async function esProfesionalDeLaPrestacion(
  organizationId: string,
  serviceType: { id: string; resourceId: string },
  resourceId: string,
  db: Db = prisma,
): Promise<boolean> {
  if (serviceType.resourceId === resourceId) return true;
  const fila = await db.serviceTypeResource.findFirst({
    where: { organizationId, serviceTypeId: serviceType.id, resourceId },
    select: { resourceId: true },
  });
  return fila !== null;
}

/** Los profesionales vigentes de varias prestaciones, por prestación,
 *  ordenados por nombre. Los dados de baja no cuentan. */
export async function profesionalesDeLasPrestaciones(
  organizationId: string,
  serviceTypes: readonly { id: string; resourceId: string }[],
  db: Db = prisma,
): Promise<Map<string, Profesional[]>> {
  const ids = serviceTypes.map((st) => st.id);
  const filas =
    ids.length === 0
      ? []
      : await db.serviceTypeResource.findMany({
          where: { organizationId, serviceTypeId: { in: ids } },
          select: { serviceTypeId: true, resourceId: true },
        });
  const recursoIds = new Set([
    ...serviceTypes.map((st) => st.resourceId),
    ...filas.map((f) => f.resourceId),
  ]);
  const recursos =
    recursoIds.size === 0
      ? []
      : await db.resource.findMany({
          where: { organizationId, id: { in: [...recursoIds] }, deletedAt: null },
          select: { id: true, name: true, branchId: true },
        });
  const porId = new Map(recursos.map((r) => [r.id, r]));

  const resultado = new Map<string, Profesional[]>();
  for (const st of serviceTypes) {
    const deLaPrestacion = new Set([
      st.resourceId,
      ...filas.filter((f) => f.serviceTypeId === st.id).map((f) => f.resourceId),
    ]);
    resultado.set(
      st.id,
      [...deLaPrestacion]
        .map((id) => porId.get(id))
        .filter((r): r is Profesional => r !== undefined)
        .sort((a, b) => a.name.localeCompare(b.name, "es") || a.id.localeCompare(b.id)),
    );
  }
  return resultado;
}

export async function profesionalesDeLaPrestacion(
  organizationId: string,
  serviceType: { id: string; resourceId: string },
  db: Db = prisma,
): Promise<Profesional[]> {
  return (await profesionalesDeLasPrestaciones(organizationId, [serviceType], db)).get(
    serviceType.id,
  )!;
}

/** Reemplaza los profesionales de una prestación: deja exactamente
 *  `resourceIds` (que ya trae al principal). Dentro de la transacción de
 *  quien llama. */
export async function reemplazarProfesionales(
  organizationId: string,
  serviceTypeId: string,
  resourceIds: readonly string[],
  db: Db,
): Promise<void> {
  await db.serviceTypeResource.deleteMany({
    where: { organizationId, serviceTypeId, resourceId: { notIn: [...resourceIds] } },
  });
  await db.serviceTypeResource.createMany({
    data: resourceIds.map((resourceId) => ({ organizationId, serviceTypeId, resourceId })),
    skipDuplicates: true,
  });
}

/** Cuántos turnos confirmados tiene cada recurso en [desde, hasta): para
 *  elegir "el primero libre" con menos turnos ese día (§4.3). */
export async function contarTurnosPorRecurso(
  organizationId: string,
  resourceIds: readonly string[],
  desde: Date,
  hasta: Date,
  db: Db = prisma,
): Promise<Map<string, number>> {
  const grupos =
    resourceIds.length === 0
      ? []
      : await db.booking.groupBy({
          by: ["resourceId"],
          where: {
            organizationId,
            resourceId: { in: [...resourceIds] },
            status: "CONFIRMED",
            startsAt: { gte: desde, lt: hasta },
          },
          _count: { _all: true },
        });
  return new Map(grupos.map((g) => [g.resourceId, g._count._all]));
}
