import { Prisma } from "@prisma/client";
import { logger } from "../../lib/logger";
import { createActivity } from "../../repositories/activity.repository";
import { vencimientoAlFinDelDia } from "../../utils/timezone";
import { asuntoConElVehiculo, asuntoDeLaTarea, textoDelVehiculo } from "./config";
import { asignadoDeLaTarea, leerAvisoParaLaTarea } from "./repository";

// ---------------------------------------------------------------------------
// La tarea "Llamar a {cliente} por el service de {vehiculo}" (docs/servicios.md
// §6.3, S7). La crean la acción activity.create_follow_up con este trigger y el
// recordatorio por WhatsApp cuando el cliente no tiene WhatsApp (D8).
//
// Una sola tarea por aviso: activities.source_notice_id con el índice único
// parcial activities_tarea_por_aviso_key. Si ya existe, no se crea otra.
// ---------------------------------------------------------------------------

export interface TareaDelAviso {
  organizationId: string;
  automationId: string;
  noticeId: string;
  // Sin asunto, el de §6.3.
  subject?: string;
  daysUntilDue?: number;
  notes?: string;
  ahora?: Date;
}

export type ResultadoDeLaTarea = "CREADA" | "YA_EXISTIA" | "SIN_AVISO" | "SIN_ASIGNADO";

export async function crearTareaDelAviso(t: TareaDelAviso): Promise<ResultadoDeLaTarea> {
  const aviso = await leerAvisoParaLaTarea(t.organizationId, t.noticeId);
  if (!aviso) return "SIN_AVISO";
  const v = aviso.customerVehicle;
  const asignado = await asignadoDeLaTarea(t.organizationId, v.id, v.branchId);
  if (!asignado) {
    logger.warn(
      { organizationId: t.organizationId, noticeId: t.noticeId },
      "Próximo service: no hay a quién asignar la tarea (sin encargado, responsable ni ADMIN activo)",
    );
    return "SIN_ASIGNADO";
  }
  const cliente = `${v.contact.firstName} ${v.contact.lastName}`.trim() || "el cliente";
  const vence = vencimientoAlFinDelDia(
    t.ahora ?? new Date(),
    aviso.organization.timezone,
    t.daysUntilDue ?? 0,
  );
  try {
    await createActivity({
      organizationId: t.organizationId,
      type: "TASK",
      authorId: asignado,
      assigneeId: asignado,
      companyId: null,
      contactId: v.contactId,
      opportunityId: null,
      subject: t.subject?.trim()
        ? asuntoConElVehiculo(t.subject.trim(), textoDelVehiculo(v))
        : asuntoDeLaTarea(cliente, textoDelVehiculo(v)),
      ...(t.notes ? { body: t.notes } : {}),
      dueDate: vence,
      sourceNoticeId: t.noticeId,
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
