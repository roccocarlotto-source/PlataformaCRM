import {
  InquiryFollowUpKind,
  InquiryFollowUpStatus,
  Prisma,
  type ConversationChannel,
  type ConversationStatus,
} from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";
import { sinTurnoQueFrene } from "../clinicas/seguimientoDeConsultas";
import { VENTANA_DE_WHATSAPP_MS } from "../utils/ventanaDeWhatsapp";

// ---------------------------------------------------------------------------
// Los seguimientos automáticos de consultas estancadas (ítem 185 de
// docs/frontend-cambios-pendientes.md). Ver el modelo InquiryFollowUp en
// schema.prisma, el barrido que emite el trigger
// (src/workers/inquiryStalledWorker.ts), la acción que agenda
// (src/services/automationActions/inquiryFollowUp.ts) y el worker que manda
// los de WhatsApp (src/workers/inquiryFollowUpWorker.ts).
//
// EL MISMO RECLAMO QUE discount_voucher_follow_ups (discountVoucherFollowUp
// .repository.ts): reclamar sube attempts y corre next_attempt_at un lease
// hacia adelante, y `attempts` es el token de exclusión de toda transición
// posterior. Lo propio de acá es la consulta del BARRIDO (findStalledInquiries)
// y el contador que esta tabla lleva implícito.
// ---------------------------------------------------------------------------

export interface ConsultaEstancada {
  contactId: string;
  ownerId: string | null;
  conversationId: string;
  channel: ConversationChannel;
  branchId: string;
  conversationStatus: ConversationStatus;
  // El último mensaje del cliente.
  lastInboundAt: Date;
}

interface FilaEstancada {
  contact_id: string;
  owner_id: string | null;
  conversation_id: string;
  channel: ConversationChannel;
  branch_id: string;
  conversation_status: ConversationStatus;
  last_inbound_at: Date;
}

// Las consultas sin avance de una organización: contactos (identificados o
// no) cuyo último mensaje es anterior a `limite` (ahora menos X días), sin
// oportunidad abierta, sin la marca "sin interés", y que
//   - no tienen un seguimiento PENDING ni uno SENT posterior a `limite` (los
//     X días se cuentan también desde el último seguimiento: con N=2 el
//     segundo no sale al día siguiente del primero), y
//   - tienen menos de `maxFollowUps` seguimientos SENT posteriores a su último
//     mensaje (si el cliente vuelve a escribir, la cuenta arranca de cero).
// La conversación es la más reciente del contacto (por último mensaje), y el
// último mensaje del cliente se busca en ella: una conversación que abrió una
// plantilla y en la que el cliente nunca escribió no es una consulta.
export async function findStalledInquiries(
  organizationId: string,
  limite: Date,
  maxFollowUps: number,
  db: Db = prisma,
  // R15 (docs/rubros.md §9.1): solo en una clínica, sin turno CONFIRMED futuro
  // ni atendido en los últimos `dias`. Sin pasarlo, la consulta de siempre.
  filtroDeTurnos?: { ahora: Date; dias: number },
): Promise<ConsultaEstancada[]> {
  const turnos = filtroDeTurnos
    ? sinTurnoQueFrene(filtroDeTurnos.ahora, filtroDeTurnos.dias)
    : Prisma.empty;
  const filas = await db.$queryRaw<FilaEstancada[]>`
    SELECT c.id AS contact_id,
      c.owner_id,
      cv.id AS conversation_id,
      cv.channel,
      cv.branch_id,
      cv.status AS conversation_status,
      m.created_at AS last_inbound_at
    FROM contacts c
    JOIN LATERAL (
      SELECT cv.id, cv.channel, cv.branch_id, cv.status
      FROM conversations cv
      WHERE cv.organization_id = c.organization_id AND cv.contact_id = c.id
      ORDER BY cv.last_message_at DESC NULLS LAST, cv.created_at DESC, cv.id DESC
      LIMIT 1
    ) cv ON true
    JOIN LATERAL (
      SELECT m.created_at
      FROM messages m
      WHERE m.organization_id = c.organization_id
        AND m.conversation_id = cv.id
        AND m.direction = 'INBOUND'
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT 1
    ) m ON true
    WHERE c.organization_id = ${organizationId}::uuid
      AND c.deleted_at IS NULL
      AND c.no_interest_at IS NULL
      AND m.created_at <= ${limite}
      AND NOT EXISTS (
        SELECT 1 FROM opportunities o
        WHERE o.organization_id = c.organization_id
          AND o.contact_id = c.id
          AND o.deleted_at IS NULL
          AND o.status = 'OPEN'::"OpportunityStatus"
      )
      AND NOT EXISTS (
        SELECT 1 FROM inquiry_follow_ups f
        WHERE f.organization_id = c.organization_id
          AND f.contact_id = c.id
          AND (
            f.status = 'PENDING'::"InquiryFollowUpStatus"
            OR (f.status = 'SENT'::"InquiryFollowUpStatus" AND f.created_at > ${limite})
          )
      )
      AND (
        SELECT count(*) FROM inquiry_follow_ups f
        WHERE f.organization_id = c.organization_id
          AND f.contact_id = c.id
          AND f.status = 'SENT'::"InquiryFollowUpStatus"
          AND f.created_at > m.created_at
      ) < ${maxFollowUps}
      ${turnos}
    ORDER BY m.created_at ASC, c.id ASC`;
  return filas.map((fila) => ({
    contactId: fila.contact_id,
    ownerId: fila.owner_id,
    conversationId: fila.conversation_id,
    channel: fila.channel,
    branchId: fila.branch_id,
    conversationStatus: fila.conversation_status,
    lastInboundAt: fila.last_inbound_at,
  }));
}

export interface AgendarInquiryFollowUpData {
  organizationId: string;
  automationId: string;
  contactId: string;
  conversationId: string;
  branchId: string;
  channel: ConversationChannel;
  outboxEventId: string;
  kind: InquiryFollowUpKind;
  lastInboundAt: Date;
  scheduledFor: Date;
  // Una tarea se crea en el acto: la fila nace SENT. Por default PENDING.
  status?: InquiryFollowUpStatus;
  sentAt?: Date;
}

// Agenda UN seguimiento. Devuelve false si ya había uno para (regla,
// contacto, evento): la reentrega del evento. INSERT ... ON CONFLICT DO
// NOTHING contra el UNIQUE inquiry_follow_ups_automation_contact_event_key.
export async function agendarInquiryFollowUp(data: AgendarInquiryFollowUpData, db: Db = prisma) {
  const { count } = await db.inquiryFollowUp.createMany({
    data: [{ ...data, nextAttemptAt: data.scheduledFor }],
    skipDuplicates: true,
  });
  return count === 1;
}

// ¿El cliente escribió (en cualquier conversación) después de `desde`? Si sí,
// ya respondió y el seguimiento agendado no corresponde.
export async function existsInboundSince(
  organizationId: string,
  contactId: string,
  desde: Date,
  db: Db = prisma,
): Promise<boolean> {
  const mensaje = await db.message.findFirst({
    where: {
      organizationId,
      direction: "INBOUND",
      createdAt: { gt: desde },
      conversation: { contactId },
    },
    select: { id: true },
  });
  return mensaje !== null;
}

// Los seguimientos PENDING de un contacto pasan a CANCELLED con el motivo: lo
// hace la marca "sin interés" (mark_no_interest y la ficha), para no esperar
// a que el worker los relea.
export function cancelPendingInquiryFollowUpsOfContact(
  organizationId: string,
  contactId: string,
  motivo: string,
  db: Db = prisma,
) {
  return db.inquiryFollowUp.updateMany({
    where: { organizationId, contactId, status: InquiryFollowUpStatus.PENDING },
    data: { status: InquiryFollowUpStatus.CANCELLED, lastError: motivo },
  });
}

export interface InquiryFollowUpReclamado {
  id: string;
  organizationId: string;
  // El valor DESPUÉS del reclamo: es el token que exigen las transiciones.
  attempts: number;
}

interface FilaReclamada {
  id: string;
  organization_id: string;
  attempts: number;
}

// Reclama UN seguimiento de WhatsApp vencido; mismo SQL y mismos motivos que
// claimNextDiscountVoucherFollowUp. Se reclama si la regla tiene su plantilla
// APROBADA o si el último mensaje del cliente está dentro de las 24 h (ahí
// sale texto libre, sin plantilla); si no, la fila no gasta intentos hasta
// que Meta apruebe. Lo sirve el índice parcial inquiry_follow_ups_claimable_idx.
export async function claimNextInquiryFollowUp(
  leaseMs: number,
  opciones: { organizationId?: string; excluir?: string[] } = {},
  db: Db = prisma,
): Promise<InquiryFollowUpReclamado | null> {
  const filtroOrg = opciones.organizationId
    ? Prisma.sql`AND c.organization_id = ${opciones.organizationId}::uuid`
    : Prisma.empty;
  const filtroExcluidos =
    opciones.excluir && opciones.excluir.length > 0
      ? Prisma.sql`AND c.id <> ALL(${opciones.excluir}::uuid[])`
      : Prisma.empty;

  const filas = await db.$queryRaw<FilaReclamada[]>`
    UPDATE inquiry_follow_ups f
    SET attempts = f.attempts + 1,
        next_attempt_at = now() + (${leaseMs}::int * interval '1 millisecond'),
        updated_at = now()
    WHERE f.id = (
      SELECT c.id
      FROM inquiry_follow_ups c
      WHERE c.status = 'PENDING'::"InquiryFollowUpStatus"
        AND c.kind = 'WHATSAPP'::"InquiryFollowUpKind"
        AND c.next_attempt_at <= now()
        AND (
          c.last_inbound_at > now() - (${VENTANA_DE_WHATSAPP_MS}::int * interval '1 millisecond')
          OR EXISTS (
            SELECT 1
            FROM whatsapp_templates t
            WHERE t.organization_id = c.organization_id
              AND t.automation_id = c.automation_id
              AND t.deleted_at IS NULL
              AND t.status = 'APPROVED'::"WhatsappTemplateStatus"
          )
        )
      ${filtroOrg}
      ${filtroExcluidos}
      ORDER BY c.next_attempt_at
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING f.id, f.organization_id, f.attempts
  `;

  if (filas.length === 0) {
    return null;
  }
  const fila = filas[0];
  return { id: fila.id, organizationId: fila.organization_id, attempts: fila.attempts };
}

// Todo lo que el worker necesita releer al momento de mandar, en una consulta.
export function findInquiryFollowUpParaEnviar(id: string, organizationId: string, db: Db = prisma) {
  return db.inquiryFollowUp.findFirst({
    where: { id, organizationId },
    include: {
      automation: { select: { isActive: true, deletedAt: true } },
      contact: {
        select: {
          firstName: true,
          lastName: true,
          phone: true,
          source: true,
          deletedAt: true,
          noInterestAt: true,
          leadServiceOfInterest: true,
          vehicleOfInterest: { select: { make: true, model: true, trim: true, year: true } },
        },
      },
      conversation: { select: { status: true, agentId: true, externalThreadId: true } },
      branch: { select: { deletedAt: true } },
    },
  });
}

export type InquiryFollowUpParaEnviar = NonNullable<
  Awaited<ReturnType<typeof findInquiryFollowUpParaEnviar>>
>;

// El WHERE de toda transición de un seguimiento reclamado: sigue PENDING y
// sigue siendo de quien lo reclamó con este `attempts`.
function delReclamo(reclamo: InquiryFollowUpReclamado) {
  return {
    id: reclamo.id,
    organizationId: reclamo.organizationId,
    status: InquiryFollowUpStatus.PENDING,
    attempts: reclamo.attempts,
  };
}

export function markInquiryFollowUpSent(
  reclamo: InquiryFollowUpReclamado,
  cuando: Date,
  db: Db = prisma,
) {
  return db.inquiryFollowUp.updateMany({
    where: delReclamo(reclamo),
    data: { status: InquiryFollowUpStatus.SENT, sentAt: cuando, lastError: null },
  });
}

export function markInquiryFollowUpCancelled(
  reclamo: InquiryFollowUpReclamado,
  motivo: string,
  db: Db = prisma,
) {
  return db.inquiryFollowUp.updateMany({
    where: delReclamo(reclamo),
    data: { status: InquiryFollowUpStatus.CANCELLED, lastError: motivo },
  });
}

export function rescheduleInquiryFollowUp(
  reclamo: InquiryFollowUpReclamado,
  datos: { nextAttemptAt: Date; lastError: string },
  db: Db = prisma,
) {
  return db.inquiryFollowUp.updateMany({
    where: delReclamo(reclamo),
    data: { nextAttemptAt: datos.nextAttemptAt, lastError: datos.lastError },
  });
}

// Fuera del horario de la sucursal: a la próxima apertura, devolviendo el
// intento (mismo criterio que posponerDiscountVoucherFollowUpHasta).
export function posponerInquiryFollowUpHasta(
  reclamo: InquiryFollowUpReclamado,
  hasta: Date,
  db: Db = prisma,
) {
  return db.inquiryFollowUp.updateMany({
    where: delReclamo(reclamo),
    data: { nextAttemptAt: hasta, attempts: { decrement: 1 } },
  });
}

export function markInquiryFollowUpFailed(
  reclamo: InquiryFollowUpReclamado,
  lastError: string,
  db: Db = prisma,
) {
  return db.inquiryFollowUp.updateMany({
    where: delReclamo(reclamo),
    data: { status: InquiryFollowUpStatus.FAILED, lastError },
  });
}
