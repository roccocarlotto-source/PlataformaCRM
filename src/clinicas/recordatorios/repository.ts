import { Prisma, type BookingMessageResponse } from "@prisma/client";
import { prisma, type Db } from "../../lib/prisma";
import { mensajeDeError } from "./config";

// ---------------------------------------------------------------------------
// La cola booking_messages (docs/rubros.md §6.1, R13). Mismo reclamo que las
// otras colas (qrFollowUp.repository.ts): reclamar sube `attempts` y corre
// next_attempt_at un lease hacia adelante, y `attempts` es el token de toda
// transición posterior.
// ---------------------------------------------------------------------------

export interface DatosDelRecordatorio {
  organizationId: string;
  bookingId: string;
  contactId: string;
  automationId: string;
  bookingStartsAt: Date;
  scheduledFor: Date;
}

/** Agenda el recordatorio de un turno en un horario. false si ya había uno
 *  vigente (PENDING o SENT) para ese turno y ese horario: el UNIQUE parcial
 *  booking_messages_vigente_key. */
export async function agendarRecordatorio(datos: DatosDelRecordatorio, db: Db = prisma) {
  const filas = await db.$executeRaw`
    INSERT INTO booking_messages (
      organization_id, booking_id, contact_id, automation_id, kind,
      booking_starts_at, scheduled_for, next_attempt_at, updated_at
    ) VALUES (
      ${datos.organizationId}::uuid, ${datos.bookingId}::uuid, ${datos.contactId}::uuid,
      ${datos.automationId}::uuid, 'REMINDER'::"BookingMessageKind",
      ${datos.bookingStartsAt}, ${datos.scheduledFor}, ${datos.scheduledFor}, now()
    )
    ON CONFLICT (booking_id, kind, booking_starts_at)
      WHERE status IN ('PENDING', 'SENT')
    DO NOTHING`;
  return filas === 1;
}

/** Cancela los recordatorios PENDING de un turno (todos, o los de otro
 *  horario que `excepto`). */
export function cancelarPendientesDelTurno(
  organizationId: string,
  bookingId: string,
  motivo: string,
  db: Db = prisma,
  excepto?: Date,
) {
  return db.bookingMessage.updateMany({
    where: {
      organizationId,
      bookingId,
      status: "PENDING",
      ...(excepto ? { bookingStartsAt: { not: excepto } } : {}),
    },
    data: { status: "CANCELLED", lastError: mensajeDeError(motivo) },
  });
}

/** Cancela los PENDING de una regla (se desactivó o se borró). */
export function cancelarPendientesDeLaRegla(
  organizationId: string,
  automationId: string,
  motivo: string,
  db: Db = prisma,
) {
  return db.bookingMessage.updateMany({
    where: { organizationId, automationId, status: "PENDING" },
    data: { status: "CANCELLED", lastError: mensajeDeError(motivo) },
  });
}

/** Lo del contacto, al borrar sus datos personales: cancela los PENDING y
 *  limpia el last_error de todas sus filas (podía tener un dato del envío). */
export async function limpiarRecordatoriosDelContacto(
  organizationId: string,
  contactId: string,
  db: Db = prisma,
) {
  await db.bookingMessage.updateMany({
    where: { organizationId, contactId, status: "PENDING" },
    data: { status: "CANCELLED" },
  });
  return db.bookingMessage.updateMany({
    where: { organizationId, contactId },
    data: { lastError: null },
  });
}

export interface RecordatorioReclamado {
  id: string;
  organizationId: string;
  attempts: number;
}

export async function reclamarRecordatorio(
  leaseMs: number,
  ahora: Date,
  opciones: { organizationId?: string } = {},
  db: Db = prisma,
): Promise<RecordatorioReclamado | null> {
  const filtroOrg = opciones.organizationId
    ? Prisma.sql`AND c.organization_id = ${opciones.organizationId}::uuid`
    : Prisma.empty;
  const filas = await db.$queryRaw<{ id: string; organization_id: string; attempts: number }[]>`
    UPDATE booking_messages f
    SET attempts = f.attempts + 1,
        next_attempt_at = ${ahora}::timestamp + (${leaseMs}::int * interval '1 millisecond'),
        updated_at = now()
    WHERE f.id = (
      SELECT c.id FROM booking_messages c
      WHERE c.status = 'PENDING'::"BookingMessageStatus"
        AND c.next_attempt_at <= ${ahora}
        ${filtroOrg}
      ORDER BY c.next_attempt_at
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING f.id, f.organization_id, f.attempts`;
  const fila = filas[0];
  return fila
    ? { id: fila.id, organizationId: fila.organization_id, attempts: fila.attempts }
    : null;
}

/** Todo lo que el worker relee antes de mandar. */
export function leerRecordatorioParaEnviar(id: string, organizationId: string, db: Db = prisma) {
  return db.bookingMessage.findFirst({
    where: { id, organizationId },
    include: {
      automation: {
        select: { isActive: true, deletedAt: true, actionConfig: true, triggerType: true },
      },
      contact: {
        select: { firstName: true, lastName: true, phone: true, deletedAt: true },
      },
      booking: {
        select: {
          status: true,
          startsAt: true,
          branchId: true,
          resource: { select: { name: true } },
          branch: { select: { name: true, timezone: true, deletedAt: true } },
        },
      },
      organization: { select: { name: true } },
    },
  });
}

export type RecordatorioParaEnviar = NonNullable<
  Awaited<ReturnType<typeof leerRecordatorioParaEnviar>>
>;

function delReclamo(r: RecordatorioReclamado) {
  return {
    id: r.id,
    organizationId: r.organizationId,
    status: "PENDING" as const,
    attempts: r.attempts,
  };
}

export function marcarEnviado(
  r: RecordatorioReclamado,
  datos: { sentAt: Date; externalMessageId: string | null },
  db: Db = prisma,
) {
  return db.bookingMessage.updateMany({
    where: delReclamo(r),
    data: {
      status: "SENT",
      sentAt: datos.sentAt,
      externalMessageId: datos.externalMessageId,
      lastError: null,
    },
  });
}

export function marcarCancelado(r: RecordatorioReclamado, motivo: string, db: Db = prisma) {
  return db.bookingMessage.updateMany({
    where: delReclamo(r),
    data: { status: "CANCELLED", lastError: mensajeDeError(motivo) },
  });
}

export function marcarFallido(r: RecordatorioReclamado, motivo: string, db: Db = prisma) {
  return db.bookingMessage.updateMany({
    where: delReclamo(r),
    data: { status: "FAILED", lastError: mensajeDeError(motivo) },
  });
}

export function reprogramarIntento(
  r: RecordatorioReclamado,
  datos: { nextAttemptAt: Date; motivo: string },
  db: Db = prisma,
) {
  return db.bookingMessage.updateMany({
    where: delReclamo(r),
    data: { nextAttemptAt: datos.nextAttemptAt, lastError: mensajeDeError(datos.motivo) },
  });
}

/**
 * La respuesta por botón, con CAS: solo un mensaje SENT, de esta organización,
 * sin respuesta todavía. Devuelve la fila si la marcó (null = no es la
 * respuesta a un recordatorio, o ya se había respondido).
 */
export async function marcarRespuesta(
  organizationId: string,
  contextWamid: string,
  respuesta: BookingMessageResponse,
  entranteWamid: string,
  cuando: Date,
  db: Db = prisma,
) {
  const { count } = await db.bookingMessage.updateMany({
    where: {
      organizationId,
      externalMessageId: contextWamid,
      status: "SENT",
      respondedAt: null,
    },
    data: { response: respuesta, respondedAt: cuando, responseExternalId: entranteWamid },
  });
  if (count === 0) return null;
  return db.bookingMessage.findFirst({
    where: { organizationId, externalMessageId: contextWamid },
  });
}

/** El recordatorio que respondió este entrante (por su wamid). */
export function recordatorioRespondidoPor(
  organizationId: string,
  entranteWamid: string,
  db: Db = prisma,
) {
  return db.bookingMessage.findFirst({
    where: { organizationId, responseExternalId: entranteWamid },
    include: {
      booking: {
        select: {
          id: true,
          status: true,
          startsAt: true,
          branchId: true,
          contactId: true,
          patientConfirmedAt: true,
          branch: { select: { timezone: true } },
        },
      },
      contact: { select: { firstName: true, lastName: true } },
    },
  });
}

/** Los SENT sin respuesta ni tarea, enviados antes de `hasta` (la barrida de
 *  §6.5 elige cuáles ya vencieron). */
export function sinRespuestaCandidatos(hasta: Date, limite: number, organizationId?: string) {
  return prisma.bookingMessage.findMany({
    where: {
      status: "SENT",
      respondedAt: null,
      noResponseTaskAt: null,
      sentAt: { lte: hasta },
      ...(organizationId ? { organizationId } : {}),
    },
    orderBy: { sentAt: "asc" },
    take: limite,
    include: {
      booking: {
        select: {
          status: true,
          startsAt: true,
          branchId: true,
          patientConfirmedAt: true,
          branch: { select: { timezone: true } },
        },
      },
      contact: { select: { firstName: true, lastName: true } },
    },
  });
}

/** Marca la tarea "sin respuesta" como hecha, con CAS: a lo sumo una. */
export async function marcarTareaSinRespuesta(id: string, cuando: Date, db: Db = prisma) {
  const { count } = await db.bookingMessage.updateMany({
    where: { id, noResponseTaskAt: null },
    data: { noResponseTaskAt: cuando },
  });
  return count === 1;
}

/** Si `contextWamid` es un recordatorio enviado de esta organización que
 *  todavía no se respondió (la lectura del webhook antes de encolar). */
export async function esRecordatorioSinResponder(
  organizationId: string,
  contextWamid: string,
  db: Db = prisma,
): Promise<boolean> {
  const fila = await db.bookingMessage.findFirst({
    where: { organizationId, externalMessageId: contextWamid, status: "SENT", respondedAt: null },
    select: { id: true },
  });
  return fila !== null;
}
