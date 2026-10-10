import type { ConversationChannel } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";

// ---------------------------------------------------------------------------
// Lecturas del dashboard de atención (docs/ediciones.md §6.4). Todas acotadas
// a la organización; las ventanas llegan ya calculadas en la zona de la
// organización (utils/zonedWindow.ts): `gte: start, lt: end`.
// ---------------------------------------------------------------------------

export interface Ventana {
  start: Date;
  end: Date;
}

/** Conversaciones que empezaron en la ventana, por canal. */
export async function conversacionesNuevasPorCanal(
  organizationId: string,
  ventana: Ventana,
  db: Db = prisma,
): Promise<{ channel: ConversationChannel; count: number }[]> {
  const filas = await db.conversation.groupBy({
    by: ["channel"],
    where: { organizationId, createdAt: { gte: ventana.start, lt: ventana.end } },
    _count: { _all: true },
  });
  return filas.map((f) => ({ channel: f.channel, count: f._count._all }));
}

/** Conversaciones cuya última derivación a una persona cayó en la ventana.
 *  transferredToHumanAt guarda la última: una conversación derivada dos veces
 *  cuenta una sola vez, en la ventana de su última derivación. */
export function contarDerivaciones(organizationId: string, ventana: Ventana, db: Db = prisma) {
  return db.conversation.count({
    where: { organizationId, transferredToHumanAt: { gte: ventana.start, lt: ventana.end } },
  });
}

/** Avisos "nadie disponible" que salieron en la ventana: derivaciones en las
 *  que ninguna persona respondió a tiempo (avisoSinRespuesta.service.ts). */
export function contarAvisosSinRespuesta(
  organizationId: string,
  ventana: Ventana,
  db: Db = prisma,
) {
  return db.message.count({
    where: {
      organizationId,
      noticeType: "UNANSWERED_HANDOFF",
      createdAt: { gte: ventana.start, lt: ventana.end },
    },
  });
}

/** Seguimientos automáticos de consultas agendados y todavía sin mandar (#446). */
export function contarSeguimientosAgendados(organizationId: string, db: Db = prisma) {
  return db.inquiryFollowUp.count({ where: { organizationId, status: "PENDING" } });
}

/** Consultas esperando respuesta: conversaciones abiertas en las que el
 *  último mensaje es del cliente, de un contacto vigente, sin la marca "sin
 *  interés" y sin una oportunidad abierta (una oportunidad abierta ya tiene
 *  quien la siga). */
export async function contarConsultasEsperandoRespuesta(
  organizationId: string,
  db: Db = prisma,
): Promise<number> {
  const [fila] = await db.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n
    FROM conversations c
    JOIN contacts ct
      ON ct.id = c.contact_id
     AND ct.organization_id = c.organization_id
     AND ct.deleted_at IS NULL
     AND ct.no_interest_at IS NULL
    WHERE c.organization_id = ${organizationId}::uuid
      AND c.status <> 'CLOSED'::"ConversationStatus"
      AND (
        SELECT m.direction
        FROM messages m
        WHERE m.conversation_id = c.id
          AND m.organization_id = c.organization_id
        ORDER BY m.created_at DESC, m.id DESC
        LIMIT 1
      ) = 'INBOUND'::"MessageDirection"
      AND NOT EXISTS (
        SELECT 1
        FROM opportunities o
        WHERE o.organization_id = c.organization_id
          AND o.contact_id = c.contact_id
          AND o.status = 'OPEN'::"OpportunityStatus"
          AND o.deleted_at IS NULL
      )`;
  return fila?.n ?? 0;
}

/** Tareas sin completar con la fecha límite ya pasada. */
export function contarTareasVencidas(organizationId: string, ahora: Date, db: Db = prisma) {
  return db.activity.count({
    where: {
      organizationId,
      type: "TASK",
      completedAt: null,
      deletedAt: null,
      dueDate: { lt: ahora },
    },
  });
}
