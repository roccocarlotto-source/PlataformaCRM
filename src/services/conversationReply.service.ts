import type { Conversation, Message } from "@prisma/client";
import { env } from "../config/env";
import { logger } from "../lib/logger";
import { prisma } from "../lib/prisma";
import { findAgentById } from "../repositories/agent.repository";
import {
  findConversationById,
  returnConversationToAgent,
  takeOverConversation,
} from "../repositories/conversation.repository";
import {
  createMessage,
  findLastInboundAt,
  findMessageById,
  markMessageDelivery,
} from "../repositories/message.repository";
import type { RoleName } from "../types/auth";
import { AppError } from "../utils/AppError";
import { describirError } from "../utils/backoff";
import { finDeLaVentanaDeWhatsapp, ventanaDeWhatsappAbierta } from "../utils/ventanaDeWhatsapp";
import { conLockDeConversacion } from "./agentOrchestration.service";
import { getConversationById } from "./conversation.service";
import { aplicarEstadosRetenidos } from "./estadosDeEntregaRetenidos.service";
import {
  WhatsappGraphError,
  mensajeDeMeta,
  sendWhatsappTextReal,
  type SendWhatsappText,
} from "./whatsappGraph.service";

// ---------------------------------------------------------------------------
// Responder desde el CRM (I-03 de
// docs-privados/auditoria-2026-09-24-punta-a-punta.md, local). Hasta acá la
// derivación a una persona terminaba en una bandeja de solo lectura, y el
// número de la Cloud API no se puede usar desde la app de WhatsApp: el
// vendedor no tenía por dónde contestar.
//
// Lo que hace responder:
//   - El mensaje sale por WhatsApp desde el número del negocio (el del agente
//     de la conversación) y queda como OUTBOUND / HUMAN, con su wamid: los
//     estados de Meta (entregado, leído) lo encuentran igual que a las
//     respuestas del agente.
//   - La conversación queda TRANSFERRED_TO_HUMAN, y con eso el agente se calla
//     (humanoAtiendeLaConversacion) hasta que alguien la devuelva.
//
// Solo WhatsApp. El widget web no tiene cómo recibir un mensaje que no sea la
// respuesta al suyo (no hace polling), y Messenger/Instagram quedan para otro
// PR: los tres devuelven 409 con el motivo.
//
// PERMISOS: el vendedor asignado a la conversación o cualquier ADMIN (decisión
// de Rocco). Una conversación sin asignar solo la puede tomar un ADMIN, y al
// contestar pasa a ser suya.
// ---------------------------------------------------------------------------

// El tope de Meta para el cuerpo de un mensaje de texto.
export const LARGO_MAXIMO_DE_RESPUESTA = 4096;

export const MENSAJE_SIN_PERMISO =
  "Solo el vendedor asignado a la conversación o un administrador pueden atenderla";
export const MENSAJE_CANAL_NO_SOPORTADO =
  "Por ahora solo se puede responder desde el CRM en conversaciones de WhatsApp";
export const MENSAJE_CERRADA = "La conversación está cerrada";
export const MENSAJE_VENTANA_VENCIDA =
  "Pasaron más de 24 h desde el último mensaje del cliente: WhatsApp solo permite plantillas aprobadas";

// Lo único que esto le pide a Meta, inyectable para los tests (mismo criterio
// que DepsDeEnvio del worker).
export interface DepsDeRespuestaHumana {
  accessToken: () => string | undefined;
  sendText: SendWhatsappText;
}

export const depsDeRespuestaHumanaReales: DepsDeRespuestaHumana = {
  accessToken: () => env.WHATSAPP_ACCESS_TOKEN,
  sendText: sendWhatsappTextReal,
};

export interface Actor {
  userId: string;
  role: RoleName;
}

// Pura: ¿puede esta persona atender (responder, reintentar, devolver) esta
// conversación?
export function puedeAtenderLaConversacion(
  actor: Actor,
  conversation: Pick<Conversation, "assignedUserId">,
): boolean {
  return actor.role === "ADMIN" || conversation.assignedUserId === actor.userId;
}

// Pura: por qué no se puede mandar texto libre ahora, o null si se puede. El
// orden importa para el mensaje: una conversación web cerrada dice "cerrada".
export function motivoParaNoResponder(
  conversation: Pick<Conversation, "channel" | "status">,
  finDeVentana: Date | null,
  ahora: Date = new Date(),
): string | null {
  if (conversation.status === "CLOSED") {
    return MENSAJE_CERRADA;
  }
  if (conversation.channel !== "WHATSAPP") {
    return MENSAJE_CANAL_NO_SOPORTADO;
  }
  if (!ventanaDeWhatsappAbierta(finDeVentana, ahora)) {
    return MENSAJE_VENTANA_VENCIDA;
  }
  return null;
}

// Pura: el motivo de un envío fallido, legible para el vendedor. Lo de Meta
// (error_user_msg / message) si vino; si no, el error tal cual.
export function motivoDelFallo(err: unknown): string {
  if (err instanceof WhatsappGraphError) {
    return mensajeDeMeta(err) ?? `WhatsApp rechazó el mensaje (${err.status})`;
  }
  return describirError(err);
}

// La conversación de la organización, o 404; y 403 si esta persona no la
// atiende. En ese orden, igual que el resto del módulo: una de otra
// organización no existe para quien pregunta.
async function conversacionQueAtiende(actor: Actor, organizationId: string, id: string) {
  const conversation = await findConversationById(id, organizationId);
  if (!conversation) {
    throw new AppError("Conversación no encontrada", 404);
  }
  if (!puedeAtenderLaConversacion(actor, conversation)) {
    throw new AppError(MENSAJE_SIN_PERMISO, 403);
  }
  return conversation;
}

// Los chequeos que dependen del estado vigente, releídos BAJO el lock: la
// conversación pudo cerrarse o el cliente pudo escribir mientras se esperaba.
async function validarQueSePuedeResponder(conversation: Conversation, actor: Actor) {
  if (!puedeAtenderLaConversacion(actor, conversation)) {
    throw new AppError(MENSAJE_SIN_PERMISO, 403);
  }
  const fin = finDeLaVentanaDeWhatsapp(
    await findLastInboundAt(conversation.id, conversation.organizationId),
  );
  const motivo = motivoParaNoResponder(conversation, fin);
  if (motivo !== null) {
    throw new AppError(motivo, 409);
  }
  const agente = await findAgentById(conversation.agentId, conversation.organizationId);
  if (!agente?.whatsappPhoneNumberId) {
    throw new AppError("El agente de esta conversación ya no tiene un número de WhatsApp", 409);
  }
  if (!conversation.externalThreadId) {
    throw new AppError("La conversación no tiene el número del cliente", 409);
  }
  return { phoneNumberId: agente.whatsappPhoneNumberId, to: conversation.externalThreadId };
}

// Manda un Message HUMAN ya persistido y deja el resultado en la fila: SENT con
// el wamid, o FAILED con el motivo. NUNCA lanza por un fallo de Meta: el
// mensaje queda a la vista con "No se pudo enviar" y su botón de reintento, y
// el request responde la conversación como quedó.
async function enviarMensajeHumano(
  mensaje: Pick<Message, "id" | "organizationId" | "content">,
  destino: { phoneNumberId: string; to: string },
  deps: DepsDeRespuestaHumana,
): Promise<void> {
  try {
    const accessToken = deps.accessToken();
    if (!accessToken) {
      throw new Error("Falta configurar el token de WhatsApp del servidor");
    }
    const { wamid } = await deps.sendText({
      phoneNumberId: destino.phoneNumberId,
      to: destino.to,
      body: mensaje.content,
      accessToken,
    });
    await markMessageDelivery(mensaje.id, mensaje.organizationId, {
      status: "SENT",
      externalMessageId: wamid,
    });
    // D-15: un estado que Meta mandó antes de que el wamid quedara guardado.
    if (wamid) {
      await aplicarEstadosRetenidos(mensaje.organizationId, wamid);
    }
  } catch (err) {
    logger.warn(
      { err, organizationId: mensaje.organizationId, messageId: mensaje.id },
      "No se pudo enviar por WhatsApp la respuesta de una persona desde el CRM",
    );
    await markMessageDelivery(mensaje.id, mensaje.organizationId, {
      status: "FAILED",
      error: motivoDelFallo(err),
    });
  }
}

function claveDe(conversation: Conversation) {
  return {
    agentId: conversation.agentId,
    contactId: conversation.contactId,
    channel: conversation.channel,
  };
}

// Responder. Corre bajo el MISMO lock que los turnos del agente: si el agente
// está en medio de un turno sobre esta conversación, la respuesta de la
// persona espera a que termine y sale después — nunca se cruzan. Desde que el
// Message HUMAN existe (antes de mandarlo), el próximo turno ya encuentra al
// agente callado.
export async function responderDesdeElCrm(
  actor: Actor,
  organizationId: string,
  conversationId: string,
  texto: string,
  deps: DepsDeRespuestaHumana = depsDeRespuestaHumanaReales,
) {
  const contenido = texto.trim();
  if (contenido.length === 0) {
    throw new AppError("El mensaje no puede estar vacío", 400);
  }
  const inicial = await conversacionQueAtiende(actor, organizationId, conversationId);

  await conLockDeConversacion(claveDe(inicial), async () => {
    const vigente = (await findConversationById(conversationId, organizationId)) ?? inicial;
    const destino = await validarQueSePuedeResponder(vigente, actor);

    const mensaje = await prisma.$transaction(async (tx) => {
      const creado = await createMessage(
        {
          organizationId,
          conversationId,
          direction: "OUTBOUND",
          senderType: "HUMAN",
          senderUserId: actor.userId,
          content: contenido,
          deliveryStatus: "PENDING",
        },
        tx,
      );
      await takeOverConversation(
        conversationId,
        organizationId,
        actor.userId,
        creado.createdAt,
        tx,
      );
      return creado;
    });

    await enviarMensajeHumano(mensaje, destino, deps);
  });

  return getConversationById(organizationId, conversationId);
}

// Reintentar un mensaje de una persona que no salió. Es el MISMO Message, no
// uno nuevo: el hilo no se llena de copias del mismo texto. Solo un HUMAN en
// FAILED de esta conversación; lo demás (incluido uno que ya salió) es 409.
export async function reintentarRespuestaDesdeElCrm(
  actor: Actor,
  organizationId: string,
  conversationId: string,
  messageId: string,
  deps: DepsDeRespuestaHumana = depsDeRespuestaHumanaReales,
) {
  const inicial = await conversacionQueAtiende(actor, organizationId, conversationId);

  await conLockDeConversacion(claveDe(inicial), async () => {
    const mensaje = await findMessageById(messageId, organizationId);
    if (!mensaje || mensaje.conversationId !== conversationId) {
      throw new AppError("Mensaje no encontrado", 404);
    }
    if (mensaje.senderType !== "HUMAN" || mensaje.deliveryStatus !== "FAILED") {
      throw new AppError("Solo se puede reintentar un mensaje del equipo que no se envió", 409);
    }
    const vigente = (await findConversationById(conversationId, organizationId)) ?? inicial;
    const destino = await validarQueSePuedeResponder(vigente, actor);

    await markMessageDelivery(mensaje.id, organizationId, { status: "PENDING" });
    await enviarMensajeHumano(mensaje, destino, deps);
  });

  return getConversationById(organizationId, conversationId);
}

// "Devolver al agente": la conversación vuelve a ACTIVE y el agente contesta
// el próximo mensaje del cliente. No le manda nada al cliente ni contesta lo
// que haya quedado sin respuesta: retoma cuando el cliente vuelva a escribir.
// Idempotente: devolver una que no está derivada deja todo igual (200).
export async function devolverAlAgente(actor: Actor, organizationId: string, id: string) {
  await conversacionQueAtiende(actor, organizationId, id);
  await returnConversationToAgent(id, organizationId);
  return getConversationById(organizationId, id);
}
