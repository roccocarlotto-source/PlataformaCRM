import { logger } from "../../lib/logger";
import { prisma } from "../../lib/prisma";
import { createActivity as createActivityRepo } from "../../repositories/activity.repository";
import { cancelBooking, relojDeReservas } from "../../services/booking.service";
import { AppError } from "../../utils/AppError";
import { leerConfiguracionDeSede } from "../repositories/clinicSettings.repository";
import { asignadoParaLaSede } from "../services/reprogramar.service";
import {
  PREFIJO_NOTA_CONFIRMADO,
  PREFIJO_TAREA_CANCELAR_FUERA_DE_PLAZO,
  PREFIJO_TAREA_CANCELO_POR_RECORDATORIO,
  PREFIJO_TAREA_SIN_RESPUESTA,
  TEXTO_CANCELADO,
  TEXTO_CANCELAR_FUERA_DE_PLAZO,
  TEXTO_CONFIRMADO,
  TEXTO_TURNO_YA_NO_VIGENTE,
  diaYHora,
} from "./config";
import { recordatorioRespondidoPor } from "./repository";

// ---------------------------------------------------------------------------
// Lo que pasa cuando el paciente toca un botón del recordatorio
// (docs/rubros.md §6.4, R13). SIN MODELO, con cualquier nivel de IA y con el
// agente apagado. El webhook marcó la respuesta en booking_messages (CAS por
// el context.id = el wamid del envío); el worker de turnos del agente llama
// acá antes de cualquier otra cosa y manda el texto fijo que esto devuelve.
//
//   CONFIRMAR  patient_confirmed_at, una nota en el paciente y se cierra la
//              tarea "sin respuesta" si existía.
//   CANCELAR   cancelBooking (emite booking.cancelled y anula los pendientes),
//              con una tarea para Recepción de la sede para ofrecer otro turno,
//              en la misma transacción. Respeta minHoursToChangeBooking:
//              dentro del plazo no cancela, y la tarea dice que quiere
//              cancelar.
//
// El botón se cruza con EL TURNO DEL RECORDATORIO, no con "el próximo turno
// del paciente". Si ese turno ya no está vigente (se canceló, cambió de
// horario), no se toca nada y se le dice. Texto libre en vez de un botón: lo
// atiende el agente como cualquier mensaje, y la tarea "sin respuesta" sigue su
// curso.
// ---------------------------------------------------------------------------

const MS_POR_HORA = 60 * 60 * 1000;

export interface RespuestaResuelta {
  texto: string;
  accion: "CONFIRMADO" | "CANCELADO" | "FUERA_DE_PLAZO" | "NO_VIGENTE" | "YA_RESUELTO";
}

function nombreDe(contacto: { firstName: string; lastName: string }): string {
  return `${contacto.firstName} ${contacto.lastName}`.trim() || "el paciente";
}

/** Cierra la tarea "sin respuesta" abierta de ese turno, si la hay. */
async function cerrarTareaSinRespuesta(
  organizationId: string,
  contactId: string,
  branchId: string,
  ahora: Date,
  db: Parameters<typeof createActivityRepo>[1] = prisma,
) {
  const tareas = await db.activity.findMany({
    where: {
      organizationId,
      contactId,
      branchId,
      type: "TASK",
      deletedAt: null,
      completedAt: null,
      subject: { startsWith: PREFIJO_TAREA_SIN_RESPUESTA },
    },
    select: { id: true, assigneeId: true, authorId: true },
  });
  for (const t of tareas) {
    // Se cierra sola: hecha y confirmada, para que no quede en la cola de
    // confirmación de un ADMIN.
    await db.activity.update({
      where: { id: t.id },
      data: { completedAt: ahora, confirmedAt: ahora, confirmedById: t.assigneeId ?? t.authorId },
    });
  }
}

/**
 * Resuelve la respuesta del entrante `entranteWamid`, si es la de un
 * recordatorio. null = no lo es: el turno sigue el camino de siempre.
 */
export async function resolverRespuestaDelRecordatorio(
  organizationId: string,
  entranteWamid: string,
  // El reloj de los turnos (el mismo que usan las tools del agente, R11).
  ahora: Date = relojDeReservas.ahora(),
): Promise<RespuestaResuelta | null> {
  const m = await recordatorioRespondidoPor(organizationId, entranteWamid);
  if (!m || !m.response) return null;
  const turno = m.booking;
  const paciente = nombreDe(m.contact);
  const { dia, hora } = diaYHora(m.bookingStartsAt, turno.branch.timezone);
  const cuando = `${dia} a las ${hora}`;

  // Una reentrega después de cancelar: el turno ya está cancelado por este
  // mismo botón.
  if (m.response === "CANCELAR" && turno.status === "CANCELLED") {
    return { texto: TEXTO_CANCELADO, accion: "YA_RESUELTO" };
  }
  const vigente =
    turno.status === "CONFIRMED" && turno.startsAt.getTime() === m.bookingStartsAt.getTime();
  if (!vigente) return { texto: TEXTO_TURNO_YA_NO_VIGENTE, accion: "NO_VIGENTE" };

  const autor = await asignadoParaLaSede(organizationId, turno.branchId);

  if (m.response === "CONFIRMAR") {
    await prisma.$transaction(async (tx) => {
      // CAS: una reentrega no deja otra nota.
      const { count } = await tx.booking.updateMany({
        where: { id: turno.id, organizationId, patientConfirmedAt: null },
        data: { patientConfirmedAt: ahora },
      });
      if (count === 1 && autor) {
        await createActivityRepo(
          {
            organizationId,
            type: "NOTE",
            authorId: autor,
            assigneeId: null,
            companyId: null,
            contactId: turno.contactId,
            opportunityId: null,
            branchId: turno.branchId,
            subject: `${PREFIJO_NOTA_CONFIRMADO}${paciente}`.slice(0, 255),
            body: `Confirmó por WhatsApp el turno del ${cuando}.`,
          },
          tx,
        );
      }
      await cerrarTareaSinRespuesta(organizationId, turno.contactId, turno.branchId, ahora, tx);
    });
    return { texto: TEXTO_CONFIRMADO, accion: "CONFIRMADO" };
  }

  // CANCELAR
  const { minHoursToChangeBooking: horas } = await leerConfiguracionDeSede(
    organizationId,
    turno.branchId,
  );
  const tarea = (prefijo: string, body: string) =>
    autor
      ? {
          organizationId,
          type: "TASK" as const,
          authorId: autor,
          assigneeId: autor,
          companyId: null,
          contactId: turno.contactId,
          opportunityId: null,
          branchId: turno.branchId,
          subject: `${prefijo}${paciente} del ${cuando}`.slice(0, 255),
          body,
          dueDate: ahora,
        }
      : null;

  if (horas !== null && turno.startsAt.getTime() - ahora.getTime() < horas * MS_POR_HORA) {
    const datos = tarea(
      PREFIJO_TAREA_CANCELAR_FUERA_DE_PLAZO,
      `Tocó "Necesito cancelar" en el recordatorio, pero falta menos de ${String(horas)} h: el turno NO se canceló. Escribile para resolverlo.`,
    );
    await prisma.$transaction(async (tx) => {
      if (datos) await createActivityRepo(datos, tx);
      await cerrarTareaSinRespuesta(organizationId, turno.contactId, turno.branchId, ahora, tx);
    });
    return { texto: TEXTO_CANCELAR_FUERA_DE_PLAZO, accion: "FUERA_DE_PLAZO" };
  }

  const datos = tarea(
    PREFIJO_TAREA_CANCELO_POR_RECORDATORIO,
    'Tocó "Necesito cancelar" en el recordatorio y el turno se canceló. Ofrecele otro día u horario.',
  );
  try {
    await cancelBooking(organizationId, turno.id, undefined, undefined, async (tx) => {
      if (datos) await createActivityRepo(datos, tx);
      await cerrarTareaSinRespuesta(organizationId, turno.contactId, turno.branchId, ahora, tx);
    });
  } catch (err) {
    // Se canceló entre la lectura y acá (otra persona, o una reentrega).
    if (err instanceof AppError && err.statusCode === 409) {
      logger.info({ organizationId, bookingId: turno.id }, "El turno ya estaba cancelado");
      return { texto: TEXTO_CANCELADO, accion: "YA_RESUELTO" };
    }
    throw err;
  }
  return { texto: TEXTO_CANCELADO, accion: "CANCELADO" };
}
