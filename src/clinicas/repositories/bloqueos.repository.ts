import { prisma, type Db } from "../../lib/prisma";

// ---------------------------------------------------------------------------
// Bloqueos y sobreturnos de los profesionales de una clínica (docs/rubros.md
// §4.4 y §4.5, migración 20261106120000). organizationId en cada WHERE, como en
// el resto de los repositorios.
// ---------------------------------------------------------------------------

/** Los bloqueos del profesional que se superponen con [desde, hasta). Para una
 *  automotora siempre devuelve [] (no tiene filas). */
export function findBloqueosQueSeSuperponen(
  organizationId: string,
  resourceId: string,
  desde: Date,
  hasta: Date,
  db: Db = prisma,
) {
  return db.resourceTimeOff.findMany({
    where: { organizationId, resourceId, startsAt: { lt: hasta }, endsAt: { gt: desde } },
    orderBy: { startsAt: "asc" },
  });
}

export function crearBloqueo(
  data: {
    organizationId: string;
    resourceId: string;
    startsAt: Date;
    endsAt: Date;
    reason: string | null;
  },
  db: Db = prisma,
) {
  return db.resourceTimeOff.create({ data });
}

export function findBloqueoById(id: string, organizationId: string, db: Db = prisma) {
  return db.resourceTimeOff.findFirst({
    where: { id, organizationId },
    include: { resource: { select: { id: true, branchId: true } } },
  });
}

export function borrarBloqueo(id: string, organizationId: string, db: Db = prisma) {
  return db.resourceTimeOff.deleteMany({ where: { id, organizationId } });
}

/** Los turnos CONFIRMED del profesional que caen dentro de [desde, hasta):
 *  los "afectados" por un bloqueo nuevo, con el paciente y la prestación. */
export function findTurnosAfectados(
  organizationId: string,
  resourceId: string,
  desde: Date,
  hasta: Date,
  db: Db = prisma,
) {
  return db.booking.findMany({
    where: {
      organizationId,
      resourceId,
      status: "CONFIRMED",
      startsAt: { lt: hasta },
      endsAt: { gt: desde },
    },
    select: {
      id: true,
      startsAt: true,
      endsAt: true,
      isOverbooking: true,
      contact: { select: { id: true, firstName: true, lastName: true } },
      serviceType: { select: { id: true, name: true } },
    },
    orderBy: { startsAt: "asc" },
  });
}

/** Los sobreturnos no cancelados del profesional que empiezan en [desde,
 *  hasta): el día de la sede, para el tope diario. */
export function contarSobreturnos(
  organizationId: string,
  resourceId: string,
  desde: Date,
  hasta: Date,
  db: Db = prisma,
) {
  return db.booking.count({
    where: {
      organizationId,
      resourceId,
      isOverbooking: true,
      status: { not: "CANCELLED" },
      startsAt: { gte: desde, lt: hasta },
    },
  });
}

/** Los sobreturnos no cancelados del profesional en un rango, para contar por
 *  día al ofrecerlos. */
export function findInicioDeSobreturnos(
  organizationId: string,
  resourceId: string,
  desde: Date,
  hasta: Date,
  db: Db = prisma,
) {
  return db.booking.findMany({
    where: {
      organizationId,
      resourceId,
      isOverbooking: true,
      status: { not: "CANCELLED" },
      startsAt: { gte: desde, lt: hasta },
    },
    select: { startsAt: true },
  });
}

export function guardarSobreturnosDelProfesional(
  organizationId: string,
  resourceId: string,
  data: { allowsOverbooking: boolean; maxOverbookingsPerDay: number },
  db: Db = prisma,
) {
  return db.resource.updateMany({
    where: { id: resourceId, organizationId, deletedAt: null },
    data,
  });
}
