import { AgentInboundJobStatus, Prisma, type ConversationChannel } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";

// ---------------------------------------------------------------------------
// La cola del webhook de WhatsApp (ítem 125 de
// docs/auditoria-2026-09-24-punta-a-punta.md). Ver el modelo AgentInboundJob
// en schema.prisma y el worker en src/workers/agentInboundWorker.ts.
//
// LA DIFERENCIA CON LAS OTRAS DOS COLAS: outbox e ingesta trabajan DENTRO de
// la transacción del reclamo (FOR UPDATE SKIP LOCKED) y un proceso muerto la
// aborta sola. Acá el trabajo es un turno del LLM de hasta minutos, así que el
// reclamo es una sola sentencia que deja el job en PROCESSING con un lease
// (locked_until) y commitea; el turno corre afuera. Si el proceso muere, nadie
// renueva el lease, vence, y el próximo reclamo lo retoma.
//
// `attempts` ES EL TOKEN DE EXCLUSIÓN: sube en cada reclamo, y todas las
// transiciones posteriores exigen en el WHERE el valor que devolvió ESE
// reclamo. Si un worker se colgó más que su lease y otro retomó el job, el
// primero ya no puede escribir nada: sus updateMany afectan 0 filas. Es el
// mismo compare-and-swap que el `status: PENDING` de las transiciones del
// outbox, con un dato que distingue además QUIÉN reclamó.
// ---------------------------------------------------------------------------

// channelAccountId/externalUserId son genéricos desde el ítem 169 (antes
// phoneNumberId/waId): la cuenta del negocio y el id del cliente del lado de
// Meta, según el canal. Ver el modelo AgentInboundJob en schema.prisma.
export interface CreateAgentInboundJobData {
  organizationId: string;
  messageId: string;
  // Sin él, la base pone WHATSAPP (el default de la columna).
  channel?: ConversationChannel;
  channelAccountId: string;
  externalUserId: string;
  // Ítem 162: solo para un entrante con adjunto (un audio).
  mediaId?: string;
  mediaType?: string;
}

export function createAgentInboundJob(data: CreateAgentInboundJobData, db: Db = prisma) {
  return db.agentInboundJob.create({ data });
}

export function findAgentInboundJobById(id: string, organizationId: string, db: Db = prisma) {
  return db.agentInboundJob.findFirst({ where: { id, organizationId } });
}

export interface JobReclamado {
  id: string;
  organizationId: string;
  messageId: string;
  channel: ConversationChannel;
  channelAccountId: string;
  externalUserId: string;
  // El valor DESPUÉS del reclamo: es el token que exigen las transiciones.
  attempts: number;
  responseMessageId: string | null;
}

interface FilaReclamada {
  id: string;
  organization_id: string;
  message_id: string;
  channel: ConversationChannel;
  channel_account_id: string;
  external_user_id: string;
  attempts: number;
  response_message_id: string | null;
}

// Reclama UN job y lo deja en PROCESSING con el lease puesto. Devuelve null si
// no queda ninguno reclamable.
//
// Reclamable es: PENDING cuyo turno llegó (misma condición con coalesce que
// el outbox, y por el mismo motivo: la sirve el índice parcial
// agent_inbound_jobs_claimable_idx), o PROCESSING con el lease vencido — el
// proceso que lo tenía murió a mitad. En ese segundo caso last_error lo dice,
// porque es lo único que va a quedar registrado de ese intento.
//
// UNA SOLA SENTENCIA, sin transacción explícita: el SELECT ... FOR UPDATE SKIP
// LOCKED del subquery y el UPDATE corren en la misma sentencia, así que dos
// workers nunca reclaman el mismo job, y el lock de fila se suelta al terminar
// la sentencia — no hay nada que sostener durante el turno.
//
// `excluir` y `organizationId` cumplen el mismo rol que en las otras colas.
export async function claimNextAgentInboundJob(
  leaseMs: number,
  opciones: { organizationId?: string; excluir?: string[] } = {},
  db: Db = prisma,
): Promise<JobReclamado | null> {
  const filtroOrg = opciones.organizationId
    ? Prisma.sql`AND c.organization_id = ${opciones.organizationId}::uuid`
    : Prisma.empty;
  const filtroExcluidos =
    opciones.excluir && opciones.excluir.length > 0
      ? Prisma.sql`AND c.id <> ALL(${opciones.excluir}::uuid[])`
      : Prisma.empty;

  const filas = await db.$queryRaw<FilaReclamada[]>`
    UPDATE agent_inbound_jobs j
    SET status = 'PROCESSING'::"AgentInboundJobStatus",
        attempts = j.attempts + 1,
        locked_until = now() + (${leaseMs}::int * interval '1 millisecond'),
        next_attempt_at = NULL,
        last_error = CASE
          WHEN j.status = 'PROCESSING'::"AgentInboundJobStatus"
            THEN 'El proceso que tenía el job no terminó (lease vencido): se retoma'
          ELSE j.last_error
        END,
        updated_at = now()
    WHERE j.id = (
      SELECT c.id
      FROM agent_inbound_jobs c
      WHERE c.status IN ('PENDING'::"AgentInboundJobStatus", 'PROCESSING'::"AgentInboundJobStatus")
        AND (
          (c.status = 'PENDING'::"AgentInboundJobStatus"
            AND coalesce(c.next_attempt_at, c.created_at) <= now())
          OR (c.status = 'PROCESSING'::"AgentInboundJobStatus" AND c.locked_until < now())
        )
      ${filtroOrg}
      ${filtroExcluidos}
      ORDER BY coalesce(c.next_attempt_at, c.created_at)
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING j.id, j.organization_id, j.message_id, j.channel, j.channel_account_id,
              j.external_user_id, j.attempts, j.response_message_id
  `;

  if (filas.length === 0) {
    return null;
  }
  const fila = filas[0];
  return {
    id: fila.id,
    organizationId: fila.organization_id,
    messageId: fila.message_id,
    channel: fila.channel,
    channelAccountId: fila.channel_account_id,
    externalUserId: fila.external_user_id,
    attempts: fila.attempts,
    responseMessageId: fila.response_message_id,
  };
}

// El WHERE de toda transición de un job reclamado: sigue en PROCESSING y
// sigue siendo de quien lo reclamó con este `attempts`.
function delReclamo(job: Pick<JobReclamado, "id" | "organizationId" | "attempts">) {
  return {
    id: job.id,
    organizationId: job.organizationId,
    status: AgentInboundJobStatus.PROCESSING,
    attempts: job.attempts,
  };
}

// El latido del worker mientras el turno corre: corre el lease hacia adelante.
// 0 filas = el job ya no es de este worker (lo retomó otro, o lo cerró un
// turno que lo cubrió); el worker lo loguea y sigue, las transiciones de más
// abajo tampoco van a escribir nada.
export function renewAgentInboundJobLease(
  job: Pick<JobReclamado, "id" | "organizationId" | "attempts">,
  leaseMs: number,
  db: Db = prisma,
) {
  return db.agentInboundJob.updateMany({
    where: delReclamo(job),
    data: { lockedUntil: new Date(Date.now() + leaseMs) },
  });
}

// La respuesta que el turno produjo. Se registra ANTES de mandarla: si el
// envío falla, el reintento la encuentra acá y reenvía el mismo Message en vez
// de correr otro turno.
export function setAgentInboundJobResponse(
  job: Pick<JobReclamado, "id" | "organizationId" | "attempts">,
  responseMessageId: string,
  db: Db = prisma,
) {
  return db.agentInboundJob.updateMany({
    where: delReclamo(job),
    data: { responseMessageId },
  });
}

export function markAgentInboundJobDone(
  job: Pick<JobReclamado, "id" | "organizationId" | "attempts">,
  db: Db = prisma,
) {
  return db.agentInboundJob.updateMany({
    where: delReclamo(job),
    data: {
      status: AgentInboundJobStatus.DONE,
      lockedUntil: null,
      nextAttemptAt: null,
      // Un job terminado no arrastra el diagnóstico de un intento viejo.
      lastError: null,
    },
  });
}

export function rescheduleAgentInboundJob(
  job: Pick<JobReclamado, "id" | "organizationId" | "attempts">,
  datos: { nextAttemptAt: Date; lastError: string },
  db: Db = prisma,
) {
  return db.agentInboundJob.updateMany({
    where: delReclamo(job),
    data: {
      status: AgentInboundJobStatus.PENDING,
      lockedUntil: null,
      nextAttemptAt: datos.nextAttemptAt,
      lastError: datos.lastError,
    },
  });
}

export function markAgentInboundJobFailed(
  job: Pick<JobReclamado, "id" | "organizationId" | "attempts">,
  lastError: string,
  db: Db = prisma,
) {
  return db.agentInboundJob.updateMany({
    where: delReclamo(job),
    data: {
      status: AgentInboundJobStatus.FAILED,
      lockedUntil: null,
      nextAttemptAt: null,
      lastError,
    },
  });
}

// B-16 de docs-privados/auditoria-2026-09-30-corta.md (local): el motivo con
// el que queda FAILED un job cuya conversación se cerró antes de que el
// agente respondiera. Lo escriben el cierre (para los PENDING) y el worker
// (para el que ya estaba reclamado).
export const MOTIVO_CONVERSACION_CERRADA =
  "La conversación se cerró antes de que el agente respondiera";

// Al cerrar una conversación: sus jobs que todavía no corrieron no corren.
// Solo PENDING y sin respuesta propia: uno en PROCESSING lo tiene un worker, que
// relee la conversación bajo el lock y lo corta él; uno con responseMessageId
// ya tiene respuesta y solo falta entregarla.
export function cancelPendingInboundJobsOfConversation(
  organizationId: string,
  conversationId: string,
  db: Db = prisma,
) {
  return db.agentInboundJob.updateMany({
    where: {
      organizationId,
      status: AgentInboundJobStatus.PENDING,
      responseMessageId: null,
      message: { conversationId },
    },
    data: {
      status: AgentInboundJobStatus.FAILED,
      lockedUntil: null,
      nextAttemptAt: null,
      lastError: MOTIVO_CONVERSACION_CERRADA,
    },
  });
}

export interface EntrantePendiente {
  messageId: string;
  // Ítem 162: el adjunto que el worker tiene que bajar antes del turno.
  mediaId: string | null;
  mediaType: string | null;
}

// Los entrantes de una conversación que todavía esperan respuesta: tienen un
// job vivo (PENDING o PROCESSING) y ese job no produjo respuesta todavía. Es
// lo que el turno pone AL FINAL del historial y responde junto (ver
// responderEnLaConversacion), y lo que después se marca como cubierto.
//
// Con su media (ítem 162): en una ráfaga de dos audios, el turno del primero
// responde también el segundo, así que tiene que escuchar los dos.
export async function findPendingInboundMessages(
  organizationId: string,
  conversationId: string,
  db: Db = prisma,
): Promise<EntrantePendiente[]> {
  return db.agentInboundJob.findMany({
    where: {
      organizationId,
      status: { in: [AgentInboundJobStatus.PENDING, AgentInboundJobStatus.PROCESSING] },
      responseMessageId: null,
      message: { conversationId },
    },
    select: { messageId: true, mediaId: true, mediaType: true },
  });
}

// Los jobs de otros entrantes que el turno de ESTE job ya respondió (una
// ráfaga: "hola" / "quiero un auto" / "un Gol 2020"). Se cierran en DONE sin
// correr un turno propio: el modelo los vio a todos y contestó una vez.
//
// SOLO los que no tienen respuesta propia: uno con responseMessageId es un
// job cuya respuesta ya existe y solo falta ENTREGAR, y cerrarlo acá
// cancelaría ese reenvío.
//
// Incluye PROCESSING: otro worker pudo haberlo reclamado y estar esperando el
// lock de la conversación. Cuando lo consiga, relee su job, lo ve DONE y no
// corre nada (y sus transiciones ya no escriben: el WHERE exige PROCESSING).
export function markAgentInboundJobsCovered(
  organizationId: string,
  messageIds: string[],
  db: Db = prisma,
) {
  return db.agentInboundJob.updateMany({
    where: {
      organizationId,
      messageId: { in: messageIds },
      status: { in: [AgentInboundJobStatus.PENDING, AgentInboundJobStatus.PROCESSING] },
      responseMessageId: null,
    },
    data: {
      status: AgentInboundJobStatus.DONE,
      lockedUntil: null,
      nextAttemptAt: null,
      lastError: null,
    },
  });
}
