import type { Conversation, ConversationChannel, Message } from "@prisma/client";
import { env } from "../config/env";
import { logger } from "../lib/logger";
import { avisoDeRecepcion } from "../clinicas/services/sedesDeUsuarios.service";
import { prisma, type Db } from "../lib/prisma";
import { createActivity } from "../repositories/activity.repository";
import { findAgentById } from "../repositories/agent.repository";
import { findChannelAccountIdOfConversation } from "../repositories/agentInboundJob.repository";
import { findContactById } from "../repositories/contact.repository";
import {
  findConversationById,
  findOrCreateOpenConversation,
  returnConversationToAgent,
  takeOverConversation,
  updateConversation,
} from "../repositories/conversation.repository";
import {
  createMessage,
  findLastInboundAt,
  findMessageById,
  findSalientesRecientes,
  humanSpokeLast,
  markMessageDelivery,
} from "../repositories/message.repository";
import { findOldestActiveAdmin } from "../repositories/user.repository";
import type { RoleName } from "../types/auth";
import { AppError } from "../utils/AppError";
import { describirError } from "../utils/backoff";
import { partirMensaje } from "../utils/partirMensaje";
import { finDeLaVentanaDeWhatsapp, ventanaDeWhatsappAbierta } from "../utils/ventanaDeWhatsapp";
import { agenteAtiendeElCanal, conLockDeConversacion } from "./agentOrchestration.service";
import { getConversationById } from "./conversation.service";
import { enviarEnPartes } from "./envioEnPartes";
import {
  avisoLlegaTarde,
  textoDelAviso,
  asuntoDeTareaSinRespuesta,
  debeAvisarAlDevolver,
  entregaDelAviso,
  findAdminParaLaTarea,
  findTareaAbiertaDelPedido,
} from "./avisoSinRespuesta.service";
import { atencionFueraDeHorarioDeLaSucursal } from "./branchBusinessHours.service";
import { aplicarEstadosRetenidos } from "./estadosDeEntregaRetenidos.service";
import { marcarTokenRechazado, obtenerTokenParaEnviar } from "./metaPageConnection.service";
import { MetaSendError, sendMetaTextReal, type SendMetaText } from "./metaSend.service";
import { exigirSedeDelActor, puede, type ActorConSedes } from "./permisos";
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
//   - El mensaje sale por el canal de la conversación y queda como OUTBOUND /
//     HUMAN:
//       · WhatsApp: desde el número del negocio (el del agente), con su wamid:
//         los estados de Meta (entregado, leído) lo encuentran igual que a las
//         respuestas del agente.
//       · Messenger e Instagram: por el Send API con el token de la página por
//         la que escribió el cliente (metaSend.service.ts), messaging_type
//         RESPONSE y SIN etiqueta: mismo criterio que el agente.
//       · Web: no hay envío. Queda en el hilo (SENT) y el widget lo trae con
//         su polling (publicWidgetThread.service.ts), que lo pasa a DELIVERED
//         cuando le llegó al navegador del visitante.
//   - La conversación queda TRANSFERRED_TO_HUMAN, y con eso el agente se calla
//     (humanoAtiendeLaConversacion) hasta que alguien la devuelva.
//
// LA VENTANA DE 24 H vale para WhatsApp, Messenger e Instagram (ver
// utils/ventanaDeWhatsapp.ts); la web no tiene.
//
// PERMISOS: el vendedor asignado a la conversación o cualquier ADMIN (decisión
// de Rocco). Una conversación sin asignar solo la puede tomar un ADMIN, y al
// contestar pasa a ser suya.
// ---------------------------------------------------------------------------

// El tope de Meta para el cuerpo de un mensaje de texto.
export const LARGO_MAXIMO_DE_RESPUESTA = 4096;

export const MENSAJE_SIN_PERMISO =
  "Solo el vendedor asignado a la conversación o un administrador pueden atenderla";
export const MENSAJE_CERRADA = "La conversación está cerrada";
export const MENSAJE_VENTANA_VENCIDA =
  "Pasaron más de 24 h desde el último mensaje del cliente: WhatsApp solo permite plantillas aprobadas";
export const MENSAJE_VENTANA_VENCIDA_META =
  "Pasaron más de 24 h desde el último mensaje del cliente: Messenger e Instagram no dejan escribirle hasta que vuelva a escribir";

// El subcódigo del Send API para "This message is sent outside of allowed
// window" (código 10). Ver el punto 3 de metaSend.service.ts.
const SUBCODIGO_FUERA_DE_VENTANA = 2018278;

// Lo único que esto le pide a Meta, inyectable para los tests (mismo criterio
// que DepsDeEnvio del worker).
export interface DepsDeRespuestaHumana {
  accessToken: () => string | undefined;
  sendText: SendWhatsappText;
  // Messenger e Instagram: el token de la página, por organización y cifrado
  // en la base (el mismo de DepsDeEnvio del worker).
  pageAccessToken: (organizationId: string, pageId: string) => Promise<string>;
  sendMetaText: SendMetaText;
}

export const depsDeRespuestaHumanaReales: DepsDeRespuestaHumana = {
  accessToken: () => env.WHATSAPP_ACCESS_TOKEN,
  sendText: sendWhatsappTextReal,
  pageAccessToken: obtenerTokenParaEnviar,
  sendMetaText: sendMetaTextReal,
};

// Por dónde sale un mensaje de esta conversación.
export type Destino =
  | { canal: "WHATSAPP"; phoneNumberId: string; to: string }
  | { canal: "META"; channel: ConversationChannel; pageId: string; recipientId: string }
  | { canal: "WEB" };

// `industry` y `sedes` (R20): una Recepción de clínica atiende solo las
// conversaciones de sus sedes. Opcionales: los caminos de sistema no las pasan
// y sedesDelActor falla cerrado para Recepción.
export interface Actor extends ActorConSedes {
  userId: string;
  role: RoleName;
}

// Pura: ¿puede esta persona atender (responder, reintentar, devolver) esta
// conversación?
export function puedeAtenderLaConversacion(
  actor: Actor,
  conversation: Pick<Conversation, "assignedUserId">,
): boolean {
  return (
    puede(actor, "atender_cualquier_conversacion") || conversation.assignedUserId === actor.userId
  );
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
  if (conversation.channel === "WEB") {
    return null;
  }
  if (!ventanaDeWhatsappAbierta(finDeVentana, ahora)) {
    return conversation.channel === "WHATSAPP"
      ? MENSAJE_VENTANA_VENCIDA
      : MENSAJE_VENTANA_VENCIDA_META;
  }
  return null;
}

// El error.message del cuerpo del Send API, si vino.
function mensajeDelSendApi(err: MetaSendError): string | null {
  try {
    const cuerpo = JSON.parse(err.detalle) as { error?: { message?: unknown } };
    const mensaje = cuerpo.error?.message;
    return typeof mensaje === "string" && mensaje.trim() !== "" ? mensaje.trim() : null;
  } catch {
    return null;
  }
}

// Pura: el motivo de un envío fallido, legible para el vendedor. Lo de Meta
// (error_user_msg / message) si vino; si no, el error tal cual.
export function motivoDelFallo(err: unknown): string {
  if (err instanceof WhatsappGraphError) {
    return mensajeDeMeta(err) ?? `WhatsApp rechazó el mensaje (${err.status})`;
  }
  if (err instanceof MetaSendError) {
    if (err.subcodigo === SUBCODIGO_FUERA_DE_VENTANA) {
      return MENSAJE_VENTANA_VENCIDA_META;
    }
    return mensajeDelSendApi(err) ?? `Meta rechazó el mensaje (${err.status})`;
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
  // De otra sede (Recepción, R20): el mismo 404, antes del 403.
  exigirSedeDelActor(actor, conversation.branchId, "Conversación no encontrada");
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
  return validarQueSePuedeEscribir(conversation);
}

// Estado, ventana y destino, sin el permiso de atender (lo decide quien llama).
async function validarQueSePuedeEscribir(conversation: Conversation) {
  const fin = finDeLaVentanaDeWhatsapp(
    await findLastInboundAt(conversation.id, conversation.organizationId),
  );
  const motivo = motivoParaNoResponder(conversation, fin);
  if (motivo !== null) {
    throw new AppError(motivo, 409);
  }
  const destino = await destinoDeLaConversacion(conversation);
  if ("motivo" in destino) {
    throw new AppError(destino.motivo, 409);
  }
  return destino;
}

// Por dónde sale un mensaje de esta conversación, o por qué no se puede. Sin
// lanzar: responder lo convierte en 409, y el aviso de devolver (que no puede
// fallar por esto) en un FAILED con el motivo.
async function destinoDeLaConversacion(
  conversation: Conversation,
): Promise<Destino | { motivo: string }> {
  if (conversation.channel === "WEB") {
    return { canal: "WEB" };
  }
  if (!conversation.externalThreadId) {
    return { motivo: "La conversación no tiene el identificador del cliente en el canal" };
  }
  if (conversation.channel === "WHATSAPP") {
    const agente = await findAgentById(conversation.agentId, conversation.organizationId);
    if (!agente?.whatsappPhoneNumberId) {
      return { motivo: "El agente de esta conversación ya no tiene un número de WhatsApp" };
    }
    return {
      canal: "WHATSAPP",
      phoneNumberId: agente.whatsappPhoneNumberId,
      to: conversation.externalThreadId,
    };
  }
  // Messenger e Instagram: la página por la que entró el último mensaje del
  // cliente (el PSID/IGSID es de esa página). Si hoy la organización tiene
  // otra conectada, obtenerTokenParaEnviar lo rechaza con su motivo.
  const pageId = await findChannelAccountIdOfConversation(
    conversation.id,
    conversation.organizationId,
  );
  if (!pageId) {
    return { motivo: "No se encontró la página de Facebook por la que escribió el cliente" };
  }
  return {
    canal: "META",
    channel: conversation.channel,
    pageId,
    recipientId: conversation.externalThreadId,
  };
}

// Manda un Message saliente ya persistido (la respuesta de una persona, o el
// aviso de devolver al agente) y deja el resultado en la fila: SENT (con el
// wamid en WhatsApp), o FAILED con el motivo. NUNCA lanza por un fallo del
// canal: el mensaje queda a la vista con "No se pudo enviar" y su botón de
// reintento, y el request responde la conversación como quedó.
async function enviarPorElCanal(
  mensaje: Pick<Message, "id" | "organizationId" | "content">,
  destino: Destino,
  deps: DepsDeRespuestaHumana,
): Promise<void> {
  const { organizationId } = mensaje;
  try {
    if (destino.canal === "WEB") {
      // Nada que mandar: el widget lo trae del hilo.
      await markMessageDelivery(mensaje.id, organizationId, { status: "SENT" });
      return;
    }
    if (destino.canal === "META") {
      const pageAccessToken = await deps.pageAccessToken(organizationId, destino.pageId);
      // OPUS-B-02 (docs-privados, local): en las partes que pida el canal.
      await enviarEnPartes(mensaje, destino.channel, (texto) =>
        deps.sendMetaText({ pageAccessToken, recipientId: destino.recipientId, text: texto }),
      );
      await markMessageDelivery(mensaje.id, organizationId, { status: "SENT" });
      return;
    }
    const accessToken = deps.accessToken();
    if (!accessToken) {
      throw new Error("Falta configurar el token de WhatsApp del servidor");
    }
    const { wamid } = await enviarEnPartes(mensaje, "WHATSAPP", (texto) =>
      deps.sendText({
        phoneNumberId: destino.phoneNumberId,
        to: destino.to,
        body: texto,
        accessToken,
      }),
    );
    await markMessageDelivery(mensaje.id, organizationId, {
      status: "SENT",
      externalMessageId: wamid,
    });
    // D-15: un estado que Meta mandó antes de que el wamid quedara guardado.
    if (wamid) {
      await aplicarEstadosRetenidos(organizationId, wamid);
    }
  } catch (err) {
    logger.warn(
      { err, organizationId, messageId: mensaje.id, canal: destino.canal },
      "No se pudo enviar un mensaje desde el CRM",
    );
    if (destino.canal === "META" && err instanceof MetaSendError && err.tokenInvalido) {
      // Mismo criterio que el worker del agente: la conexión pasa a ERROR
      // para que el CRM pida reconectar. Si esto falla, el mensaje igual
      // queda FAILED con su motivo.
      await marcarTokenRechazado(
        organizationId,
        destino.pageId,
        `Meta rechazó el token de la página al mandar un mensaje: ${err.detalle}`,
      ).catch((errMarca: unknown) => {
        logger.error(
          { err: errMarca, organizationId },
          "No se pudo marcar en ERROR la conexión con Facebook",
        );
      });
    }
    await markMessageDelivery(mensaje.id, organizationId, {
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
    organizationId: conversation.organizationId,
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

    await enviarPorElCanal(mensaje, destino, deps);
  });

  return getConversationById(organizationId, conversationId);
}

// Un mensaje de una persona del equipo que NO es atender la conversación: hoy,
// mandarle a mano un cupón al cliente (discountVoucherManual.service.ts). Mismo
// lock, misma ventana, mismo canal y mismos estados que responder, pero:
//   - NO toma la conversación: no la deriva ni la asigna. Si el agente la
//     atendía, la sigue atendiendo (un cupón no es "lo atiendo yo").
//   - El permiso lo decide quien llama (el del cupón no es el de atender).
// Queda en el hilo como OUTBOUND / HUMAN de esa persona, con su reintento si
// el canal lo rechaza. Devuelve el mensaje como quedó.
export async function enviarMensajeDelEquipo(
  userId: string,
  organizationId: string,
  conversationId: string,
  texto: string,
  deps: DepsDeRespuestaHumana = depsDeRespuestaHumanaReales,
): Promise<Message> {
  const contenido = texto.trim();
  if (contenido.length === 0) {
    throw new AppError("El mensaje no puede estar vacío", 400);
  }
  const inicial = await findConversationById(conversationId, organizationId);
  if (!inicial) {
    throw new AppError("Conversación no encontrada", 404);
  }
  const mensajeId = await conLockDeConversacion(claveDe(inicial), async () => {
    const vigente = (await findConversationById(conversationId, organizationId)) ?? inicial;
    const destino = await validarQueSePuedeEscribir(vigente);
    const mensaje = await prisma.$transaction(async (tx) => {
      const creado = await createMessage(
        {
          organizationId,
          conversationId,
          direction: "OUTBOUND",
          senderType: "HUMAN",
          senderUserId: userId,
          content: contenido,
          deliveryStatus: "PENDING",
        },
        tx,
      );
      await updateConversation(
        conversationId,
        organizationId,
        { lastMessageAt: creado.createdAt },
        tx,
      );
      return creado;
    });
    await enviarPorElCanal(mensaje, destino, deps);
    return mensaje.id;
  });
  const final = await findMessageById(mensajeId, organizationId);
  if (!final) {
    throw new AppError("Mensaje no encontrado", 404);
  }
  return final;
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
    await enviarPorElCanal(mensaje, destino, deps);
  });

  return getConversationById(organizationId, conversationId);
}

// "Devolver al agente": la conversación vuelve a ACTIVE y el agente contesta
// el próximo mensaje del cliente. Idempotente: devolver una que no está
// derivada deja todo igual (200).
//
// SI NINGUNA PERSONA LE RESPONDIÓ desde la derivación, además (ver
// avisoSinRespuesta.service.ts): el cliente recibe el aviso fijo por el mismo
// canal, y la tarea queda pendiente —la de la derivación, o una nueva para un
// ADMIN si no había—. Si una persona sí le escribió, todo queda como antes.
//
// Bajo el MISMO lock que responder y que los turnos del agente: "¿respondió
// alguien?" se lee sin que una respuesta o un turno se cuelen en el medio. La
// devolución, el aviso y la tarea van en una transacción, con el CAS de
// returnConversationToAgent: devolver dos veces seguidas manda un solo aviso.
// El envío sale después, como en responder.
export async function devolverAlAgente(
  actor: Actor,
  organizationId: string,
  id: string,
  deps: DepsDeRespuestaHumana = depsDeRespuestaHumanaReales,
) {
  const inicial = await conversacionQueAtiende(actor, organizationId, id);

  await conLockDeConversacion(claveDe(inicial), async () => {
    const vigente = (await findConversationById(id, organizationId)) ?? inicial;
    const avisar = debeAvisarAlDevolver({
      status: vigente.status,
      humanoRespondio:
        vigente.status === "TRANSFERRED_TO_HUMAN" && (await humanSpokeLast(id, organizationId)),
    });
    await devolverYAvisar(vigente, avisar ? "con-aviso" : "sin-aviso", actor, deps);
  });

  return getConversationById(organizationId, id);
}

// "tarde": la derivación venció hace demasiado (avisoLlegaTarde). La
// conversación vuelve al agente y queda la tarea, sin escribirle al cliente.
// ---------------------------------------------------------------------------
// UNA PERSONA RESPONDIÓ DESDE LA BANDEJA DE META (OPUS-B-01 de
// docs-privados/auditoria-2026-10-04-OPUS.md, local).
//
// Un vendedor que contesta desde Meta Business Suite o desde la app de
// Instagram —algo muy común— no pasa por este CRM: Meta solo avisa con un
// "eco" del mensaje. Antes los ecos se descartaban todos, así que el agente no
// se enteraba de que una persona estaba atendiendo: le seguía hablando al
// cliente por encima, y a los minutos salía además el aviso de "no hay nadie
// disponible". Ahora ese eco se registra igual que una respuesta escrita desde
// el CRM: un Message HUMAN en el hilo y la conversación en "atiende una
// persona". Con eso el agente se calla (humanoAtiendeLaConversacion), el aviso
// automático no sale, y "Devolver al agente" funciona como siempre.
//
// CUÁL ECO ES NUESTRO. Meta manda eco de TODO lo que sale de la página,
// también de lo que mandó este CRM (el agente, una persona desde la bandeja
// del CRM, el aviso). Registrar esos como "una persona respondió" callaría al
// agente después de cada respuesta suya. Dos defensas:
//   - el webhook descarta antes los que traen el app_id de esta app;
//   - acá, un eco cuyo texto es el de un saliente reciente de la conversación
//     (entero, o una de las partes en que se mandó) es nuestro y no se
//     registra. La fila del saliente se escribe SIEMPRE antes de mandarlo, así
//     que cuando llega el eco ya está.
//
// QUIÉN FIGURA COMO AUTOR. Un mensaje HUMAN exige un usuario (es un CHECK de
// la tabla) y Meta no dice quién escribió. Figura quien tiene asignada la
// conversación; si nadie, el vendedor del contacto; si tampoco, el ADMIN
// activo más antiguo. El mensaje queda con el id que le dio Meta, y por eso la
// bandeja lo puede mostrar como "desde la bandeja de Meta".
// ---------------------------------------------------------------------------

const VENTANA_DE_ECOS_PROPIOS_MS = 24 * 60 * 60 * 1000;
const SALIENTES_A_COMPARAR = 50;

export interface RespuestaDesdeMeta {
  organizationId: string;
  agentId: string;
  branchId: string;
  contactId: string;
  channel: "MESSENGER" | "INSTAGRAM";
  // PSID o IGSID del cliente.
  externalThreadId: string;
  // El mid del eco: el UNIQUE de externalMessageId absorbe la reentrega.
  externalMessageId: string;
  texto: string;
}

// "propia": el eco es de algo que mandó este CRM. "sin-autor": no hay ningún
// usuario a quien atribuírsela (una organización sin ADMIN activo no debería
// existir).
export type ResultadoDeLaRespuestaDesdeMeta = "registrada" | "propia" | "sin-autor";

export async function registrarRespuestaDesdeLaBandejaDeMeta(
  input: RespuestaDesdeMeta,
  ahora: Date = new Date(),
): Promise<ResultadoDeLaRespuestaDesdeMeta> {
  const { organizationId, contactId, channel } = input;
  const texto = input.texto.trim();

  const conversation = await findOrCreateOpenConversation({
    organizationId,
    branchId: input.branchId,
    agentId: input.agentId,
    contactId,
    channel,
    externalThreadId: input.externalThreadId,
  });

  const recientes = await findSalientesRecientes(
    conversation.id,
    organizationId,
    new Date(ahora.getTime() - VENTANA_DE_ECOS_PROPIOS_MS),
    SALIENTES_A_COMPARAR,
  );
  const esNuestro = recientes.some((saliente) =>
    partirMensaje(saliente.content, channel).some((parte) => parte.trim() === texto),
  );
  if (esNuestro) {
    return "propia";
  }

  const autorId =
    conversation.assignedUserId ??
    (await findContactById(contactId, organizationId))?.ownerId ??
    (await findOldestActiveAdmin(organizationId))?.id ??
    null;
  if (!autorId) {
    logger.warn(
      { organizationId, conversationId: conversation.id },
      "Respuesta desde la bandeja de Meta sin ningún usuario a quien atribuirla: no se registra",
    );
    return "sin-autor";
  }

  await prisma.$transaction(async (tx) => {
    const creado = await createMessage(
      {
        organizationId,
        conversationId: conversation.id,
        direction: "OUTBOUND",
        senderType: "HUMAN",
        senderUserId: autorId,
        content: texto,
        externalMessageId: input.externalMessageId,
        // Ya salió: lo mandó Meta, no este CRM.
        deliveryStatus: "SENT",
      },
      tx,
    );
    await takeOverConversation(conversation.id, organizationId, autorId, creado.createdAt, tx);
  });
  return "registrada";
}

export type ResultadoDelAvisoAutomatico = "avisado" | "tarde" | "no-corresponde";

// El aviso automático si nadie responde (workers/avisoSinRespuestaWorker.ts):
// lo mismo que "Devolver al agente" sin respuesta —aviso, tarea, marca y la
// conversación de vuelta al agente—, pero lo decide el reloj y no una persona.
//
// SE VUELVE A DECIDIR TODO BAJO EL LOCK de la conversación, el mismo de
// responder, devolver y los turnos del agente. Entre que el worker la eligió y
// ahora, una persona pudo escribir (no se avisa ni se devuelve: está
// atendida), alguien pudo devolverla a mano o cerrarla (ya no está derivada),
// o el agente pudo cambiar sus minutos. Solo si sigue derivada, sin respuesta
// y vencida, se avisa; y el CAS de returnConversationToAgent hace que una
// derivación tenga UN solo aviso aunque dos instancias o una persona lleguen a
// la vez.
export async function avisarSiNadieRespondio(
  organizationId: string,
  conversationId: string,
  ahora: Date = new Date(),
  deps: DepsDeRespuestaHumana = depsDeRespuestaHumanaReales,
): Promise<ResultadoDelAvisoAutomatico> {
  const inicial = await findConversationById(conversationId, organizationId);
  if (!inicial) {
    return "no-corresponde";
  }
  return conLockDeConversacion(claveDe(inicial), async () => {
    const vigente = await findConversationById(conversationId, organizationId);
    if (vigente?.status !== "TRANSFERRED_TO_HUMAN" || !vigente.transferredToHumanAt) {
      return "no-corresponde";
    }
    const agente = await findAgentById(vigente.agentId, organizationId);
    // Con el agente apagado o sin el canal no hay a quién devolvérsela: sigue
    // esperando a una persona (mismo filtro que el barrido).
    if (!agente || !agenteAtiendeElCanal(agente, vigente.channel)) {
      return "no-corresponde";
    }
    const minutos = agente.unansweredHandoffNoticeMinutes ?? 0;
    const vence = vigente.transferredToHumanAt.getTime() + minutos * 60_000;
    if (minutos <= 0 || vence > ahora.getTime()) {
      return "no-corresponde";
    }
    if (await humanSpokeLast(conversationId, organizationId)) {
      return "no-corresponde";
    }
    if (avisoLlegaTarde(vigente.transferredToHumanAt, minutos, ahora)) {
      await devolverYAvisar(vigente, "solo-tarea", null, deps);
      logger.warn(
        { organizationId, conversationId, derivadaEn: vigente.transferredToHumanAt, minutos },
        "Derivación sin respuesta vencida hace demasiado: vuelve al agente con la tarea, sin aviso al cliente",
      );
      return "tarde";
    }
    await devolverYAvisar(vigente, "con-aviso", null, deps);
    return "avisado";
  });
}

// Lo común a devolver a mano y al aviso automático, ya bajo el lock: la
// devolución y, según el modo, la tarea y el aviso en la misma transacción; el
// envío por el canal después. `actor` null = lo hizo el sistema.
//   - "sin-aviso": solo la devolución (una persona ya le había respondido).
//   - "con-aviso": la tarea y el aviso al cliente.
//   - "solo-tarea": la tarea, sin escribirle al cliente (el aviso automático
//     que llega demasiado tarde, ver avisoLlegaTarde).
type ModoDeDevolucion = "sin-aviso" | "con-aviso" | "solo-tarea";

async function devolverYAvisar(
  vigente: Conversation,
  modo: ModoDeDevolucion,
  actor: Actor | null,
  deps: DepsDeRespuestaHumana,
) {
  const { id, organizationId } = vigente;
  const avisar = modo === "con-aviso";
  const entrega = entregaDelAviso(
    vigente.channel,
    finDeLaVentanaDeWhatsapp(await findLastInboundAt(id, organizationId)),
  );
  const destino = entrega.tipo === "por-el-canal" ? await destinoDeLaConversacion(vigente) : null;
  // El texto del agente, si cargó uno; fuera del horario de la sucursal se le
  // agrega cuándo le van a escribir.
  const texto = avisar
    ? textoDelAviso(
        await atencionFueraDeHorarioDeLaSucursal(organizationId, vigente.branchId, new Date()),
        (await findAgentById(vigente.agentId, organizationId))?.unansweredHandoffNoticeText ?? null,
      )
    : "";

  const aviso = await prisma.$transaction(async (tx) => {
    const devuelta = await returnConversationToAgent(id, organizationId, tx);
    if (devuelta.count !== 1 || modo === "sin-aviso") {
      return null;
    }

    if (!(await findTareaAbiertaDelPedido(organizationId, vigente.contactId, tx))) {
      await crearTareaSinRespuesta(actor, vigente, tx);
    }
    if (!avisar) {
      return null;
    }

    const motivoSinEnvio =
      entrega.tipo === "no-se-envia"
        ? entrega.motivo
        : destino && "motivo" in destino
          ? destino.motivo
          : null;
    const creado = await createMessage(
      {
        organizationId,
        conversationId: id,
        direction: "OUTBOUND",
        senderType: "AUTOMATION",
        noticeType: "UNANSWERED_HANDOFF",
        content: texto,
        ...(motivoSinEnvio !== null
          ? { deliveryStatus: "FAILED" as const, deliveryError: motivoSinEnvio }
          : { deliveryStatus: "PENDING" as const }),
      },
      tx,
    );
    await updateConversation(id, organizationId, { lastMessageAt: creado.createdAt }, tx);
    if (motivoSinEnvio !== null) {
      logger.warn(
        { organizationId, conversationId: id, motivo: motivoSinEnvio, automatico: actor === null },
        "Devuelta al agente sin respuesta de una persona: el aviso al cliente no se envió",
      );
    }
    return { mensaje: creado, enviar: motivoSinEnvio === null };
  });

  if (aviso?.enviar && destino && !("motivo" in destino)) {
    await enviarPorElCanal(aviso.mensaje, destino, deps);
  }
}

// La tarea cuando la derivación no dejó ninguna abierta (no había vendedor, o
// ya la completaron sin escribirle al cliente): para un ADMIN activo, con el
// contacto, para que alguien lo llame. Sin actor (el aviso automático), el
// autor es el mismo ADMIN al que se le asigna.
async function crearTareaSinRespuesta(actor: Actor | null, conversation: Conversation, tx: Db) {
  const { organizationId, contactId } = conversation;
  // R20 (docs/rubros.md §11.4): en una clínica, la tarea es de la sede de la
  // conversación y va a su Recepción; si la sede no tiene, lo de siempre. En
  // una automotora `clinica` es null y nada cambia.
  const clinica = await avisoDeRecepcion(organizationId, conversation.branchId, tx);
  const adminId =
    clinica?.recepcionistaId ?? (await findAdminParaLaTarea(organizationId, actor, tx));
  if (!adminId) {
    logger.warn(
      { organizationId, conversationId: conversation.id, contactId },
      "Devuelta al agente sin respuesta y sin un ADMIN activo: no se crea la tarea",
    );
    return;
  }
  const contacto = await findContactById(contactId, organizationId, tx);
  const nombre = contacto ? `${contacto.firstName} ${contacto.lastName}`.trim() : "el contacto";
  await createActivity(
    {
      organizationId,
      authorId: actor?.userId ?? adminId,
      type: "TASK",
      assigneeId: adminId,
      companyId: null,
      contactId,
      opportunityId: null,
      subject: asuntoDeTareaSinRespuesta(nombre),
      ...(clinica ? { branchId: clinica.branchId } : {}),
    },
    tx,
  );
}
