import { Prisma } from "@prisma/client";
import { logger } from "../../lib/logger";
import { prisma } from "../../lib/prisma";
import { createActivity } from "../../repositories/activity.repository";
import { findZonaDeLaOrganizacion } from "../../repositories/organization.repository";
import { findOldestActiveAdmin } from "../../repositories/user.repository";
import { vencimientoAlFinDelDia } from "../../utils/timezone";

// ---------------------------------------------------------------------------
// La tarea de una orden de servicio (docs/servicios.md §9, S8). La crea la
// acción activity.create_follow_up con un evento de la orden
// (service_order.status_changed o service_order.delivered).
//
// A quién va: el encargado de la orden; si no tiene (o ya no está activo), el
// responsable por defecto de su sucursal; y si tampoco, el ADMIN activo más
// antiguo (decisión 2 de S8: como la tarea del recordatorio, nunca sin dueño).
//
// UNA tarea por (regla, orden): activities_tarea_por_orden_key, único parcial
// de S6. Si la orden vuelve a un estado de la regla, o el evento se reentrega,
// no se crea otra.
// ---------------------------------------------------------------------------

export type ResultadoDeLaTareaDeLaOrden = "CREADA" | "YA_EXISTIA" | "SIN_ORDEN" | "SIN_ASIGNADO";

export async function crearTareaDeLaOrden(t: {
  organizationId: string;
  automationId: string;
  serviceOrderId: string;
  subject: string;
  daysUntilDue: number;
  notes?: string;
  ahora?: Date;
}): Promise<ResultadoDeLaTareaDeLaOrden> {
  const estado = { isActive: true, deletedAt: true } as const;
  const orden = await prisma.serviceOrder.findFirst({
    where: { id: t.serviceOrderId, organizationId: t.organizationId },
    select: {
      contactId: true,
      branchId: true,
      assigneeId: true,
      assignee: { select: estado },
      branch: { select: { defaultOwnerId: true, defaultOwner: { select: estado } } },
    },
  });
  if (!orden) return "SIN_ORDEN";

  const encargadoActivo =
    orden.assigneeId && orden.assignee?.isActive && orden.assignee.deletedAt === null
      ? orden.assigneeId
      : null;
  const responsableActivo =
    orden.branch.defaultOwnerId &&
    orden.branch.defaultOwner?.isActive &&
    orden.branch.defaultOwner.deletedAt === null
      ? orden.branch.defaultOwnerId
      : null;
  const asignado =
    encargadoActivo ??
    responsableActivo ??
    (await findOldestActiveAdmin(t.organizationId))?.id ??
    null;
  if (!asignado) {
    logger.warn(
      { organizationId: t.organizationId, serviceOrderId: t.serviceOrderId },
      "Tarea de la orden: no hay a quién asignarla (sin encargado, responsable ni ADMIN activo)",
    );
    return "SIN_ASIGNADO";
  }

  const zona = await findZonaDeLaOrganizacion(t.organizationId);
  try {
    await createActivity({
      organizationId: t.organizationId,
      type: "TASK",
      authorId: asignado,
      assigneeId: asignado,
      companyId: null,
      contactId: orden.contactId,
      opportunityId: null,
      subject: t.subject,
      ...(t.notes ? { body: t.notes } : {}),
      dueDate: vencimientoAlFinDelDia(t.ahora ?? new Date(), zona, t.daysUntilDue),
      sourceServiceOrderId: t.serviceOrderId,
      sourceAutomationId: t.automationId,
    });
    return "CREADA";
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return "YA_EXISTIA";
    }
    throw err;
  }
}
