import { z } from "zod";
import { logger } from "../../lib/logger";
import { prisma, type Db } from "../../lib/prisma";
import { modulosDe } from "../../config/ediciones";
import { leerConfiguracionDeSede } from "../repositories/clinicSettings.repository";
import {
  MOTIVO_TURNO_CANCELADO,
  MOTIVO_TURNO_REPROGRAMADO,
  TRIGGER_BOOKING_REMINDER_DUE,
  cuandoSaleElRecordatorio,
} from "./config";
import { agendarRecordatorio, cancelarPendientesDelTurno } from "./repository";

// ---------------------------------------------------------------------------
// Programar, recalcular y anular el recordatorio de un turno (docs/rubros.md
// §6.2, R13). Lo llaman los consumidores de los eventos de turno de R10
// (registrarEventosDeTurno):
//
//   booking.created      programa el recordatorio;
//   booking.rescheduled  cancela el pendiente del horario viejo y programa el
//                        del nuevo;
//   booking.cancelled    anula los pendientes;
//   booking.completed / booking.no_show: nada.
//
// IDEMPOTENTE POR TURNO Y POR HORARIO: el evento se puede reentregar, y una
// corrección (esCorreccion) o un cierre automático no reenvían nada. El UNIQUE
// parcial de booking_messages hace que la segunda entrega no agende otro, y
// releer el turno hace que un evento viejo no reprograme un horario que ya
// cambió. Se calcula con la configuración VIGENTE de la sede: cambiarla no
// recalcula lo ya agendado.
//
// Solo con la regla "Recordatorio antes del turno" activa, y solo en una
// organización con el módulo recordatorios_de_turno (una clínica).
// ---------------------------------------------------------------------------

export const payloadDelTurnoSchema = z.object({
  bookingId: z.string().uuid(),
});

/** La regla activa del recordatorio de la organización, o null. */
export async function reglaDelRecordatorio(organizationId: string, db: Db = prisma) {
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { edition: true, industry: true },
  });
  if (!org || !modulosDe(org.edition, org.industry).has("recordatorios_de_turno")) return null;
  return db.automation.findFirst({
    where: {
      organizationId,
      triggerType: TRIGGER_BOOKING_REMINDER_DUE,
      isActive: true,
      deletedAt: null,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true },
  });
}

export type ResultadoDeProgramacion =
  "AGENDADO" | "YA_ESTABA" | "SIN_REGLA" | "NO_CORRESPONDE" | "TURNO_NO_VIGENTE";

/**
 * Programa el recordatorio del horario ACTUAL del turno y cancela los
 * pendientes de cualquier otro horario. Sirve para created y rescheduled.
 */
export async function programarRecordatorio(
  organizationId: string,
  bookingId: string,
  ahora: Date = new Date(),
  db: Db = prisma,
): Promise<ResultadoDeProgramacion> {
  const turno = await db.booking.findFirst({
    where: { id: bookingId, organizationId },
    select: { id: true, status: true, startsAt: true, branchId: true, contactId: true },
  });
  if (!turno || turno.status !== "CONFIRMED") {
    if (turno)
      await cancelarPendientesDelTurno(organizationId, bookingId, MOTIVO_TURNO_CANCELADO, db);
    return "TURNO_NO_VIGENTE";
  }
  // Lo del horario viejo no sale: el paciente recibiría un turno que ya no es.
  await cancelarPendientesDelTurno(
    organizationId,
    bookingId,
    MOTIVO_TURNO_REPROGRAMADO,
    db,
    turno.startsAt,
  );

  const regla = await reglaDelRecordatorio(organizationId, db);
  if (!regla) return "SIN_REGLA";

  const config = await leerConfiguracionDeSede(organizationId, turno.branchId, db);
  const cuando = cuandoSaleElRecordatorio(turno.startsAt, ahora, config);
  if (!cuando) return "NO_CORRESPONDE";

  const agendado = await agendarRecordatorio(
    {
      organizationId,
      bookingId,
      contactId: turno.contactId,
      automationId: regla.id,
      bookingStartsAt: turno.startsAt,
      scheduledFor: cuando,
    },
    db,
  );
  return agendado ? "AGENDADO" : "YA_ESTABA";
}

export async function anularRecordatorios(
  organizationId: string,
  bookingId: string,
  db: Db = prisma,
) {
  const { count } = await cancelarPendientesDelTurno(
    organizationId,
    bookingId,
    MOTIVO_TURNO_CANCELADO,
    db,
  );
  return count;
}

/** El consumidor de booking.created y booking.rescheduled. */
export async function alProgramarse(evento: { organizationId: string; payload: unknown }) {
  const { bookingId } = payloadDelTurnoSchema.parse(evento.payload);
  const resultado = await programarRecordatorio(evento.organizationId, bookingId);
  logger.debug(
    { organizationId: evento.organizationId, bookingId, resultado },
    "Recordatorio del turno: programación",
  );
}

/** El consumidor de booking.cancelled. */
export async function alCancelarse(evento: { organizationId: string; payload: unknown }) {
  const { bookingId } = payloadDelTurnoSchema.parse(evento.payload);
  const anulados = await anularRecordatorios(evento.organizationId, bookingId);
  logger.debug(
    { organizationId: evento.organizationId, bookingId, anulados },
    "Recordatorio del turno: anulado",
  );
}
