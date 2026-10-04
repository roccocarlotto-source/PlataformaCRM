import { ConversationChannel, type Message } from "@prisma/client";
import { prisma } from "../lib/prisma";
import type { WidgetAuthContext } from "../types/widgetAuth";

// ---------------------------------------------------------------------------
// El hilo del widget, para el visitante: POST /api/public/agents/:agentId/
// web/thread. Hasta acá el widget solo mostraba la respuesta a SU mensaje (la
// del POST de web/messages), así que lo que escribía una persona del equipo
// desde el CRM, o el aviso de "nadie disponible", nunca le llegaba.
//
// DOS MODOS, según `desde`:
//   - Sin `desde` (el widget recién se abre): el historial visible de la
//     sesión, los últimos LIMITE_DEL_HISTORIAL mensajes. Así, si el visitante
//     cerró la pestaña, la respuesta lo espera al volver (si la sesión sigue
//     viva: el mismo sessionId en su navegador).
//   - Con `desde` (el polling): solo lo que el negocio escribió FUERA del
//     request del visitante —HUMAN y AUTOMATION— a partir de ese instante.
//     Las respuestas del agente NO, porque el widget ya las pintó con la
//     respuesta del POST: traerlas las duplicaría.
//
// ALCANCE: la sesión es el sessionId del visitante DENTRO del agente del
// token (Conversation.externalThreadId, el mismo vínculo de
// widgetContact.service.ts) y de su organización. Nada de otro agente, otra
// organización u otra sesión. Una sesión sin conversación devuelve vacío y
// NO crea nada: leer nunca da de alta un contacto.
//
// PROYECCIÓN MÍNIMA, como el POST: id, quién (visitante o negocio), texto y
// fecha. Nada de toolCalls, senderUserId ni estados internos.
//
// Lo que el visitante recibió por acá pasa de SENT a DELIVERED: es el
// "entregado" que el vendedor ve en el CRM, igual que en WhatsApp.
// ---------------------------------------------------------------------------

export const LIMITE_DEL_HISTORIAL = 50;

// El cursor de una sesión sin mensajes. NO la hora de este request: el cursor
// se compara contra createdAt ya guardados, y un reloj adelantado (el de otra
// instancia) haría que el polling se salteara un mensaje. Desde el principio,
// el polling trae los
// HUMAN/AUTOMATION de la sesión (pocos) y el widget descarta por id lo que ya
// pintó.
const CURSOR_INICIAL = new Date(0);

export interface MensajeDelWidget {
  id: string;
  role: "visitor" | "agent";
  text: string;
  createdAt: string;
}

export interface HiloDelWidget {
  messages: MensajeDelWidget[];
  // Lo que el widget manda como `desde` en la próxima consulta: la fecha del
  // último mensaje devuelto, o el `desde` que llegó si no hubo nada nuevo.
  cursor: string;
}

type Fila = Pick<Message, "id" | "direction" | "senderType" | "content" | "createdAt">;

// Pura: la proyección de una fila para el visitante.
export function aMensajeDelWidget(fila: Fila): MensajeDelWidget {
  return {
    id: fila.id,
    role: fila.direction === "INBOUND" ? "visitor" : "agent",
    text: fila.content,
    createdAt: fila.createdAt.toISOString(),
  };
}

export async function leerHiloDelWidget(
  widgetAuth: Pick<WidgetAuthContext, "organizationId" | "agentId">,
  sessionId: string,
  desde: Date | null,
): Promise<HiloDelWidget> {
  const { organizationId, agentId } = widgetAuth;
  const deLaSesion = {
    organizationId,
    conversation: {
      organizationId,
      agentId,
      channel: ConversationChannel.WEB,
      externalThreadId: sessionId,
    },
    // Un FAILED en la web solo puede ser un error de la base: no se muestra.
    OR: [{ deliveryStatus: null }, { deliveryStatus: { not: "FAILED" as const } }],
  };
  const select = {
    id: true,
    direction: true,
    senderType: true,
    content: true,
    createdAt: true,
    deliveryStatus: true,
  } as const;

  const filas =
    desde === null
      ? (
          await prisma.message.findMany({
            where: {
              ...deLaSesion,
              AND: [
                {
                  OR: [
                    { direction: "INBOUND", senderType: "CONTACT" },
                    { direction: "OUTBOUND", senderType: { in: ["AGENT", "HUMAN", "AUTOMATION"] } },
                  ],
                },
              ],
            },
            orderBy: { createdAt: "desc" },
            take: LIMITE_DEL_HISTORIAL,
            select,
          })
        ).reverse()
      : await prisma.message.findMany({
          where: {
            ...deLaSesion,
            direction: "OUTBOUND",
            senderType: { in: ["HUMAN", "AUTOMATION"] },
            // gte y no gt: dos mensajes en el mismo milisegundo no se pierden.
            // El widget descarta por id lo que ya pintó.
            createdAt: { gte: desde },
          },
          orderBy: { createdAt: "asc" },
          take: LIMITE_DEL_HISTORIAL,
          select,
        });

  const entregados = filas
    .filter((f) => f.direction === "OUTBOUND" && f.deliveryStatus === "SENT")
    .map((f) => f.id);
  if (entregados.length > 0) {
    // Solo SENT → DELIVERED: el estado nunca retrocede.
    await prisma.message.updateMany({
      where: { organizationId, id: { in: entregados }, deliveryStatus: "SENT" },
      data: { deliveryStatus: "DELIVERED" },
    });
  }

  const ultimo = filas.at(-1);
  return {
    messages: filas.map(aMensajeDelWidget),
    cursor: ultimo ? ultimo.createdAt.toISOString() : (desde ?? CURSOR_INICIAL).toISOString(),
  };
}
