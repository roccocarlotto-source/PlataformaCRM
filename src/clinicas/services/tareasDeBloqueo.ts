import { z } from "zod";
import { logger } from "../../lib/logger";
import { prisma, type Db } from "../../lib/prisma";
import { findBloqueosQueSeSuperponen } from "../repositories/bloqueos.repository";

// ---------------------------------------------------------------------------
// Las tareas "Turno dentro de un bloqueo" (bloqueos.service.ts): cuándo se
// cierran solas (ISSUE-027 de la QA de la primera clínica).
//
// Cada tarea cuelga de su turno (source_booking_id, sin regla: la regla es de
// la tarea después del turno). Se cierra, con una nota, cuando ya no hay nada
// que hacer:
//   - se quitó el bloqueo y el turno no queda dentro de otro;
//   - el turno se canceló;
//   - el turno se reprogramó a un horario fuera de todo bloqueo.
// Una tarea ya completada (o borrada) no se toca: quien la cerró a mano ya la
// resolvió.
// ---------------------------------------------------------------------------

export const PREFIJO_TAREA_DE_BLOQUEO = "Turno dentro de un bloqueo: ";

export const NOTA_BLOQUEO_QUITADO = "Se cerró sola: se quitó el bloqueo.";
export const NOTA_TURNO_CANCELADO = "Se cerró sola: el turno se canceló.";
export const NOTA_TURNO_REPROGRAMADO = "Se cerró sola: el turno se reprogramó fuera del bloqueo.";

function conNota(body: string | null, nota: string): string {
  return body ? `${body}\n\n${nota}` : nota;
}

/** Cierra las tareas de bloqueo abiertas de esos turnos, con la nota. Devuelve
 *  cuántas cerró. */
export async function cerrarTareasDeBloqueo(
  organizationId: string,
  bookingIds: readonly string[],
  nota: string,
  db: Db = prisma,
  ahora: Date = new Date(),
): Promise<number> {
  if (bookingIds.length === 0) return 0;
  const abiertas = await db.activity.findMany({
    where: {
      organizationId,
      sourceBookingId: { in: [...bookingIds] },
      sourceAutomationId: null,
      subject: { startsWith: PREFIJO_TAREA_DE_BLOQUEO },
      completedAt: null,
      deletedAt: null,
    },
    select: { id: true, body: true },
  });
  let cerradas = 0;
  for (const tarea of abiertas) {
    // Con completedAt null en el WHERE: si alguien la cerró entre la lectura y
    // acá, no se pisa su cierre.
    const { count } = await db.activity.updateMany({
      where: { id: tarea.id, organizationId, completedAt: null },
      data: { completedAt: ahora, body: conNota(tarea.body, nota) },
    });
    cerradas += count;
  }
  return cerradas;
}

/** De esos turnos del profesional, los que no quedan dentro de ningún bloqueo. */
export async function turnosFueraDeBloqueos(
  organizationId: string,
  resourceId: string,
  turnos: readonly { id: string; startsAt: Date; endsAt: Date }[],
  db: Db = prisma,
): Promise<string[]> {
  const fuera: string[] = [];
  for (const turno of turnos) {
    const bloqueos = await findBloqueosQueSeSuperponen(
      organizationId,
      resourceId,
      turno.startsAt,
      turno.endsAt,
      db,
    );
    if (bloqueos.length === 0) fuera.push(turno.id);
  }
  return fuera;
}

const payloadSchema = z.object({
  bookingId: z.string(),
  resourceId: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
});

/** Consumidor de booking.cancelled. */
export async function alCancelarseCerrarTareasDeBloqueo(evento: {
  organizationId: string;
  payload: unknown;
}): Promise<void> {
  const { bookingId } = payloadSchema.parse(evento.payload);
  const cerradas = await cerrarTareasDeBloqueo(
    evento.organizationId,
    [bookingId],
    NOTA_TURNO_CANCELADO,
  );
  if (cerradas > 0) {
    logger.debug(
      { organizationId: evento.organizationId, bookingId, cerradas },
      "Turno cancelado: tareas de bloqueo cerradas",
    );
  }
}

/** Consumidor de booking.rescheduled: el payload trae el horario nuevo. */
export async function alReprogramarseCerrarTareasDeBloqueo(evento: {
  organizationId: string;
  payload: unknown;
}): Promise<void> {
  const p = payloadSchema.parse(evento.payload);
  const fuera = await turnosFueraDeBloqueos(evento.organizationId, p.resourceId, [
    { id: p.bookingId, startsAt: new Date(p.startsAt), endsAt: new Date(p.endsAt) },
  ]);
  const cerradas = await cerrarTareasDeBloqueo(
    evento.organizationId,
    fuera,
    NOTA_TURNO_REPROGRAMADO,
  );
  if (cerradas > 0) {
    logger.debug(
      { organizationId: evento.organizationId, bookingId: p.bookingId, cerradas },
      "Turno reprogramado fuera del bloqueo: tareas de bloqueo cerradas",
    );
  }
}
