import { Prisma } from "@prisma/client";
import { logger } from "../../lib/logger";
import { prisma } from "../../lib/prisma";
import { createActivity as createActivityRepo } from "../../repositories/activity.repository";
import { asignadoParaLaSede } from "../services/reprogramar.service";

// ---------------------------------------------------------------------------
// La tarea después del turno de una clínica (docs/rubros.md §7.3): la acción
// activity.create_follow_up colgada de booking.completed. La acción vive en el
// núcleo (services/automationActions/createFollowUpActivity.ts) y delega acá
// cuando el evento es de un turno.
//
// - Una tarea por regla y por turno: el índice único parcial
//   activities_follow_up_por_turno_key. Cada corrección de "No vino" a
//   "Atendido" emite otro booking.completed; el segundo choca con el índice.
// - La tarea va a la recepción de la sede del turno (§11.4), con el mismo
//   criterio que las demás tareas de clínica (asignadoParaLaSede): autor y
//   asignado son la misma persona, porque no hay "usuario sistema".
// - Vence a N días desde que el turno se marcó atendido (completedAt).
// - Si el turno se corrige a "No vino", la tarea abierta se cierra sola con una
//   nota; si después vuelve a "Atendido", se reabre.
// - Sin datos de salud: el asunto y las notas son los de la regla.
// ---------------------------------------------------------------------------

export const NOTA_CERRADA_POR_NO_VINO = "Se cerró sola: el turno se corrigió a «No vino».";
export const NOTA_REABIERTA = "Se reabrió: el turno se corrigió a «Atendido».";

export interface TareaDespuesDelTurno {
  organizationId: string;
  automationId: string;
  bookingId: string;
  subject: string;
  daysUntilDue: number;
  notes?: string;
}

function sumarDias(desde: Date, dias: number): Date {
  const fecha = new Date(desde);
  fecha.setUTCDate(fecha.getUTCDate() + dias);
  return fecha;
}

function conNota(body: string | null, nota: string): string {
  return body ? `${body}\n\n${nota}` : nota;
}

export type ResultadoDeLaTarea = "CREADA" | "REABIERTA" | "YA_EXISTIA" | "OMITIDA";

export async function crearTareaDespuesDelTurno(
  t: TareaDespuesDelTurno,
): Promise<ResultadoDeLaTarea> {
  const turno = await prisma.booking.findFirst({
    where: { id: t.bookingId, organizationId: t.organizationId },
    select: { id: true, status: true, branchId: true, contactId: true, completedAt: true },
  });
  // Ya no está atendido (lo corrigieron a "No vino" antes del despacho): nada.
  if (!turno || turno.status !== "COMPLETED") return "OMITIDA";

  const existente = await prisma.activity.findFirst({
    where: {
      organizationId: t.organizationId,
      sourceAutomationId: t.automationId,
      sourceBookingId: t.bookingId,
    },
    select: { id: true, completedAt: true, body: true },
  });
  if (existente) return reabrir(t.organizationId, existente);

  const asignado = await asignadoParaLaSede(t.organizationId, turno.branchId);
  if (!asignado) {
    logger.warn(
      { organizationId: t.organizationId, bookingId: t.bookingId },
      "Tarea después del turno: la sede no tiene a quién asignarla",
    );
    return "OMITIDA";
  }
  try {
    await createActivityRepo({
      organizationId: t.organizationId,
      type: "TASK",
      authorId: asignado,
      assigneeId: asignado,
      companyId: null,
      contactId: turno.contactId,
      opportunityId: null,
      branchId: turno.branchId,
      subject: t.subject,
      ...(t.notes === undefined ? {} : { body: t.notes }),
      dueDate: sumarDias(turno.completedAt ?? new Date(), t.daysUntilDue),
      sourceBookingId: t.bookingId,
      sourceAutomationId: t.automationId,
    });
    return "CREADA";
  } catch (err) {
    // Otro despacho del mismo turno la creó entre la lectura y el INSERT.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return "YA_EXISTIA";
    }
    throw err;
  }
}

async function reabrir(
  organizationId: string,
  existente: { id: string; completedAt: Date | null; body: string | null },
): Promise<ResultadoDeLaTarea> {
  if (existente.completedAt === null) return "YA_EXISTIA";
  await prisma.activity.updateMany({
    where: { id: existente.id, organizationId, completedAt: { not: null } },
    data: { completedAt: null, body: conNota(existente.body, NOTA_REABIERTA) },
  });
  return "REABIERTA";
}

/** "No vino": las tareas abiertas que creó el turno se cierran con una nota. */
export async function cerrarTareasDelTurno(
  organizationId: string,
  bookingId: string,
  ahora: Date = new Date(),
): Promise<number> {
  const abiertas = await prisma.activity.findMany({
    where: { organizationId, sourceBookingId: bookingId, completedAt: null, deletedAt: null },
    select: { id: true, body: true },
  });
  for (const a of abiertas) {
    await prisma.activity.updateMany({
      where: { id: a.id, organizationId, completedAt: null },
      data: { completedAt: ahora, body: conNota(a.body, NOTA_CERRADA_POR_NO_VINO) },
    });
  }
  return abiertas.length;
}
