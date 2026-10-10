import { DateTime } from "luxon";
import { logger } from "../../lib/logger";
import { prisma, type Db } from "../../lib/prisma";
import { createActivity as createActivityRepo } from "../../repositories/activity.repository";
import { countOverlappingBookings, findBookingById } from "../../repositories/booking.repository";
import { findResourceById, lockResourceForUpdate } from "../../repositories/resource.repository";
import { lockServiceTypeForUpdate } from "../../repositories/serviceType.repository";
import { findOldestActiveAdmin } from "../../repositories/user.repository";
import { resolverContexto } from "../../services/availability.service";
import { relojDeReservas, validarSobreturno } from "../../services/booking.service";
import { getBranchById } from "../../services/branch.service";
import {
  getClienteGoogleCalendar,
  type ClienteGoogleCalendar,
} from "../../services/googleCalendar.service";
import { obtenerAccessToken } from "../../services/googleCalendarConnection.service";
import { exigirSedeDelActor, type ActorConSedes } from "../../services/permisos";
import type { RoleName } from "../../types/auth";
import { AppError } from "../../utils/AppError";
import { estaDentroDelHorario, estaEnLaGrilla } from "../../utils/workingHours";
import { findBloqueosQueSeSuperponen } from "../repositories/bloqueos.repository";
import { EVENTO_TURNO_REPROGRAMADO, emitirEventoDeTurno } from "./eventosDeTurno";
import { recepcionistaParaElAviso } from "./sedesDeUsuarios.service";

// ---------------------------------------------------------------------------
// Reprogramar un turno de clínica (docs/rubros.md §4.7, R9).
//
// MISMO id, otro horario y, si la prestación lo admite (R5), otro profesional.
// El horario nuevo pasa por las MISMAS reglas que agendar: horario y grilla del
// profesional (resolverContexto, salvo `force` de ADMIN), bloqueos (R6) y
// capacidad (sin contar el propio turno); el sobreturno solo con
// `isOverbooking`, si el profesional lo permite y dentro de su tope (R6).
//
// LO REUSA R11 (la tool reschedule_booking del agente): la tool tiene que
// llamar a reprogramarTurno con `quien` = el asistente y sin `isOverbooking` ni
// `force`, y sumar SUS reglas propias antes (turno del contacto de la
// conversación, candado de identidad, minHoursToChangeBooking). Nada de las
// validaciones, de Google ni del historial tiene que duplicarse en la tool.
//
// GOOGLE (§4.6, R8), después del commit y best-effort: mismo profesional,
// events.patch en el calendario del turno; otro profesional, delete en el viejo
// e insert en el nuevo. Para que la notificación de vuelta de Google NO genere
// la tarea de "turno movido/borrado en Google": el horario nuevo (y, si cambia
// de profesional, el desvinculado del evento viejo) se guardan en la base ANTES
// de tocar Google. Si Google falla (con la sede conectada), se crea en el
// momento una tarea para la Recepción de la sede: sin columna de
// "desincronizado", decisión de Rocco del 2026-10-10.
//
// RECORDATORIOS: hoy no existen (R13). R13 tiene que recalcular acá el mensaje
// pendiente del turno (BookingMessage REMINDER): moverlo al horario nuevo o
// cancelarlo si ya no corresponde (§6.1, §4.7).
// ---------------------------------------------------------------------------

export interface ReprogramacionInput {
  startsAt: Date;
  // Otro profesional de la prestación. Sin él, el mismo.
  resourceId?: string;
  // Sobreturno en el horario nuevo (solo una persona, §4.4).
  isOverbooking?: boolean;
  // Fuera de horario: solo ADMIN, como al agendar.
  force?: boolean;
}

export interface QuienReprograma extends ActorConSedes {
  userId: string;
  role: RoleName;
  // Cómo queda en el historial: el nombre de la persona, o "el asistente" (R11).
  descripcion: string;
}

export const PREFIJO_NOTA_REPROGRAMADO = "Turno reprogramado: ";
export const PREFIJO_TAREA_GOOGLE_DESINCRONIZADO = "Turno sin actualizar en Google: ";

type Cliente = ClienteGoogleCalendar | undefined;

function formato(fecha: Date, zona: string): string {
  return DateTime.fromJSDate(fecha, { zone: zona })
    .setLocale("es")
    .toFormat("cccc d 'de' LLLL 'a las' HH:mm");
}

export async function reprogramarTurno(
  organizationId: string,
  bookingId: string,
  input: ReprogramacionInput,
  quien: QuienReprograma,
  cliente?: Cliente,
) {
  const original = await findBookingById(bookingId, organizationId);
  if (!original) throw new AppError("Reserva no encontrada", 404);
  exigirSedeDelActor(quien, original.branchId, "Reserva no encontrada");

  const ahora = relojDeReservas.ahora();
  if (original.status !== "CONFIRMED") {
    throw new AppError("Solo se puede reprogramar un turno confirmado", 409);
  }
  if (original.startsAt.getTime() <= ahora.getTime()) {
    throw new AppError("Ese turno ya empezó o ya pasó: no se puede reprogramar", 400);
  }
  if (input.force === true && quien.role !== "ADMIN") {
    throw new AppError("Solo un administrador puede forzar un turno fuera de horario", 403);
  }
  if (input.isOverbooking === true && quien.role !== "ADMIN" && quien.role !== "RECEPCION") {
    throw new AppError("Solo una persona del equipo puede cargar un sobreturno", 403);
  }
  if (input.startsAt.getTime() < ahora.getTime()) {
    throw new AppError("El horario solicitado ya pasó", 400);
  }
  const destinoId = input.resourceId ?? original.resourceId;
  if (
    destinoId === original.resourceId &&
    input.startsAt.getTime() === original.startsAt.getTime()
  ) {
    throw new AppError("El turno ya está en ese horario", 400);
  }

  // La misma validación de horario que agendar (y que la disponibilidad).
  const {
    serviceType,
    resource: destino,
    branch,
    franjasDeTrabajo,
  } = await resolverContexto(organizationId, {
    resourceId: destinoId,
    serviceTypeId: original.serviceTypeId,
    desde: input.startsAt,
    hasta: new Date(input.startsAt.getTime() + 24 * 60 * 60 * 1000),
  });
  if (destino.branchId !== original.branchId) {
    throw new AppError("El profesional tiene que ser de la misma sede que el turno", 400);
  }
  const startsAt = input.startsAt;
  const endsAt = new Date(startsAt.getTime() + serviceType.durationMin * 60 * 1000);
  const turno = { inicio: startsAt, fin: endsAt };
  if (input.force !== true) {
    if (!estaDentroDelHorario(turno, franjasDeTrabajo)) {
      throw new AppError(
        "El horario solicitado está fuera del horario de trabajo del profesional",
        400,
      );
    }
    if (!estaEnLaGrilla(turno, franjasDeTrabajo, serviceType.durationMin)) {
      throw new AppError(
        "El horario solicitado no coincide con los turnos disponibles de este profesional",
        400,
      );
    }
  }

  const origen = await findResourceById(original.resourceId, organizationId);
  const contacto = await prisma.contact.findFirst({
    where: { id: original.contactId, organizationId },
    select: { firstName: true, lastName: true },
  });
  const paciente = contacto ? `${contacto.firstName} ${contacto.lastName}`.trim() : "el paciente";
  const cambiaDeProfesional = destinoId !== original.resourceId;

  const actualizado = await prisma.$transaction(async (tx) => {
    // Locks en orden por id: dos reprogramaciones cruzadas entre los mismos dos
    // profesionales no se abrazan. Después el servicio, como createBooking.
    for (const id of [...new Set([original.resourceId, destinoId])].sort()) {
      await lockResourceForUpdate(id, organizationId, tx);
    }
    await lockServiceTypeForUpdate(original.serviceTypeId, organizationId, tx);

    const vigente = await tx.booking.findFirst({ where: { id: bookingId, organizationId } });
    if (!vigente || vigente.status !== "CONFIRMED") {
      throw new AppError("Solo se puede reprogramar un turno confirmado", 409);
    }
    const destinoActual = await findResourceById(destinoId, organizationId, tx);
    if (!destinoActual) {
      throw new AppError("El recurso indicado no existe o no pertenece a tu organización", 400);
    }

    const bloqueos = await findBloqueosQueSeSuperponen(
      organizationId,
      destinoId,
      startsAt,
      endsAt,
      tx,
    );
    if (bloqueos.length > 0) {
      throw new AppError("El profesional no atiende en ese horario: tiene un bloqueo", 409);
    }
    const tomados = await countOverlappingBookings(
      organizationId,
      destinoId,
      startsAt,
      endsAt,
      tx,
      bookingId,
    );
    let esSobreturno = false;
    if (input.isOverbooking === true) {
      await validarSobreturno({
        organizationId,
        resource: destinoActual,
        capacidad: serviceType.capacity,
        tomados,
        startsAt,
        zona: branch.timezone,
        tx,
        excluirBookingId: bookingId,
      });
      esSobreturno = true;
    } else if (tomados >= serviceType.capacity) {
      throw new AppError(
        serviceType.capacity === 1
          ? "Ese horario ya está reservado"
          : `Ese horario ya no tiene lugares disponibles (capacidad ${serviceType.capacity})`,
        409,
      );
    }

    // Con otro profesional, el evento viejo se desvincula ACÁ (antes de
    // borrarlo en Google): su notificación de borrado no encuentra el turno.
    const fila = await tx.booking.update({
      where: { id: bookingId },
      data: {
        resourceId: destinoId,
        startsAt,
        endsAt,
        isOverbooking: esSobreturno,
        ...(cambiaDeProfesional ? { googleEventId: null, googleCalendarId: null } : {}),
      },
    });

    await createActivityRepo(
      {
        organizationId,
        authorId: quien.userId,
        type: "NOTE",
        assigneeId: null,
        companyId: null,
        contactId: original.contactId,
        opportunityId: null,
        branchId: original.branchId,
        subject: `${PREFIJO_NOTA_REPROGRAMADO}${paciente}`.slice(0, 255),
        body:
          `Antes: ${formato(original.startsAt, branch.timezone)} con ${origen?.name ?? "el profesional"}. ` +
          `Ahora: ${formato(startsAt, branch.timezone)} con ${destinoActual.name}. ` +
          `Reprogramó: ${quien.descripcion}.`,
      },
      tx,
    );
    // R10: booking.rescheduled (reprogramar es solo de clínicas), con el
    // horario y el profesional de antes.
    await emitirEventoDeTurno(tx, EVENTO_TURNO_REPROGRAMADO, fila, {
      anterior: {
        startsAt: original.startsAt.toISOString(),
        endsAt: original.endsAt.toISOString(),
        resourceId: original.resourceId,
      },
      isOverbooking: fila.isOverbooking,
    });
    return fila;
  });

  const sincronizado = await reflejarEnGoogle(
    organizationId,
    {
      original,
      actualizado,
      titulo: `${serviceType.name} — ${paciente}`,
      descripcion: `Reserva reprogramada desde el CRM.\nRecurso: ${destino.name}\nSucursal: ${branch.name}`,
      zona: branch.timezone,
      calendarioDestino: destino.googleCalendarId ?? undefined,
      cambiaDeProfesional,
    },
    cliente,
  );
  if (!sincronizado) {
    await avisarGoogleDesincronizado(organizationId, actualizado, {
      paciente,
      profesional: destino.name,
      cuando: formato(startsAt, branch.timezone),
    });
  }
  return prisma.booking.findFirstOrThrow({ where: { id: bookingId, organizationId } });
}

// true = Google quedó al día, o no hay nada que hacer (la sede sin Google
// conectado no es un fallo). false = había que actualizar y Google falló.
async function reflejarEnGoogle(
  organizationId: string,
  datos: {
    original: { googleEventId: string | null; googleCalendarId: string | null; branchId: string };
    actualizado: { id: string; startsAt: Date; endsAt: Date };
    titulo: string;
    descripcion: string;
    zona: string;
    calendarioDestino?: string;
    cambiaDeProfesional: boolean;
  },
  clienteInyectado?: Cliente,
): Promise<boolean> {
  const { original, actualizado } = datos;
  let acceso: { accessToken: string; calendarId: string };
  try {
    acceso = await obtenerAccessToken(organizationId, original.branchId, clienteInyectado);
  } catch (err) {
    // Sin conexión (404) o no activa (409): no hay espejo que mantener.
    if (err instanceof AppError && (err.statusCode === 404 || err.statusCode === 409)) {
      return true;
    }
    logger.warn({ err, organizationId }, "No se pudo obtener el acceso a Google al reprogramar");
    return false;
  }
  try {
    const google = clienteInyectado ?? getClienteGoogleCalendar();
    if (original.googleEventId && !datos.cambiaDeProfesional) {
      if (!google.actualizarEvento) throw new Error("El cliente de Google no actualiza eventos");
      await google.actualizarEvento({
        accessToken: acceso.accessToken,
        calendarId: original.googleCalendarId ?? acceso.calendarId,
        eventId: original.googleEventId,
        inicio: actualizado.startsAt,
        fin: actualizado.endsAt,
        zona: datos.zona,
      });
      return true;
    }
    if (original.googleEventId) {
      await google.eliminarEvento({
        accessToken: acceso.accessToken,
        calendarId: original.googleCalendarId ?? acceso.calendarId,
        eventId: original.googleEventId,
      });
    }
    const nuevo = await google.crearEvento({
      accessToken: acceso.accessToken,
      calendarId: datos.calendarioDestino ?? acceso.calendarId,
      titulo: datos.titulo,
      descripcion: datos.descripcion,
      inicio: actualizado.startsAt,
      fin: actualizado.endsAt,
      zona: datos.zona,
    });
    await prisma.booking.updateMany({
      where: { id: actualizado.id, organizationId, status: "CONFIRMED" },
      data: { googleEventId: nuevo, googleCalendarId: datos.calendarioDestino ?? null },
    });
    return true;
  } catch (err) {
    logger.warn(
      { err, organizationId, bookingId: actualizado.id },
      "No se pudo reflejar en Google Calendar un turno reprogramado: se avisa a la recepción",
    );
    return false;
  }
}

async function avisarGoogleDesincronizado(
  organizationId: string,
  booking: { id: string; branchId: string; contactId: string },
  texto: { paciente: string; profesional: string; cuando: string },
) {
  const sede = await getBranchById(organizationId, booking.branchId);
  const asignadoId =
    (await recepcionistaParaElAviso(organizationId, booking.branchId)) ??
    sede.defaultOwnerId ??
    (await findOldestActiveAdmin(organizationId))?.id ??
    null;
  if (!asignadoId) return;
  await createActivityRepo({
    organizationId,
    authorId: asignadoId,
    type: "TASK",
    assigneeId: asignadoId,
    companyId: null,
    contactId: booking.contactId,
    opportunityId: null,
    branchId: booking.branchId,
    subject: `${PREFIJO_TAREA_GOOGLE_DESINCRONIZADO}${texto.paciente}`.slice(0, 255),
    body:
      `El turno de ${texto.paciente} con ${texto.profesional} se reprogramó al ${texto.cuando}, ` +
      "pero no se pudo actualizar en Google Calendar: avisale al profesional.",
  });
}

// ---------------------------------------------------------------------------
// Archivar un profesional con turnos futuros (R9): no se cancelan solos. Una
// tarea por turno para la Recepción de la sede, como con los bloqueos (R6).
// Lo llama deleteResource, dentro de su transacción, solo en una clínica.
// ---------------------------------------------------------------------------

export const PREFIJO_TAREA_PROFESIONAL_ARCHIVADO = "Turno de un profesional archivado: ";

export function contarTurnosFuturosDelProfesional(
  organizationId: string,
  resourceId: string,
  db: Db = prisma,
) {
  return db.booking.count({
    where: {
      organizationId,
      resourceId,
      status: "CONFIRMED",
      startsAt: { gt: relojDeReservas.ahora() },
    },
  });
}

export async function tareasPorTurnosFuturosDelProfesional(
  organizationId: string,
  profesional: { id: string; name: string; branchId: string },
  asignadoId: string,
  db: Db,
): Promise<number> {
  const turnos = await db.booking.findMany({
    where: {
      organizationId,
      resourceId: profesional.id,
      status: "CONFIRMED",
      startsAt: { gt: relojDeReservas.ahora() },
    },
    select: {
      startsAt: true,
      contactId: true,
      contact: { select: { firstName: true, lastName: true } },
      branch: { select: { timezone: true } },
    },
    orderBy: { startsAt: "asc" },
  });
  for (const t of turnos) {
    const paciente = `${t.contact.firstName} ${t.contact.lastName}`.trim();
    await createActivityRepo(
      {
        organizationId,
        authorId: asignadoId,
        type: "TASK",
        assigneeId: asignadoId,
        companyId: null,
        contactId: t.contactId,
        opportunityId: null,
        branchId: profesional.branchId,
        subject: `${PREFIJO_TAREA_PROFESIONAL_ARCHIVADO}${paciente}`.slice(0, 255),
        body:
          `${profesional.name} se archivó y ${paciente} tiene un turno con ` +
          `${profesional.name} el ${formato(t.startsAt, t.branch.timezone)}. El turno sigue en ` +
          "pie: reprogramalo con otro profesional o cancelalo, y avisale al paciente.",
      },
      db,
    );
  }
  return turnos.length;
}

/** A quién van las tareas de un profesional archivado: la Recepción de su sede
 *  (§11.4), si no el Responsable por defecto, si no el ADMIN más antiguo. */
export async function asignadoParaLaSede(organizationId: string, branchId: string) {
  const sede = await getBranchById(organizationId, branchId);
  return (
    (await recepcionistaParaElAviso(organizationId, branchId)) ??
    sede.defaultOwnerId ??
    (await findOldestActiveAdmin(organizationId))?.id ??
    null
  );
}
