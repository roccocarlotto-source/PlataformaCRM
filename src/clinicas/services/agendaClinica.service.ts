import { DateTime } from "luxon";
import { prisma } from "../../lib/prisma";
import { findResourceById } from "../../repositories/resource.repository";
import {
  findManyServiceTypes,
  findServiceTypeById,
  lockServiceTypeForUpdate,
} from "../../repositories/serviceType.repository";
import {
  obtenerDisponibilidad,
  resolverContexto,
  type TurnoDisponible,
} from "../../services/availability.service";
import { generarGrilla, seSuperponen } from "../../utils/workingHours";
import {
  findBloqueosQueSeSuperponen,
  findInicioDeSobreturnos,
} from "../repositories/bloqueos.repository";
import { createBooking, relojDeReservas, type BookingActor } from "../../services/booking.service";
import { getBranchById } from "../../services/branch.service";
import type { ClienteGoogleCalendar } from "../../services/googleCalendar.service";
import { exigirSedeDelActor, type ActorConSedes } from "../../services/permisos";
import { getServiceTypeById } from "../../services/serviceType.service";
import { AppError } from "../../utils/AppError";
import { enParalelo } from "../../utils/enParalelo";
import {
  contarTurnosPorRecurso,
  profesionalesDeLaPrestacion,
  profesionalesDeLasPrestaciones,
  reemplazarProfesionales,
  type Profesional,
} from "../repositories/serviceTypeResource.repository";

// ---------------------------------------------------------------------------
// Agenda de clínica: varios profesionales por prestación (docs/rubros.md §4.2 y
// §4.3, R5). Módulo agenda_clinica: solo una organización CLINICA llega acá
// (el gate de módulos lo decide).
//
// NO HAY UNA SEGUNDA CUENTA DE DISPONIBILIDAD: la de una prestación es la
// unión de obtenerDisponibilidad por cada profesional, y reservar es
// createBooking con el profesional elegido. Lo que se ofrece y lo que se
// acepta siguen saliendo de la misma función (booking-architecture §5).
// ---------------------------------------------------------------------------

export const MENSAJE_PROFESIONAL_NO_ATIENDE = "Ese profesional no atiende esa prestación";
export const MENSAJE_NINGUN_PROFESIONAL_LIBRE =
  "Ningún profesional de esa prestación está libre en ese horario";

const MAX_PRESTACIONES = 200;

export interface PrestacionConProfesionales {
  id: string;
  branchId: string;
  name: string;
  durationMin: number;
  capacity: number;
  // El principal (ServiceType.resourceId): sigue existiendo y está siempre en
  // `profesionales`.
  resourceId: string;
  profesionales: Profesional[];
}

/** Las prestaciones (de una sucursal, si se indica), con sus profesionales. */
export async function listarPrestaciones(
  organizationId: string,
  filtros: { branchId?: string },
): Promise<PrestacionConProfesionales[]> {
  const prestaciones = await findManyServiceTypes(
    organizationId,
    filtros.branchId ? { branchId: filtros.branchId } : {},
    { skip: 0, take: MAX_PRESTACIONES },
    { sortBy: "name", sortOrder: "asc" },
  );
  const porPrestacion = await profesionalesDeLasPrestaciones(organizationId, prestaciones);
  return prestaciones.map((p) => ({
    id: p.id,
    branchId: p.branchId,
    name: p.name,
    durationMin: p.durationMin,
    capacity: p.capacity,
    resourceId: p.resourceId,
    profesionales: porPrestacion.get(p.id) ?? [],
  }));
}

export async function profesionalesDeUnaPrestacion(
  organizationId: string,
  serviceTypeId: string,
): Promise<Profesional[]> {
  const prestacion = await getServiceTypeById(organizationId, serviceTypeId);
  return profesionalesDeLaPrestacion(organizationId, prestacion);
}

/** Define quiénes atienden una prestación. El principal queda siempre (no se
 *  puede sacar desde acá: es ServiceType.resourceId). Cada profesional tiene
 *  que ser una persona (§4.2) de la misma sucursal que la prestación. */
export async function definirProfesionales(
  organizationId: string,
  serviceTypeId: string,
  resourceIds: readonly string[],
): Promise<Profesional[]> {
  const pedidos = [...new Set(resourceIds)];
  return prisma.$transaction(async (tx) => {
    // Con el lock de la prestación: dos ediciones simultáneas no se pisan, y
    // el principal se relee bajo el lock (pudo cambiar).
    await lockServiceTypeForUpdate(serviceTypeId, organizationId, tx);
    const prestacion = await findServiceTypeById(serviceTypeId, organizationId, tx);
    if (!prestacion) {
      throw new AppError("Servicio no encontrado", 404);
    }
    for (const resourceId of pedidos) {
      if (resourceId === prestacion.resourceId) continue;
      const recurso = await findResourceById(resourceId, organizationId, tx);
      if (!recurso) {
        throw new AppError(
          "El profesional indicado no existe o no pertenece a tu organización",
          400,
        );
      }
      if (recurso.type !== "PERSON") {
        throw new AppError("Solo una persona puede atender una prestación", 400);
      }
      if (recurso.branchId !== prestacion.branchId) {
        throw new AppError(
          "El profesional tiene que ser de la misma sucursal que la prestación",
          400,
        );
      }
    }
    await reemplazarProfesionales(
      organizationId,
      serviceTypeId,
      [...new Set([prestacion.resourceId, ...pedidos])],
      tx,
    );
    return profesionalesDeLaPrestacion(organizationId, prestacion, tx);
  });
}

export interface TurnoConProfesional extends TurnoDisponible {
  profesional: Pick<Profesional, "id" | "name">;
  // R6 (§4.4): un horario completo que se puede tomar como sobreturno. Solo
  // lo pide el panel (`conSobreturnos`); el agente nunca los ve.
  sobreturno?: true;
}

/** Los turnos libres de una prestación: los de un profesional, o la unión de
 *  todos, cada uno con su profesional. Ordenados por hora y después por
 *  nombre. */
export async function disponibilidadDeLaPrestacion(
  organizationId: string,
  params: {
    serviceTypeId: string;
    resourceId?: string;
    desde: Date;
    hasta: Date;
    // R6: sumar los horarios completos que se pueden tomar como sobreturno.
    conSobreturnos?: boolean;
  },
  cliente?: ClienteGoogleCalendar,
  actor?: ActorConSedes,
): Promise<TurnoConProfesional[]> {
  const prestacion = await getServiceTypeById(organizationId, params.serviceTypeId);
  // R20: una prestación de otra sede, para una Recepción, no existe.
  if (actor) exigirSedeDelActor(actor, prestacion.branchId, "Servicio no encontrado");
  const profesionales = await profesionalesDeLaPrestacion(organizationId, prestacion);
  const consultados = elegidos(profesionales, params.resourceId);

  const porProfesional = await enParalelo(
    consultados.map((p) =>
      obtenerDisponibilidad(
        organizationId,
        {
          resourceId: p.id,
          serviceTypeId: prestacion.id,
          desde: params.desde,
          hasta: params.hasta,
        },
        cliente,
      ).then((turnos) => turnos.map((t) => ({ ...t, profesional: { id: p.id, name: p.name } }))),
    ),
  );
  const sobreturnos = params.conSobreturnos
    ? await enParalelo(
        consultados.map((p, i) =>
          sobreturnosOfrecibles(organizationId, prestacion, p, params, porProfesional[i]),
        ),
      )
    : [];
  return [...porProfesional, ...sobreturnos]
    .flat()
    .sort(
      (a, b) =>
        a.inicio.getTime() - b.inicio.getTime() ||
        a.profesional.name.localeCompare(b.profesional.name, "es"),
    );
}

// ---------------------------------------------------------------------------
// R6 (docs/rubros.md §4.4): los horarios completos de un profesional que admite
// sobreturnos y todavía no llegó a su tope ese día. La misma grilla y el mismo
// horario de trabajo que la disponibilidad (resolverContexto, generarGrilla),
// sin los bloqueos ni lo que ya pasó. Google no se resta: un horario completo
// ya está ocupado en Google por el propio turno.
// ---------------------------------------------------------------------------
async function sobreturnosOfrecibles(
  organizationId: string,
  prestacion: { id: string; durationMin: number },
  profesional: Profesional,
  rango: { desde: Date; hasta: Date },
  libres: TurnoConProfesional[],
): Promise<TurnoConProfesional[]> {
  const recurso = await findResourceById(profesional.id, organizationId);
  if (!recurso?.allowsOverbooking) return [];
  const { franjasDeTrabajo, branch } = await resolverContexto(organizationId, {
    resourceId: profesional.id,
    serviceTypeId: prestacion.id,
    desde: rango.desde,
    hasta: rango.hasta,
  });
  const zona = branch.timezone;
  const primerDia = DateTime.fromJSDate(rango.desde, { zone: zona }).startOf("day");
  const ultimoDia = DateTime.fromJSDate(rango.hasta, { zone: zona }).endOf("day");
  const [bloqueos, cargados] = await Promise.all([
    findBloqueosQueSeSuperponen(organizationId, profesional.id, rango.desde, rango.hasta),
    findInicioDeSobreturnos(
      organizationId,
      profesional.id,
      primerDia.toJSDate(),
      ultimoDia.toJSDate(),
    ),
  ]);
  const porDia = new Map<string, number>();
  for (const { startsAt } of cargados) {
    const dia = DateTime.fromJSDate(startsAt, { zone: zona }).toISODate() ?? "";
    porDia.set(dia, (porDia.get(dia) ?? 0) + 1);
  }
  const ahora = Math.max(rango.desde.getTime(), relojDeReservas.ahora().getTime());
  const libresAhora = new Set(libres.map((t) => t.inicio.getTime()));
  const ofrecibles: TurnoConProfesional[] = [];
  for (const franja of franjasDeTrabajo) {
    for (const turno of generarGrilla(franja, prestacion.durationMin)) {
      if (turno.inicio.getTime() < ahora || turno.inicio.getTime() >= rango.hasta.getTime())
        continue;
      if (libresAhora.has(turno.inicio.getTime())) continue;
      if (bloqueos.some((b) => seSuperponen(turno, { inicio: b.startsAt, fin: b.endsAt })))
        continue;
      const dia = DateTime.fromJSDate(turno.inicio, { zone: zona }).toISODate() ?? "";
      if ((porDia.get(dia) ?? 0) >= recurso.maxOverbookingsPerDay) continue;
      ofrecibles.push({
        ...turno,
        lugaresDisponibles: 0,
        profesional: { id: profesional.id, name: profesional.name },
        sobreturno: true,
      });
    }
  }
  return ofrecibles;
}

function elegidos(profesionales: Profesional[], resourceId: string | undefined): Profesional[] {
  if (resourceId === undefined) return profesionales;
  const uno = profesionales.find((p) => p.id === resourceId);
  if (!uno) {
    throw new AppError(MENSAJE_PROFESIONAL_NO_ATIENDE, 400);
  }
  return [uno];
}

/** El orden en que se prueba "el primero libre" (§4.3): el de MENOS turnos
 *  ese día; a igual cantidad, por nombre y después por id, para que la
 *  elección sea estable. PURA. */
export function ordenParaElPrimeroLibre(
  candidatos: readonly Pick<Profesional, "id" | "name">[],
  turnosDelDia: ReadonlyMap<string, number>,
): string[] {
  return [...candidatos]
    .sort(
      (a, b) =>
        (turnosDelDia.get(a.id) ?? 0) - (turnosDelDia.get(b.id) ?? 0) ||
        a.name.localeCompare(b.name, "es") ||
        a.id.localeCompare(b.id),
    )
    .map((c) => c.id);
}

export interface CrearTurnoDeClinicaInput {
  serviceTypeId: string;
  contactId: string;
  startsAt: Date;
  // El profesional elegido. Sin él, "el primero libre".
  resourceId?: string;
  opportunityId?: string;
  force?: boolean;
  // R6: sobreturno, con el profesional elegido (nunca el primero libre).
  isOverbooking?: boolean;
}

/** Reserva un turno de una prestación. Con profesional, es createBooking con
 *  ese profesional (que tiene que atenderla). Sin profesional, elige entre los
 *  que tienen ese horario LIBRE —según la misma disponibilidad que se
 *  ofrece— el de menos turnos ese día, y si otro pedido se lo gana en el medio
 *  (409), prueba con el siguiente. */
export async function crearTurnoDeClinica(
  organizationId: string,
  input: CrearTurnoDeClinicaInput,
  cliente?: ClienteGoogleCalendar,
  actor?: BookingActor,
) {
  const prestacion = await getServiceTypeById(organizationId, input.serviceTypeId);
  if (actor) exigirSedeDelActor(actor, prestacion.branchId, "Servicio no encontrado");
  const profesionales = await profesionalesDeLaPrestacion(organizationId, prestacion);
  const reservar = (resourceId: string) =>
    createBooking(
      organizationId,
      {
        resourceId,
        serviceTypeId: prestacion.id,
        contactId: input.contactId,
        startsAt: input.startsAt,
        ...(input.opportunityId ? { opportunityId: input.opportunityId } : {}),
        ...(input.force !== undefined ? { force: input.force } : {}),
        ...(input.isOverbooking ? { isOverbooking: true } : {}),
      },
      cliente,
      actor,
    );

  if (input.resourceId !== undefined) {
    elegidos(profesionales, input.resourceId);
    return reservar(input.resourceId);
  }
  if (input.force === true) {
    throw new AppError("Para forzar un turno hay que elegir el profesional", 400);
  }
  if (input.isOverbooking === true) {
    throw new AppError("Para un sobreturno hay que elegir el profesional", 400);
  }

  // Quiénes tienen ESE turno libre: la disponibilidad de la ventana del turno,
  // con la misma función que ofrece los horarios.
  const fin = new Date(input.startsAt.getTime() + prestacion.durationMin * 60 * 1000);
  const turnos = await disponibilidadDeLaPrestacion(
    organizationId,
    { serviceTypeId: prestacion.id, desde: input.startsAt, hasta: fin },
    cliente,
  );
  const libres = profesionales.filter((p) =>
    turnos.some(
      (t) => t.profesional.id === p.id && t.inicio.getTime() === input.startsAt.getTime(),
    ),
  );
  if (libres.length === 0) {
    throw new AppError(MENSAJE_NINGUN_PROFESIONAL_LIBRE, 409);
  }

  // "Ese día" es el día de la sucursal, no el de UTC.
  const { timezone } = await getBranchById(organizationId, prestacion.branchId);
  const dia = DateTime.fromJSDate(input.startsAt, { zone: timezone }).startOf("day");
  const turnosDelDia = await contarTurnosPorRecurso(
    organizationId,
    libres.map((p) => p.id),
    dia.toJSDate(),
    dia.plus({ days: 1 }).toJSDate(),
  );

  for (const resourceId of ordenParaElPrimeroLibre(libres, turnosDelDia)) {
    try {
      return await reservar(resourceId);
    } catch (err) {
      // Otro pedido tomó ese turno de ese profesional entre la consulta y el
      // lock: se prueba con el siguiente. Cualquier otro error es del pedido,
      // no del profesional, y se propaga.
      if (err instanceof AppError && err.statusCode === 409) continue;
      throw err;
    }
  }
  throw new AppError(MENSAJE_NINGUN_PROFESIONAL_LIBRE, 409);
}
