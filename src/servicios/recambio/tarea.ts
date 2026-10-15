import { Prisma } from "@prisma/client";
import { logger } from "../../lib/logger";
import { prisma, type Db } from "../../lib/prisma";
import { createActivity } from "../../repositories/activity.repository";
import { findZonaDeLaOrganizacion } from "../../repositories/organization.repository";
import { findOldestActiveAdmin } from "../../repositories/user.repository";
import { vencimientoAlFinDelDia } from "../../utils/timezone";
import { textoDelVehiculo } from "../recordatorio/config";
import { asuntoDelRecambio } from "./config";

// ---------------------------------------------------------------------------
// La tarea del recambio (docs/servicios.md §7.3, S13). Es un aviso PARA
// VENTAS, no para el taller. A quién va (D13):
//
//   1. al vendedor del contacto;
//   2. si no tiene, al vendedor de la venta de origen del vehículo;
//   3. si no, al responsable por defecto de la sucursal;
//   4. si no, al ADMIN activo más antiguo.
//
// La crean la acción "Crear actividad de seguimiento" con el evento de
// recambio (una por aviso: activities.source_notice_id, único de S6) y
// "Crear tarea al vendedor" de la lista de vencidos.
// ---------------------------------------------------------------------------

export type ResultadoDeLaTareaDelRecambio =
  "CREADA" | "YA_EXISTIA" | "SIN_VEHICULO" | "SIN_ASIGNADO";

const activo = (u: { isActive: boolean; deletedAt: Date | null } | null) =>
  u !== null && u.isActive && u.deletedAt === null;

export async function crearTareaDelRecambio(
  t: {
    organizationId: string;
    customerVehicleId: string;
    noticeId: string;
    automationId?: string | null;
    // Sin título, el de §7.3.
    subject?: string;
    daysUntilDue?: number;
    notes?: string;
    ahora?: Date;
  },
  db: Db = prisma,
): Promise<ResultadoDeLaTareaDelRecambio> {
  const estado = { isActive: true, deletedAt: true } as const;
  const v = await db.customerVehicle.findFirst({
    where: { id: t.customerVehicleId, organizationId: t.organizationId },
    select: {
      make: true,
      model: true,
      licensePlate: true,
      purchasedOn: true,
      contactId: true,
      contact: {
        select: { firstName: true, lastName: true, ownerId: true, owner: { select: estado } },
      },
      sourceOpportunity: { select: { ownerId: true, owner: { select: estado } } },
      branch: { select: { defaultOwnerId: true, defaultOwner: { select: estado } } },
    },
  });
  if (!v) return "SIN_VEHICULO";

  const asignado =
    (activo(v.contact.owner) ? v.contact.ownerId : null) ??
    (v.sourceOpportunity && activo(v.sourceOpportunity.owner)
      ? v.sourceOpportunity.ownerId
      : null) ??
    (v.branch && activo(v.branch.defaultOwner) ? v.branch.defaultOwnerId : null) ??
    (await findOldestActiveAdmin(t.organizationId, db))?.id ??
    null;
  if (!asignado) {
    logger.warn(
      { organizationId: t.organizationId, customerVehicleId: t.customerVehicleId },
      "Recambio: no hay a quién asignar la tarea (sin vendedor, responsable ni ADMIN activo)",
    );
    return "SIN_ASIGNADO";
  }

  const cliente = `${v.contact.firstName} ${v.contact.lastName}`.trim() || "el cliente";
  const zona = await findZonaDeLaOrganizacion(t.organizationId, db);
  try {
    await createActivity(
      {
        organizationId: t.organizationId,
        type: "TASK",
        authorId: asignado,
        assigneeId: asignado,
        companyId: null,
        contactId: v.contactId,
        opportunityId: null,
        subject:
          t.subject?.trim() ||
          asuntoDelRecambio(cliente, textoDelVehiculo(v), v.purchasedOn ?? new Date()),
        ...(t.notes ? { body: t.notes } : {}),
        dueDate: vencimientoAlFinDelDia(t.ahora ?? new Date(), zona, t.daysUntilDue ?? 0),
        sourceNoticeId: t.noticeId,
        sourceAutomationId: t.automationId ?? null,
      },
      db,
    );
    return "CREADA";
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return "YA_EXISTIA";
    }
    throw err;
  }
}
