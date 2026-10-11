import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { Db } from "../../lib/prisma";
import { findEdicionYRubro } from "../../repositories/organization.repository";
import { emitOutboxEvent } from "../../repositories/outboxEvent.repository";
import {
  registroDeHandlers as handlersPorDefecto,
  type RegistroDeHandlers,
} from "../../services/outboxHandlers";
import { alCancelarse, alProgramarse, alNoVenir } from "../recordatorios/programacion.service";

// ---------------------------------------------------------------------------
// Los eventos del turno de una clínica (docs/rubros.md §4.8, R10). SOLO
// CLÍNICAS: un turno de una automotora no emite nada, como siempre.
//
// Se emiten desde los servicios únicos de turnos (agendar, cancelar,
// reprogramar, marcar atendido o no vino, el cierre automático), DENTRO de la
// misma transacción que el cambio: si el cambio no se confirma, el evento
// tampoco. Un cambio que no ocurre (marcar dos veces lo mismo) no emite nada.
// Lo que se detecta desde Google en una clínica (D16) no emite: solo crea la
// tarea, hasta que Recepción lo resuelva.
//
// CADA EVENTO lleva un `eventoId` único. LOS CONSUMIDORES (R13–R15 y las
// automatizaciones) TIENEN QUE SER IDEMPOTENTES POR TURNO: una corrección
// (esCorreccion: true) o un cierre automático (automatico: true) no tienen que
// reenviar un mensaje que ya salió.
//
// R13 suma el recordatorio (created/rescheduled/cancelled,
// src/clinicas/recordatorios) y R14 el después del turno (completed como
// trigger del motor, no_show cancela lo pendiente).
// ---------------------------------------------------------------------------

export const EVENTO_TURNO_CREADO = "booking.created";
export const EVENTO_TURNO_CANCELADO = "booking.cancelled";
export const EVENTO_TURNO_REPROGRAMADO = "booking.rescheduled";
export const EVENTO_TURNO_ATENDIDO = "booking.completed";
export const EVENTO_TURNO_NO_VINO = "booking.no_show";

export const EVENTOS_DE_TURNO = [
  EVENTO_TURNO_CREADO,
  EVENTO_TURNO_CANCELADO,
  EVENTO_TURNO_REPROGRAMADO,
  EVENTO_TURNO_ATENDIDO,
  EVENTO_TURNO_NO_VINO,
] as const;

export type EventoDeTurno = (typeof EVENTOS_DE_TURNO)[number];

export interface TurnoDelEvento {
  id: string;
  organizationId: string;
  branchId: string;
  contactId: string;
  resourceId: string;
  serviceTypeId: string;
  startsAt: Date;
  endsAt: Date;
  status: string;
}

export async function esClinica(organizationId: string, db: Db): Promise<boolean> {
  return (await findEdicionYRubro(organizationId, db)).industry === "CLINICA";
}

/** Emite el evento, dentro de la transacción del cambio. Quien llama ya sabe
 *  que es una clínica (esClinica). */
export async function emitirEventoDeTurno(
  tx: Prisma.TransactionClient,
  tipo: EventoDeTurno,
  turno: TurnoDelEvento,
  extra: Record<string, Prisma.InputJsonValue | null> = {},
): Promise<void> {
  await emitOutboxEvent(
    {
      organizationId: turno.organizationId,
      eventType: tipo,
      payload: {
        eventoId: randomUUID(),
        bookingId: turno.id,
        branchId: turno.branchId,
        contactId: turno.contactId,
        resourceId: turno.resourceId,
        serviceTypeId: turno.serviceTypeId,
        startsAt: turno.startsAt.toISOString(),
        endsAt: turno.endsAt.toISOString(),
        status: turno.status,
        ...extra,
      },
    },
    tx,
  );
}

/**
 * Registra los consumidores de los eventos de turno que no son triggers del
 * motor:
 *   - R13 (docs/rubros.md §6.2): created y rescheduled programan el
 *     recordatorio, cancelled lo anula;
 *   - R14 (§7): no_show (también una corrección a No vino) cancela el QR y el
 *     control pendientes del turno.
 * booking.completed es un trigger del motor (R14): lo registra
 * registrarAutomatizaciones, que lo despacha a las acciones de post_turno.
 */
export function registrarEventosDeTurno(handlers: RegistroDeHandlers = handlersPorDefecto): void {
  handlers.registrar(EVENTO_TURNO_CREADO, alProgramarse);
  handlers.registrar(EVENTO_TURNO_REPROGRAMADO, alProgramarse);
  handlers.registrar(EVENTO_TURNO_CANCELADO, alCancelarse);
  handlers.registrar(EVENTO_TURNO_NO_VINO, alNoVenir);
}
