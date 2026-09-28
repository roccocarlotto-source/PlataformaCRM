import { DiscountVoucherFollowUpStatus, Prisma } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";

// ---------------------------------------------------------------------------
// La cola de cupones de descuento agendados para mandarse por WhatsApp (ítem
// 177 de docs/frontend-cambios-pendientes.md). Ver el modelo
// DiscountVoucherFollowUp en schema.prisma, la acción que agenda en
// src/services/automationActions/sendDiscountVoucherFollowup.ts y el worker
// que manda en src/workers/discountVoucherFollowUpWorker.ts.
//
// EL MISMO RECLAMO QUE qr_follow_ups (qrFollowUp.repository.ts), sin estado
// PROCESSING: reclamar sube attempts y corre next_attempt_at un lease hacia
// adelante, y `attempts` es el token de exclusión de toda transición
// posterior. Lo único nuevo es marcarCuponEmitido.
// ---------------------------------------------------------------------------

export interface AgendarDiscountVoucherFollowUpData {
  organizationId: string;
  automationId: string;
  opportunityId: string;
  contactId: string;
  branchId: string;
  label: string;
  expiresInDays: number;
  scheduledFor: Date;
}

// Agenda UN envío. Devuelve false si ya había uno para (regla, oportunidad):
// la reentrega de opportunity.won. INSERT ... ON CONFLICT DO NOTHING
// (createMany con skipDuplicates) contra el UNIQUE (organization_id,
// automation_id, opportunity_id) de la migración 20261008120000.
export async function agendarDiscountVoucherFollowUp(
  data: AgendarDiscountVoucherFollowUpData,
  db: Db = prisma,
) {
  const { count } = await db.discountVoucherFollowUp.createMany({
    data: [{ ...data, nextAttemptAt: data.scheduledFor }],
    skipDuplicates: true,
  });
  return count === 1;
}

export interface DiscountVoucherFollowUpReclamado {
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

// Reclama UN envío vencido; mismo SQL y mismos motivos que
// claimNextQrFollowUp, incluido el EXISTS de la plantilla aprobada (ítem 160):
// una organización sin plantilla no tiene con qué mandar, y sus filas no
// gastan intentos hasta que Meta la apruebe. Lo sirve el índice parcial
// discount_voucher_follow_ups_claimable_idx.
export async function claimNextDiscountVoucherFollowUp(
  leaseMs: number,
  opciones: { organizationId?: string; excluir?: string[] } = {},
  db: Db = prisma,
): Promise<DiscountVoucherFollowUpReclamado | null> {
  const filtroOrg = opciones.organizationId
    ? Prisma.sql`AND c.organization_id = ${opciones.organizationId}::uuid`
    : Prisma.empty;
  const filtroExcluidos =
    opciones.excluir && opciones.excluir.length > 0
      ? Prisma.sql`AND c.id <> ALL(${opciones.excluir}::uuid[])`
      : Prisma.empty;

  const filas = await db.$queryRaw<FilaReclamada[]>`
    UPDATE discount_voucher_follow_ups f
    SET attempts = f.attempts + 1,
        next_attempt_at = now() + (${leaseMs}::int * interval '1 millisecond'),
        updated_at = now()
    WHERE f.id = (
      SELECT c.id
      FROM discount_voucher_follow_ups c
      WHERE c.status = 'PENDING'::"DiscountVoucherFollowUpStatus"
        AND c.next_attempt_at <= now()
        AND EXISTS (
          SELECT 1
          FROM whatsapp_templates t
          WHERE t.organization_id = c.organization_id
            AND t.deleted_at IS NULL
            AND t.status = 'APPROVED'::"WhatsappTemplateStatus"
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
export function findDiscountVoucherFollowUpParaEnviar(
  id: string,
  organizationId: string,
  db: Db = prisma,
) {
  return db.discountVoucherFollowUp.findFirst({
    where: { id, organizationId },
    include: {
      automation: { select: { isActive: true, deletedAt: true } },
      opportunity: { select: { status: true, deletedAt: true } },
      contact: { select: { firstName: true, phone: true, deletedAt: true } },
      branch: { select: { deletedAt: true } },
    },
  });
}

export type DiscountVoucherFollowUpParaEnviar = NonNullable<
  Awaited<ReturnType<typeof findDiscountVoucherFollowUpParaEnviar>>
>;

// El WHERE de toda transición de un envío reclamado: sigue PENDING y sigue
// siendo de quien lo reclamó con este `attempts`.
function delReclamo(reclamo: DiscountVoucherFollowUpReclamado) {
  return {
    id: reclamo.id,
    organizationId: reclamo.organizationId,
    status: DiscountVoucherFollowUpStatus.PENDING,
    attempts: reclamo.attempts,
  };
}

// Deja anotado el cupón recién emitido. Exige además que la fila NO tenga uno
// ya: si otro worker lo emitió y lo anotó, esto no afecta ninguna fila. true
// si lo anotó. El worker lo corre en la MISMA transacción que la emisión, así
// que un false deshace el cupón (ver emitirCupon en el worker).
export async function marcarCuponEmitido(
  reclamo: DiscountVoucherFollowUpReclamado,
  discountVoucherId: string,
  db: Db = prisma,
) {
  const { count } = await db.discountVoucherFollowUp.updateMany({
    where: { ...delReclamo(reclamo), discountVoucherId: null },
    data: { discountVoucherId },
  });
  return count === 1;
}

export function markDiscountVoucherFollowUpSent(
  reclamo: DiscountVoucherFollowUpReclamado,
  cuando: Date,
  db: Db = prisma,
) {
  return db.discountVoucherFollowUp.updateMany({
    where: delReclamo(reclamo),
    data: { status: DiscountVoucherFollowUpStatus.SENT, sentAt: cuando, lastError: null },
  });
}

export function markDiscountVoucherFollowUpCancelled(
  reclamo: DiscountVoucherFollowUpReclamado,
  motivo: string,
  db: Db = prisma,
) {
  return db.discountVoucherFollowUp.updateMany({
    where: delReclamo(reclamo),
    data: { status: DiscountVoucherFollowUpStatus.CANCELLED, lastError: motivo },
  });
}

export function rescheduleDiscountVoucherFollowUp(
  reclamo: DiscountVoucherFollowUpReclamado,
  datos: { nextAttemptAt: Date; lastError: string },
  db: Db = prisma,
) {
  return db.discountVoucherFollowUp.updateMany({
    where: delReclamo(reclamo),
    data: { nextAttemptAt: datos.nextAttemptAt, lastError: datos.lastError },
  });
}

export function markDiscountVoucherFollowUpFailed(
  reclamo: DiscountVoucherFollowUpReclamado,
  lastError: string,
  db: Db = prisma,
) {
  return db.discountVoucherFollowUp.updateMany({
    where: delReclamo(reclamo),
    data: { status: DiscountVoucherFollowUpStatus.FAILED, lastError },
  });
}
