import type { Conversation, Message } from "@prisma/client";
import { env } from "../config/env";
import { logger } from "../lib/logger";
import { prisma, type Db } from "../lib/prisma";
import { createActivity } from "../repositories/activity.repository";
import { findAgentById } from "../repositories/agent.repository";
import { findChannelAccountIdOfConversation } from "../repositories/agentInboundJob.repository";
import { findContactById } from "../repositories/contact.repository";
import {
  findConversationById,
  returnConversationToAgent,
  takeOverConversation,
  updateConversation,
} from "../repositories/conversation.repository";
import {
  createMessage,
  findLastInboundAt,
  findMessageById,
  humanSpokeLast,
  markMessageDelivery,
} from "../repositories/message.repository";
import type { RoleName } from "../types/auth";
import { AppError } from "../utils/AppError";
import { describirError } from "../utils/backoff";
import { finDeLaVentanaDeWhatsapp, ventanaDeWhatsappAbierta } from "../utils/ventanaDeWhatsapp";
import { conLockDeConversacion } from "./agentOrchestration.service";
import { getConversationById } from "./conversation.service";
import {
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
  | { canal: "META"; pageId: string; recipientId: string }
  | { canal: "WEB" };

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
  return { canal: "META", pageId, recipientId: conversation.externalThreadId };
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
      await deps.sendMetaText({
        pageAccessToken,
        recipientId: destino.recipientId,
        text: mensaje.content,
      });
      await markMessageDelivery(mensaje.id, organizationId, { status: "SENT" });
      return;
    }
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
    await devolverYAvisar(vigente, avisar, actor, deps);
  });

  return getConversationById(organizationId, id);
}

export type ResultadoDelAvisoAutomatico = "avisado" | "no-corresponde";

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
    const minutos = agente?.unansweredHandoffNoticeMinutes ?? 0;
    const vence = vigente.transferredToHumanAt.getTime() + minutos * 60_000;
    if (minutos <= 0 || vence > ahora.getTime()) {
      return "no-corresponde";
    }
    if (await humanSpokeLast(conversationId, organizationId)) {
      return "no-corresponde";
    }
    await devolverYAvisar(vigente, true, null, deps);
    return "avisado";
  });
}

// Lo común a devolver a mano y al aviso automático, ya bajo el lock: la
// devolución, y si `avisar`, la tarea y el aviso en la misma transacción; el
// envío por el canal después. `actor` null = lo hizo el sistema.
async function devolverYAvisar(
  vigente: Conversation,
  avisar: boolean,
  actor: Actor | null,
  deps: DepsDeRespuestaHumana,
) {
  const { id, organizationId } = vigente;
  const entrega = entregaDelAviso(
    vigente.channel,
    finDeLaVentanaDeWhatsapp(await findLastInboundAt(id, organizationId)),
  );
  const destino = entrega.tipo === "por-el-canal" ? await destinoDeLaConversacion(vigente) : null;
  // Fuera del horario de la sucursal, el aviso dice cuándo le van a escribir.
  const texto = textoDelAviso(
    avisar
      ? await atencionFueraDeHorarioDeLaSucursal(organizationId, vigente.branchId, new Date())
      : null,
  );

  const aviso = await prisma.$transaction(async (tx) => {
    const devuelta = await returnConversationToAgent(id, organizationId, tx);
    if (devuelta.count !== 1 || !avisar) {
      return null;
    }

    if (!(await findTareaAbiertaDelPedido(organizationId, vigente.contactId, tx))) {
      await crearTareaSinRespuesta(actor, vigente, tx);
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
  const adminId = await findAdminParaLaTarea(organizationId, actor, tx);
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
    },
    tx,
  );
}
