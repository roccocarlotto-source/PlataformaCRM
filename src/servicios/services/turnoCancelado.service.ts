import { logger } from "../../lib/logger";
import { prisma } from "../../lib/prisma";
import { createActivity } from "../../repositories/activity.repository";
import { formatearNumeroDeOrden } from "../identificadores";
import { ESTADOS_ABIERTOS } from "../config/estados";

// ---------------------------------------------------------------------------
// UN TURNO CANCELADO CON UNA ORDEN DEL TALLER (NEG-EST-5 de
// docs-privados/auditoria-2026-10-21, local; decisión de Rocco del 30/10).
//
// La orden no cambia sola: sigue Agendada, y la ficha y el resumen del taller
// ya muestran el turno cancelado. Lo que se suma es una tarea para el
// encargado de la orden, pero SOLO si el turno lo canceló otra persona (el
// cliente por el agente, otro usuario, una automatización): si lo canceló el
// propio encargado, ya lo sabe.
//
// Best-effort: se llama después de cancelar, y si falla queda el log; la
// cancelación ya está hecha.
// ---------------------------------------------------------------------------

export async function avisarOrdenDelTurnoCancelado(
  organizationId: string,
  turno: { id: string; startsAt: Date },
  quienCancela: string | undefined,
): Promise<"CREADA" | "SIN_ORDEN" | "LO_CANCELO_EL_ENCARGADO" | "SIN_ENCARGADO" | "NO_SE_PUDO"> {
  try {
    const orden = await prisma.serviceOrder.findFirst({
      where: { organizationId, bookingId: turno.id, status: { in: [...ESTADOS_ABIERTOS] } },
      select: {
        number: true,
        assigneeId: true,
        contactId: true,
        assignee: { select: { isActive: true, deletedAt: true } },
      },
    });
    if (!orden) return "SIN_ORDEN";
    if (!orden.assigneeId || !orden.assignee?.isActive || orden.assignee.deletedAt) {
      return "SIN_ENCARGADO";
    }
    if (orden.assigneeId === quienCancela) return "LO_CANCELO_EL_ENCARGADO";

    const numero = formatearNumeroDeOrden(orden.number);
    await createActivity({
      organizationId,
      type: "TASK",
      authorId: orden.assigneeId,
      assigneeId: orden.assigneeId,
      companyId: null,
      contactId: orden.contactId,
      opportunityId: null,
      subject: `Turno cancelado: la orden ${numero} sigue agendada`,
      body: "El turno vinculado a esta orden se canceló. La orden no cambió: reprogramala con otro turno, desvinculalo o cancelala.",
      dueDate: new Date(),
    });
    return "CREADA";
  } catch (err) {
    logger.error(
      { err, organizationId, bookingId: turno.id },
      "No se pudo avisar al encargado de la orden de un turno cancelado",
    );
    return "NO_SE_PUDO";
  }
}
