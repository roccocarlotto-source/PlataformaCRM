import { Prisma } from "@prisma/client";
import { prisma, type Db } from "../../lib/prisma";
import { ESTADOS_ABIERTOS } from "../config/estados";

// ---------------------------------------------------------------------------
// El recordatorio del próximo service (docs/servicios.md §6.2 y §6.3, S7):
// lo que lee el barrido, el registro de avisos (customer_vehicle_notices) y la
// cola de envío (service_messages), con el patrón de booking_messages
// (reclamar con lease, marcar con CAS sobre attempts, posponer sin gastar el
// intento).
// ---------------------------------------------------------------------------

const LARGO_DEL_ERROR = 500;
const LARGO_DEL_MOTIVO = 200;

/** last_error sin datos de más y cortado (como en booking_messages). */
export function mensajeDeError(motivo: string): string {
  return motivo.slice(0, LARGO_DEL_ERROR);
}

// --- Barrido ---------------------------------------------------------------

/** Los vehículos que le tocan a una regla hoy (§6.2): fecha de service en la
 *  ventana, vigentes, sin "no recordar", con el cliente vigente y sin "sin
 *  interés", y sin una orden abierta (§6.5). Los ya avisados por esta regla
 *  para esa fecha se descartan aparte (avisosDeLaRegla). Usa el índice
 *  customer_vehicles_next_service_idx. */
export function candidatosDelBarrido(
  organizationId: string,
  desde: Date,
  hasta: Date,
  db: Db = prisma,
) {
  return db.customerVehicle.findMany({
    where: {
      organizationId,
      deletedAt: null,
      ownershipEndedAt: null,
      remindersOptOut: false,
      nextServiceDueOn: { gte: desde, lte: hasta },
      contact: { deletedAt: null, noInterestAt: null },
      serviceOrders: { none: { status: { in: [...ESTADOS_ABIERTOS] } } },
    },
    select: { id: true, contactId: true, branchId: true, nextServiceDueOn: true },
    orderBy: { id: "asc" },
  });
}

/** Los avisos que esta regla ya dio a estos vehículos (cualquier fecha: el
 *  barrido compara contra la fecha de cada uno). */
export function avisosDeLaRegla(
  organizationId: string,
  automationId: string,
  customerVehicleIds: string[],
  db: Db = prisma,
) {
  return db.customerVehicleNotice.findMany({
    where: {
      organizationId,
      automationId,
      kind: "NEXT_SERVICE",
      source: "AUTOMATICO",
      customerVehicleId: { in: customerVehicleIds },
    },
    select: { customerVehicleId: true, dueOn: true },
  });
}

export function crearAviso(
  data: {
    organizationId: string;
    customerVehicleId: string;
    automationId: string;
    dueOn: Date;
  },
  tx: Prisma.TransactionClient,
) {
  return tx.customerVehicleNotice.create({
    data: { ...data, kind: "NEXT_SERVICE", source: "AUTOMATICO" },
    select: { id: true },
  });
}

/** ¿El módulo Servicios está activado en la organización? */
export async function tieneElModulo(organizationId: string, db: Db = prisma): Promise<boolean> {
  const n = await db.organizationModule.count({
    where: { organizationId, module: "servicios", disabledAt: null },
  });
  return n > 0;
}

// --- Cola -------------------------------------------------------------------

/** Encola el recordatorio de un aviso. Un mensaje vigente por aviso (único
 *  parcial service_messages_vigente_key): si ya hay uno, no hace nada. */
export async function encolarRecordatorio(
  data: {
    organizationId: string;
    automationId: string;
    noticeId: string;
    customerVehicleId: string;
    contactId: string;
    branchId: string | null;
    dueKey: Date;
    ahora: Date;
  },
  db: Db = prisma,
): Promise<"ENCOLADO" | "YA_EXISTIA"> {
  const { ahora, ...resto } = data;
  try {
    await db.serviceMessage.create({
      data: { ...resto, kind: "NEXT_SERVICE", scheduledFor: ahora, nextAttemptAt: ahora },
    });
    return "ENCOLADO";
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return "YA_EXISTIA";
    }
    throw err;
  }
}

export interface MensajeReclamado {
  id: string;
  organizationId: string;
  attempts: number;
}

export async function reclamarMensaje(
  leaseMs: number,
  ahora: Date,
  opciones: { organizationId?: string } = {},
  db: Db = prisma,
): Promise<MensajeReclamado | null> {
  const filtroOrg = opciones.organizationId
    ? Prisma.sql`AND c.organization_id = ${opciones.organizationId}::uuid`
    : Prisma.empty;
  const filas = await db.$queryRaw<{ id: string; organization_id: string; attempts: number }[]>`
    UPDATE service_messages f
    SET attempts = f.attempts + 1,
        next_attempt_at = ${ahora}::timestamp + (${leaseMs}::int * interval '1 millisecond'),
        updated_at = now()
    WHERE f.id = (
      SELECT c.id FROM service_messages c
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

/** Todo lo que el worker relee antes de mandar (la revalidación de §6.3). */
export function leerMensajeParaEnviar(id: string, organizationId: string, db: Db = prisma) {
  return db.serviceMessage.findFirst({
    where: { id, organizationId },
    include: {
      automation: {
        select: { isActive: true, deletedAt: true, actionConfig: true },
      },
      contact: {
        select: {
          firstName: true,
          lastName: true,
          phone: true,
          deletedAt: true,
          noInterestAt: true,
        },
      },
      customerVehicle: {
        select: {
          id: true,
          contactId: true,
          branchId: true,
          make: true,
          model: true,
          licensePlate: true,
          nextServiceDueOn: true,
          remindersOptOut: true,
          ownershipEndedAt: true,
          deletedAt: true,
          branch: { select: { name: true, deletedAt: true } },
          serviceOrders: {
            where: { status: { in: [...ESTADOS_ABIERTOS] } },
            select: { id: true },
            take: 1,
          },
        },
      },
      organization: { select: { name: true } },
    },
  });
}

export type MensajeParaEnviar = NonNullable<Awaited<ReturnType<typeof leerMensajeParaEnviar>>>;

function delReclamo(r: MensajeReclamado) {
  return {
    id: r.id,
    organizationId: r.organizationId,
    status: "PENDING" as const,
    attempts: r.attempts,
  };
}

export function marcarEnviado(
  r: MensajeReclamado,
  datos: { sentAt: Date; externalMessageId: string | null },
  db: Db = prisma,
) {
  return db.serviceMessage.updateMany({
    where: delReclamo(r),
    data: {
      status: "SENT",
      sentAt: datos.sentAt,
      externalMessageId: datos.externalMessageId,
      lastError: null,
    },
  });
}

export function marcarCancelado(r: MensajeReclamado, motivo: string, db: Db = prisma) {
  return db.serviceMessage.updateMany({
    where: delReclamo(r),
    data: {
      status: "CANCELLED",
      cancelReason: motivo.slice(0, LARGO_DEL_MOTIVO),
      lastError: mensajeDeError(motivo),
    },
  });
}

export function marcarFallido(r: MensajeReclamado, motivo: string, db: Db = prisma) {
  return db.serviceMessage.updateMany({
    where: delReclamo(r),
    data: { status: "FAILED", lastError: mensajeDeError(motivo) },
  });
}

export function reprogramarIntento(
  r: MensajeReclamado,
  datos: { nextAttemptAt: Date; motivo: string },
  db: Db = prisma,
) {
  return db.serviceMessage.updateMany({
    where: delReclamo(r),
    data: { nextAttemptAt: datos.nextAttemptAt, lastError: mensajeDeError(datos.motivo) },
  });
}

/** Fuera del horario de la sucursal: se corre sin gastar el intento. */
export function posponerHasta(r: MensajeReclamado, hasta: Date, db: Db = prisma) {
  return db.serviceMessage.updateMany({
    where: delReclamo(r),
    data: { nextAttemptAt: hasta, attempts: { decrement: 1 } },
  });
}

/** Al borrar los datos personales del contacto: cancela sus pendientes y
 *  limpia el last_error de todas sus filas. */
export async function limpiarMensajesDelTallerDelContacto(
  organizationId: string,
  contactId: string,
  db: Db = prisma,
) {
  await db.serviceMessage.updateMany({
    where: { organizationId, contactId, status: "PENDING" },
    data: { status: "CANCELLED", cancelReason: "Se borraron los datos del cliente" },
  });
  return db.serviceMessage.updateMany({
    where: { organizationId, contactId },
    data: { lastError: null },
  });
}

/** El número de WhatsApp de la organización cuando la sucursal del vehículo no
 *  tiene uno (§6.3): el de su agente más antiguo con número. */
export function findOrganizationWhatsappPhoneNumberId(
  organizationId: string,
  db: Db = prisma,
): Promise<string | null> {
  return db.agent
    .findFirst({
      where: { organizationId, deletedAt: null, whatsappPhoneNumberId: { not: null } },
      select: { whatsappPhoneNumberId: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    })
    .then((agente) => agente?.whatsappPhoneNumberId ?? null);
}

// --- Tarea ------------------------------------------------------------------

/** El aviso con lo que la tarea necesita (el vehículo y su cliente). */
export function leerAvisoParaLaTarea(organizationId: string, noticeId: string, db: Db = prisma) {
  return db.customerVehicleNotice.findFirst({
    where: { id: noticeId, organizationId },
    select: {
      id: true,
      customerVehicle: {
        select: {
          id: true,
          contactId: true,
          branchId: true,
          make: true,
          model: true,
          licensePlate: true,
          contact: { select: { firstName: true, lastName: true } },
        },
      },
    },
  });
}

/** A quién va la tarea (§6.3): el encargado de la última orden del vehículo,
 *  después el responsable por defecto de la sucursal y por último el ADMIN
 *  activo más antiguo. null = la organización no tiene a nadie. */
export async function asignadoDeLaTarea(
  organizationId: string,
  customerVehicleId: string,
  branchId: string | null,
  db: Db = prisma,
): Promise<string | null> {
  const activo = { isActive: true, deletedAt: null };
  const ultima = await db.serviceOrder.findFirst({
    where: { organizationId, customerVehicleId, assigneeId: { not: null }, assignee: activo },
    select: { assigneeId: true },
    orderBy: { createdAt: "desc" },
  });
  if (ultima?.assigneeId) return ultima.assigneeId;
  if (branchId) {
    const sucursal = await db.branch.findFirst({
      where: { id: branchId, organizationId, defaultOwner: activo },
      select: { defaultOwnerId: true },
    });
    if (sucursal?.defaultOwnerId) return sucursal.defaultOwnerId;
  }
  const admin = await db.user.findFirst({
    where: { organizationId, ...activo, role: { name: "ADMIN" } },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  return admin?.id ?? null;
}
