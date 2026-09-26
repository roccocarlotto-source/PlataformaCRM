import { Prisma, QrFollowUpStatus } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";

// ---------------------------------------------------------------------------
// La cola de seguimientos por WhatsApp con el QR (ítem 159 de
// docs/frontend-cambios-pendientes.md). Ver el modelo QrFollowUp en
// schema.prisma, la acción que agenda en
// src/services/automationActions/sendQrFollowup.ts y el worker que manda en
// src/workers/qrFollowUpWorker.ts.
//
// MISMO RECLAMO QUE agent_inbound_jobs, SIN EL ESTADO PROCESSING. El envío es
// un POST de segundos, así que el reclamo no cambia el status: sube attempts y
// corre next_attempt_at hacia adelante un lease. Mientras dura el envío la
// fila sigue en PENDING pero con su turno en el futuro, así que ningún otro
// worker la toma; si el proceso muere, el lease vence y vuelve a ser
// reclamable, con el intento ya contado.
//
// `attempts` ES EL TOKEN DE EXCLUSIÓN, igual que en esa cola: toda transición
// posterior exige en el WHERE el valor que devolvió ESE reclamo. Si un worker
// se colgó más que su lease y otro retomó la fila, el primero ya no puede
// escribir nada.
// ---------------------------------------------------------------------------

export interface AgendarQrFollowUpData {
  organizationId: string;
  automationId: string;
  opportunityId: string;
  contactId: string;
  qrCodeId: string;
  scheduledFor: Date;
}

// Agenda UN envío. Devuelve false si ya había uno para (regla, oportunidad):
// la reentrega de opportunity.won después de que la acción ya corrió. Es un
// INSERT ... ON CONFLICT DO NOTHING (createMany con skipDuplicates), no un
// error que haya que atrapar: el UNIQUE (automation_id, opportunity_id) de la
// migración 20261002120000 es lo que convierte el duplicado en inofensivo.
export async function agendarQrFollowUp(data: AgendarQrFollowUpData, db: Db = prisma) {
  const { count } = await db.qrFollowUp.createMany({
    data: [{ ...data, nextAttemptAt: data.scheduledFor }],
    skipDuplicates: true,
  });
  return count === 1;
}

export interface QrFollowUpReclamado {
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

// Reclama UN envío vencido y le corre el turno un lease hacia adelante.
// Devuelve null si no queda ninguno. Una sola sentencia: el SELECT ... FOR
// UPDATE SKIP LOCKED del subquery y el UPDATE corren juntos, así que dos
// workers nunca reclaman la misma fila. Lo sirve el índice parcial
// qr_follow_ups_claimable_idx.
//
// `excluir` y `organizationId` cumplen el mismo rol que en las otras colas:
// que la pasada no vuelva a tomar lo que acaba de fallar, y que los tests de
// integración no dependan del resto de la tabla.
export async function claimNextQrFollowUp(
  leaseMs: number,
  opciones: { organizationId?: string; excluir?: string[] } = {},
  db: Db = prisma,
): Promise<QrFollowUpReclamado | null> {
  const filtroOrg = opciones.organizationId
    ? Prisma.sql`AND c.organization_id = ${opciones.organizationId}::uuid`
    : Prisma.empty;
  const filtroExcluidos =
    opciones.excluir && opciones.excluir.length > 0
      ? Prisma.sql`AND c.id <> ALL(${opciones.excluir}::uuid[])`
      : Prisma.empty;

  const filas = await db.$queryRaw<FilaReclamada[]>`
    UPDATE qr_follow_ups f
    SET attempts = f.attempts + 1,
        next_attempt_at = now() + (${leaseMs}::int * interval '1 millisecond'),
        updated_at = now()
    WHERE f.id = (
      SELECT c.id
      FROM qr_follow_ups c
      WHERE c.status = 'PENDING'::"QrFollowUpStatus"
        AND c.next_attempt_at <= now()
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
// Las cuatro filas relacionadas vienen con su deletedAt / estado actual: el
// worker decide con ellas si el envío todavía corresponde.
export function findQrFollowUpParaEnviar(id: string, organizationId: string, db: Db = prisma) {
  return db.qrFollowUp.findFirst({
    where: { id, organizationId },
    include: {
      automation: { select: { isActive: true, deletedAt: true } },
      opportunity: { select: { status: true, deletedAt: true } },
      contact: { select: { firstName: true, phone: true, deletedAt: true } },
      qrCode: { select: { branchId: true, destinationUrl: true, deletedAt: true } },
    },
  });
}

export type QrFollowUpParaEnviar = NonNullable<
  Awaited<ReturnType<typeof findQrFollowUpParaEnviar>>
>;

// El WHERE de toda transición de un envío reclamado: sigue PENDING y sigue
// siendo de quien lo reclamó con este `attempts`.
function delReclamo(reclamo: QrFollowUpReclamado) {
  return {
    id: reclamo.id,
    organizationId: reclamo.organizationId,
    status: QrFollowUpStatus.PENDING,
    attempts: reclamo.attempts,
  };
}

export function markQrFollowUpSent(reclamo: QrFollowUpReclamado, cuando: Date, db: Db = prisma) {
  return db.qrFollowUp.updateMany({
    where: delReclamo(reclamo),
    // Un envío que salió no arrastra el diagnóstico de un intento viejo.
    data: { status: QrFollowUpStatus.SENT, sentAt: cuando, lastError: null },
  });
}

export function markQrFollowUpCancelled(
  reclamo: QrFollowUpReclamado,
  motivo: string,
  db: Db = prisma,
) {
  return db.qrFollowUp.updateMany({
    where: delReclamo(reclamo),
    data: { status: QrFollowUpStatus.CANCELLED, lastError: motivo },
  });
}

export function rescheduleQrFollowUp(
  reclamo: QrFollowUpReclamado,
  datos: { nextAttemptAt: Date; lastError: string },
  db: Db = prisma,
) {
  return db.qrFollowUp.updateMany({
    where: delReclamo(reclamo),
    data: { nextAttemptAt: datos.nextAttemptAt, lastError: datos.lastError },
  });
}

export function markQrFollowUpFailed(
  reclamo: QrFollowUpReclamado,
  lastError: string,
  db: Db = prisma,
) {
  return db.qrFollowUp.updateMany({
    where: delReclamo(reclamo),
    data: { status: QrFollowUpStatus.FAILED, lastError },
  });
}
