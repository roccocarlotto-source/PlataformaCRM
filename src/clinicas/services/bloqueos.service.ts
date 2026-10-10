import { DateTime } from "luxon";
import { prisma } from "../../lib/prisma";
import { createActivity as createActivityRepo } from "../../repositories/activity.repository";
import { findResourceById, lockResourceForUpdate } from "../../repositories/resource.repository";
import { getBranchById } from "../../services/branch.service";
import { exigirSedeDelActor, type ActorConSedes } from "../../services/permisos";
import { AppError } from "../../utils/AppError";
import {
  borrarBloqueo,
  crearBloqueo,
  findBloqueoById,
  findBloqueosQueSeSuperponen,
  findTurnosAfectados,
  guardarSobreturnosDelProfesional,
} from "../repositories/bloqueos.repository";
import { recepcionistaParaElAviso } from "./sedesDeUsuarios.service";

// ---------------------------------------------------------------------------
// Bloqueos y sobreturnos de un profesional de clínica (docs/rubros.md §4.4,
// §4.5, R6).
//
// Bloqueos: los cargan ADMIN y Recepción, dentro de sus sedes (R20: un
// profesional de otra sede es 404). Un bloqueo encima de turnos ya dados NO
// los cancela: la respuesta los lista y se crea UNA TAREA POR TURNO para la
// Recepción de la sede (§11.4), con el paciente del turno. Una por turno y no
// una sola con todos: toda tarea tiene que colgar de un contacto, una empresa o
// una oportunidad (activities_related_entity_check), y así cada una se completa
// cuando se resuelve ese paciente.
//
// Sobreturnos: el permiso y el tope del profesional los fija un ADMIN.
// ---------------------------------------------------------------------------

export const MENSAJE_PROFESIONAL_NO_ENCONTRADO = "Profesional no encontrado";
export const PREFIJO_TAREA_DE_BLOQUEO = "Turno dentro de un bloqueo: ";

/** El profesional de la organización, de las sedes del actor; si no, 404. */
async function profesionalDelActor(
  organizationId: string,
  resourceId: string,
  actor: ActorConSedes,
) {
  const recurso = await findResourceById(resourceId, organizationId);
  if (!recurso) throw new AppError(MENSAJE_PROFESIONAL_NO_ENCONTRADO, 404);
  exigirSedeDelActor(actor, recurso.branchId, MENSAJE_PROFESIONAL_NO_ENCONTRADO);
  return recurso;
}

export async function listarBloqueos(
  organizationId: string,
  resourceId: string,
  rango: { desde: Date; hasta: Date },
  actor: ActorConSedes,
) {
  await profesionalDelActor(organizationId, resourceId, actor);
  return findBloqueosQueSeSuperponen(organizationId, resourceId, rango.desde, rango.hasta);
}

export interface TurnoAfectado {
  bookingId: string;
  startsAt: Date;
  endsAt: Date;
  isOverbooking: boolean;
  paciente: { id: string; nombre: string };
  prestacion: { id: string; name: string };
  tareaId: string;
}

/** Crea el bloqueo y, en la misma transacción y con el lock del profesional (el
 *  mismo que toma una reserva), lista los turnos que quedan adentro y crea sus
 *  tareas. Ningún turno se cancela. */
export async function crearBloqueoDeProfesional(
  organizationId: string,
  resourceId: string,
  input: { startsAt: Date; endsAt: Date; reason?: string | null },
  actor: ActorConSedes & { userId: string },
) {
  const recurso = await profesionalDelActor(organizationId, resourceId, actor);
  if (input.startsAt.getTime() >= input.endsAt.getTime()) {
    throw new AppError("El bloqueo tiene que terminar después de empezar", 400);
  }
  const [sede, recepcionista] = await Promise.all([
    getBranchById(organizationId, recurso.branchId),
    recepcionistaParaElAviso(organizationId, recurso.branchId),
  ]);
  const asignadoId = recepcionista ?? actor.userId;
  const reason = input.reason?.trim() ? input.reason.trim() : null;

  return prisma.$transaction(async (tx) => {
    await lockResourceForUpdate(resourceId, organizationId, tx);
    const bloqueo = await crearBloqueo(
      { organizationId, resourceId, startsAt: input.startsAt, endsAt: input.endsAt, reason },
      tx,
    );
    const turnos = await findTurnosAfectados(
      organizationId,
      resourceId,
      input.startsAt,
      input.endsAt,
      tx,
    );
    const turnosAfectados: TurnoAfectado[] = [];
    for (const turno of turnos) {
      const nombre = `${turno.contact.firstName} ${turno.contact.lastName}`.trim();
      const cuando = DateTime.fromJSDate(turno.startsAt, { zone: sede.timezone })
        .setLocale("es")
        .toFormat("cccc d 'de' LLLL 'a las' HH:mm");
      const tarea = await createActivityRepo(
        {
          organizationId,
          authorId: actor.userId,
          type: "TASK",
          assigneeId: asignadoId,
          companyId: null,
          contactId: turno.contact.id,
          opportunityId: null,
          branchId: recurso.branchId,
          subject: `${PREFIJO_TAREA_DE_BLOQUEO}${nombre}`.slice(0, 255),
          body:
            `${recurso.name} tiene un bloqueo y ${nombre} tiene un turno de ${turno.serviceType.name} ` +
            `el ${cuando}. El turno sigue en pie: reprogramalo o cancelalo, y avisale al paciente.`,
        },
        tx,
      );
      turnosAfectados.push({
        bookingId: turno.id,
        startsAt: turno.startsAt,
        endsAt: turno.endsAt,
        isOverbooking: turno.isOverbooking,
        paciente: { id: turno.contact.id, nombre },
        prestacion: turno.serviceType,
        tareaId: tarea.id,
      });
    }
    return { bloqueo, turnosAfectados };
  });
}

export async function borrarBloqueoDeProfesional(
  organizationId: string,
  id: string,
  actor: ActorConSedes,
) {
  const bloqueo = await findBloqueoById(id, organizationId);
  if (!bloqueo) throw new AppError("Bloqueo no encontrado", 404);
  exigirSedeDelActor(actor, bloqueo.resource.branchId, "Bloqueo no encontrado");
  await borrarBloqueo(id, organizationId);
}

/** El permiso de sobreturnos y su tope (ADMIN). Bajar el tope no toca los ya
 *  cargados: solo frena los próximos. */
export async function configurarSobreturnos(
  organizationId: string,
  resourceId: string,
  input: { allowsOverbooking: boolean; maxOverbookingsPerDay: number },
) {
  const { count } = await guardarSobreturnosDelProfesional(organizationId, resourceId, input);
  if (count === 0) throw new AppError(MENSAJE_PROFESIONAL_NO_ENCONTRADO, 404);
  const recurso = await findResourceById(resourceId, organizationId);
  if (!recurso) throw new AppError(MENSAJE_PROFESIONAL_NO_ENCONTRADO, 404);
  return {
    id: recurso.id,
    allowsOverbooking: recurso.allowsOverbooking,
    maxOverbookingsPerDay: recurso.maxOverbookingsPerDay,
  };
}
