import { ConversationChannel, type Conversation, type Message } from "@prisma/client";
import { env } from "../config/env";
import { logger } from "../lib/logger";
import { aplicarEstadosRetenidos } from "../services/estadosDeEntregaRetenidos.service";
import { prisma } from "../lib/prisma";
import {
  claimNextAgentInboundJob,
  findAgentInboundJobById,
  findPendingInboundMessages,
  MOTIVO_CONVERSACION_CERRADA,
  markAgentInboundJobDone,
  markAgentInboundJobFailed,
  markAgentInboundJobsCovered,
  renewAgentInboundJobLease,
  rescheduleAgentInboundJob,
  setAgentInboundJobResponse,
  type EntrantePendiente,
  type JobReclamado,
} from "../repositories/agentInboundJob.repository";
import { findAgentById } from "../repositories/agent.repository";
import { findConversationById, updateConversation } from "../repositories/conversation.repository";
import {
  createMessage,
  findMessageById,
  markMessageDelivery,
} from "../repositories/message.repository";
import {
  agenteAtiendeElCanal,
  cargarAgenteYContacto,
  derivarEntranteSinAgente,
  conLockDeConversacion,
  humanoAtiendeLaConversacion,
  responderEnLaConversacion,
} from "../services/agentOrchestration.service";
import { enviarEnPartes } from "../services/envioEnPartes";
import type { LlmContentPart } from "../services/llmProvider.service";
import {
  marcarTokenRechazado,
  obtenerTokenParaEnviar,
} from "../services/metaPageConnection.service";
import { MetaSendError, sendMetaTextReal, type SendMetaText } from "../services/metaSend.service";
import {
  downloadWhatsappMediaReal,
  sendWhatsappTextReal,
  WhatsappGraphError,
  type DownloadWhatsappMedia,
  type SendWhatsappText,
} from "../services/whatsappGraph.service";
import {
  RESPUESTA_TIPO_NO_SOPORTADO,
  esEntranteNoSoportado,
} from "../services/whatsappWebhook.service";
import { AppError } from "../utils/AppError";
import { describirError, resolverFalloDelJob, type ClaseDeFallo } from "../utils/backoff";
import { cupoDeTurnosPorDefecto, maximoPorGrupoPorDefecto } from "../utils/limitadorDeTurnos";

// ---------------------------------------------------------------------------
// El worker de la cola del webhook de WhatsApp (ítem 125 de
// docs/auditoria-2026-09-24-punta-a-punta.md: D-01, B-02, B-08). El webhook
// persiste el entrante y encola un AgentInboundJob; esto corre el turno del
// agente, manda la respuesta por la Graph API y deja el resultado en la fila.
// Desde el ítem 172 también atiende Messenger e Instagram (el webhook del
// ítem 171 encola en la misma cola): mismo turno, y el envío va por el Send
// API con el Page token de la organización (ver enviarPorElCanal).
//
// MISMO PATRÓN QUE src/workers/ingestionWorker.ts (polling in-process,
// setTimeout encadenado, arranque en server.ts, stop que espera la pasada en
// curso), con una diferencia de fondo que viene del trabajo: acá cada job es
// un turno del LLM de segundos a minutos, así que el trabajo NO corre dentro
// de la transacción del reclamo. El job se reclama en PROCESSING con un lease
// que un latido renueva mientras el turno corre; si el proceso muere, el lease
// vence y otro worker lo retoma (ver agentInboundJob.repository.ts).
//
// QUÉ SE REINTENTA, con el criterio de siempre: lo que puede salir bien la
// próxima vez. El proveedor de LLM caído NO llega acá —el turno ya lo
// convierte en una derivación con respuesta fija (ítem 120)—, así que lo que
// llega es la base que no respondió, un bug, o el envío por la Graph API. Un
// AppError de 4xx (el agente se desactivó entre el webhook y el turno) y un
// 4xx de Meta (token vencido, fuera de la ventana de 24 h) son permanentes:
// reintentarlos solo agrega demora al FAILED. Para Meta el corte es el mismo
// esTransitorio que usa el proveedor de LLM.
//
// UN REINTENTO NUNCA REPITE UNA RESPUESTA YA ESCRITA: el turno registra su
// Message saliente en el job (responseMessageId) antes de mandarlo, así que si
// lo que falló fue el envío, el siguiente intento reenvía ese mismo Message en
// vez de correr otro turno. Lo que SÍ puede repetirse es un turno que se cortó
// a mitad (el proceso murió después de ejecutar tools y antes de escribir la
// respuesta): es el costo aceptado de no perder el mensaje, el mismo que el
// ítem 120 ya describe para el reintento de un turno entero.
// ---------------------------------------------------------------------------

// Todo lo que el worker le pide a Meta: mandar la respuesta y, desde el ítem
// 162, bajar el audio de un entrante antes del turno.
export interface DepsDeEnvio {
  accessToken: () => string | undefined;
  sendText: SendWhatsappText;
  downloadMedia: DownloadWhatsappMedia;
  // Ítem 172, Messenger e Instagram. El token de página es el equivalente de
  // accessToken() para WhatsApp, pero por organización y cifrado en la base:
  // inyectable por el mismo motivo, que los unitarios no necesiten Postgres.
  pageAccessToken: (organizationId: string, pageId: string) => Promise<string>;
  sendMetaText: SendMetaText;
}

export const depsDeEnvioReales: DepsDeEnvio = {
  accessToken: () => env.WHATSAPP_ACCESS_TOKEN,
  sendText: sendWhatsappTextReal,
  downloadMedia: downloadWhatsappMediaReal,
  pageAccessToken: obtenerTokenParaEnviar,
  sendMetaText: sendMetaTextReal,
};

const NOMBRE_DEL_CANAL: Record<ConversationChannel, string> = {
  WHATSAPP: "WhatsApp",
  MESSENGER: "Messenger",
  INSTAGRAM: "Instagram",
  WEB: "la web",
};

// Un fallo que no se arregla reintentando, sin ser un AppError: un job que
// apunta a datos que ya no están.
export class ErrorPermanenteDelJob extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ErrorPermanenteDelJob";
    Object.setPrototypeOf(this, ErrorPermanenteDelJob.prototype);
  }
}

// El envío por la Graph API falló. Lleva la causa para poder clasificarla, y
// existe como tipo propio para que la respuesta ya escrita no se confunda con
// un turno que falló: el Message saliente ya quedó marcado FAILED.
export class ErrorDeEnvio extends Error {
  readonly causa: unknown;

  constructor(causa: unknown, canal: ConversationChannel = ConversationChannel.WHATSAPP) {
    super(
      `No se pudo mandar la respuesta por ${NOMBRE_DEL_CANAL[canal]}: ${describirError(causa)}`,
    );
    this.name = "ErrorDeEnvio";
    this.causa = causa;
    Object.setPrototypeOf(this, ErrorDeEnvio.prototype);
  }
}

// No se pudo bajar de Meta el audio de un entrante (ítem 162). Tipo propio por
// el mismo motivo que ErrorDeEnvio: la causa se clasifica con el corte de la
// Graph API. Sin token, o sin respuesta de Meta (red, timeout), la causa no es
// un WhatsappGraphError y el job se reintenta — nunca se descarta un audio
// por un problema de configuración que se arregla cargando la variable.
export class ErrorDeDescarga extends Error {
  readonly causa: unknown;

  constructor(causa: unknown) {
    super(`No se pudo bajar el audio del cliente de WhatsApp: ${describirError(causa)}`);
    this.name = "ErrorDeDescarga";
    this.causa = causa;
    Object.setPrototypeOf(this, ErrorDeDescarga.prototype);
  }
}

// Pura, para poder probarla sin base: qué errores vale la pena reintentar.
export function clasificarFallo(err: unknown): ClaseDeFallo {
  if (err instanceof ErrorPermanenteDelJob) {
    return "PERMANENTE";
  }
  // Un AppError operacional de 4xx es una regla de negocio que dijo que no
  // (agente desactivado, sin el canal, contacto borrado): no va a cambiar de
  // opinión en 15 segundos. Un 5xx sí puede ser pasajero.
  if (err instanceof AppError && err.statusCode < 500) {
    return "PERMANENTE";
  }
  if (
    (err instanceof ErrorDeEnvio || err instanceof ErrorDeDescarga) &&
    err.causa instanceof WhatsappGraphError
  ) {
    // OPUS-D-01: `transitorio` mira también el código, porque Meta manda los
    // límites de envío de WhatsApp con HTTP 400.
    return err.causa.transitorio ? "TRANSITORIO" : "PERMANENTE";
  }
  // Ítem 172: el Send API de Messenger/Instagram. No alcanza el status: Meta
  // manda los rate limits (4, 613) con un 400, así que MetaSendError mira
  // también el código (ver metaSend.service.ts). Fuera de la ventana de 24 h
  // (10/2018278), token inválido (190), usuario que no recibe (551): 4xx sin
  // código transitorio, PERMANENTES.
  if (err instanceof ErrorDeEnvio && err.causa instanceof MetaSendError) {
    return err.causa.transitorio ? "TRANSITORIO" : "PERMANENTE";
  }
  // Red, timeout, la base que no responde, un bug: se reintenta, y el tope de
  // intentos es lo que evita que un bug determinístico gire para siempre.
  return "TRANSITORIO";
}

// resolverFalloDelJob y sus tipos viven en utils/backoff.ts desde el ítem 159
// (la cola de seguimientos con QR usa la misma decisión); se reexportan acá
// para que los consumidores y los tests de siempre no cambien.
export { resolverFalloDelJob, type ClaseDeFallo, type ResolucionDelFallo } from "../utils/backoff";

// "respondido": el turno corrió (o se reenvió su respuesta) y el job quedó
// DONE — incluye el caso en que el agente no contesta porque una persona ya
// escribió en el hilo. "omitido": cuando este worker consiguió el lock de la
// conversación, el job ya no era suyo (lo cerró el turno de otro entrante que
// lo respondió junto, o lo retomó otro worker).
export type ResultadoDelJob = "respondido" | "omitido";

function esCanalDeMeta(channel: ConversationChannel): boolean {
  return channel === ConversationChannel.MESSENGER || channel === ConversationChannel.INSTAGRAM;
}

// Ítem 172: el Page token de un job de Messenger o Instagram, o null para
// WhatsApp (que lee el suyo del entorno al mandar). Se resuelve ANTES del
// turno: sin conexión, con la conexión caída, o si la organización reconectó
// a otra página (el PSID/IGSID del job es de la anterior), el AppError de 4xx
// sale PERMANENTE sin gastar un turno del LLM ni escribir una respuesta que
// nadie va a recibir. El entrante queda en la bandeja y el job en FAILED con
// el motivo.
export async function resolverTokenDePagina(
  job: JobReclamado,
  deps: Pick<DepsDeEnvio, "pageAccessToken">,
): Promise<string | null> {
  if (!esCanalDeMeta(job.channel)) {
    return null;
  }
  return deps.pageAccessToken(job.organizationId, job.channelAccountId);
}

// Pura respecto de la base: despacha el texto por la API del canal del job.
// WhatsApp: exactamente lo de siempre. Messenger e Instagram: el mismo POST
// del Send API, que no distingue canal (ver metaSend.service.ts), con el Page
// ID en channelAccountId y el PSID/IGSID en externalUserId (ítem 171).
//
// Devuelve el wamid de WhatsApp (WA-1), o null: Messenger e Instagram no
// tienen statuses que seguir por este camino.
//
// OPUS-B-02 / FABLE-B-05 (docs-privados, local): un texto más largo que el
// tope del canal sale en varios mensajes seguidos (enviarEnPartes). Antes
// salía entero, Messenger e Instagram lo rechazaban y el cliente no recibía
// nada.
export async function enviarPorElCanal(
  job: JobReclamado,
  mensaje: { id: string; content: string },
  pageAccessToken: string | null,
  deps: Pick<DepsDeEnvio, "accessToken" | "sendText" | "sendMetaText">,
): Promise<string | null> {
  if (esCanalDeMeta(job.channel)) {
    if (!pageAccessToken) {
      // resolverTokenDePagina corre antes y no devuelve null para estos
      // canales: llegar acá es un bug, no un estado de la conexión.
      throw new Error(`Falta el token de página para mandar por ${job.channel}`);
    }
    await enviarEnPartes(mensaje, job.channel, (texto) =>
      deps.sendMetaText({ pageAccessToken, recipientId: job.externalUserId, text: texto }),
    );
    return null;
  }
  const accessToken = deps.accessToken();
  if (!accessToken) {
    throw new Error("Falta WHATSAPP_ACCESS_TOKEN en el entorno");
  }
  const { wamid } = await enviarEnPartes(mensaje, job.channel, (texto) =>
    deps.sendText({
      phoneNumberId: job.channelAccountId,
      to: job.externalUserId,
      body: texto,
      accessToken,
    }),
  );
  return wamid;
}

async function enviarRespuesta(
  saliente: Message,
  job: JobReclamado,
  pageAccessToken: string | null,
  deps: DepsDeEnvio,
) {
  let wamid: string | null;
  try {
    wamid = await enviarPorElCanal(job, saliente, pageAccessToken, deps);
  } catch (err) {
    // B-02: el fallo queda en la fila del Message, a la vista de la bandeja,
    // y no solo en el log. Si el reintento sale bien, SENT lo limpia.
    await markMessageDelivery(saliente.id, job.organizationId, {
      status: "FAILED",
      error: describirError(err),
    });
    if (err instanceof MetaSendError && err.tokenInvalido) {
      // Meta rechazó el Page token: la conexión pasa a ERROR para que el CRM
      // pida reconectar y los próximos jobs fallen antes del turno. Si esta
      // escritura falla, igual se relanza el error del envío, que es el que
      // decide el destino del job.
      await marcarTokenRechazado(
        job.organizationId,
        job.channelAccountId,
        `Meta rechazó el token de la página al mandar un mensaje: ${err.detalle}`,
      ).catch((errMarca: unknown) => {
        logger.error(
          { err: errMarca, organizationId: job.organizationId },
          "No se pudo marcar en ERROR la conexión con Facebook",
        );
      });
    }
    throw new ErrorDeEnvio(err, job.channel);
  }
  // WA-1: con el wamid, así los statuses de Meta (entregado, leído) la
  // encuentran igual que a las plantillas de F1.
  await markMessageDelivery(saliente.id, job.organizationId, {
    status: "SENT",
    externalMessageId: wamid,
  });
  // D-15 (docs-privados/auditoria-2026-09-30-corta.md, local): un estado que
  // Meta mandó antes de que el wamid quedara guardado estaba retenido.
  if (wamid) {
    await aplicarEstadosRetenidos(job.organizationId, wamid);
  }
}

// El job guarda el mime y no el tipo de mensaje de WhatsApp: las columnas
// mediaId/mediaType son genéricas (ítem 162). Hoy el webhook solo encola con
// mediaId a los audios y a las imágenes, así que todo lo que no es image/*
// es audio.
function tipoDeAdjunto(mimeType: string): "image" | "audio" {
  return mimeType.trim().toLowerCase().startsWith("image/") ? "image" : "audio";
}

// Ítem 162: baja de Meta el media (audio, o imagen desde el ítem 163) de cada
// entrante pendiente que lo tiene, para pasárselo al turno. TODOS los
// pendientes y no solo el de este job: en una ráfaga, el turno de este job
// responde también los otros (y cierra sus jobs), así que tiene que
// escucharlos (o verlos) a todos.
//
// En memoria y solo por este turno: el media no se guarda en ningún lado. Un
// reintento lo vuelve a bajar por su mediaId, que no vence.
export async function descargarAdjuntos(
  pendientes: EntrantePendiente[],
  deps: Pick<DepsDeEnvio, "accessToken" | "downloadMedia">,
): Promise<Map<string, LlmContentPart>> {
  const adjuntos = new Map<string, LlmContentPart>();
  for (const pendiente of pendientes) {
    if (pendiente.mediaId === null) {
      continue;
    }
    try {
      const accessToken = deps.accessToken();
      if (!accessToken) {
        throw new Error("Falta WHATSAPP_ACCESS_TOKEN en el entorno");
      }
      const media = await deps.downloadMedia({ mediaId: pendiente.mediaId, accessToken });
      const mimeType = pendiente.mediaType ?? media.mimeType;
      adjuntos.set(pendiente.messageId, {
        type: tipoDeAdjunto(mimeType),
        data: media.data.toString("base64"),
        mimeType,
      });
    } catch (err) {
      throw new ErrorDeDescarga(err);
    }
  }
  return adjuntos;
}

// El turno del modelo sobre un entrante (lo que procesarJob hacía en línea
// hasta B-09). Devuelve el id del saliente ya atado al job en PENDING, o null
// si el agente no contesta porque una persona atiende el hilo.
async function correrElTurno(
  job: JobReclamado,
  texto: string,
  conversacionActual: Conversation,
  agent: Awaited<ReturnType<typeof cargarAgenteYContacto>>["agent"],
  contact: Awaited<ReturnType<typeof cargarAgenteYContacto>>["contact"],
  deps: DepsDeEnvio,
): Promise<string | null> {
  const { organizationId } = job;
  const entrantesPendientes = await findPendingInboundMessages(
    organizationId,
    conversacionActual.id,
  );
  const pendientes = entrantesPendientes.map((p) => p.messageId);
  const adjuntos = await descargarAdjuntos(entrantesPendientes, deps);

  const respuesta = await responderEnLaConversacion(
    { agent, contact, conversation: conversacionActual, texto },
    { entrantesPendientes: pendientes, adjuntos },
  );

  // La ráfaga: los otros entrantes pendientes que el modelo tuvo en su
  // ventana quedaron respondidos por ESTE turno. Sus jobs se cierran para que
  // no corran un turno cada uno sobre un historial que ya termina en la
  // respuesta.
  const vistos = new Set(respuesta.mensajesVistos);
  const cubiertos = pendientes.filter((id) => id !== job.messageId && vistos.has(id));
  if (cubiertos.length > 0) {
    await markAgentInboundJobsCovered(organizationId, cubiertos);
  }

  if (respuesta.salienteId === null) {
    return null;
  }
  await atarRespuestaAlJob(job, respuesta.salienteId);
  return respuesta.salienteId;
}

// B-09 residual: la respuesta fija a un tipo que el agente no interpreta, como
// un saliente AGENT más (el cliente la recibe del número del negocio, igual
// que las del agente), atada al job en PENDING.
async function registrarRespuestaFija(
  conversacionActual: Conversation,
  job: JobReclamado,
): Promise<string> {
  const saliente = await createMessage({
    organizationId: job.organizationId,
    conversationId: conversacionActual.id,
    direction: "OUTBOUND",
    senderType: "AGENT",
    content: RESPUESTA_TIPO_NO_SOPORTADO,
  });
  await updateConversation(conversacionActual.id, job.organizationId, {
    lastMessageAt: saliente.createdAt,
  });
  await atarRespuestaAlJob(job, saliente.id);
  return saliente.id;
}

// El saliente queda atado al job ANTES de mandarlo (ítem 125): si el envío
// falla, el reintento reenvía este mismo mensaje en vez de producir otro.
async function atarRespuestaAlJob(job: JobReclamado, salienteId: string) {
  await prisma.$transaction(async (tx) => {
    await setAgentInboundJobResponse(job, salienteId, tx);
    await markMessageDelivery(salienteId, job.organizationId, { status: "PENDING" }, tx);
  });
}

export async function procesarJob(job: JobReclamado, deps: DepsDeEnvio): Promise<ResultadoDelJob> {
  const { organizationId } = job;

  // DÓNDE SE VA EL TIEMPO de una respuesta (05/10/2026: "el agente tarda más
  // de un minuto por Messenger"). Se mide cada tramo y se loguea al terminar,
  // para que el desglose se lea en los logs de producción sin instrumentar
  // nada más: la espera en la cola (desde que el webhook encoló hasta este
  // reclamo: el sondeo del worker y los carriles ocupados), la espera por el
  // lock de la conversación, el turno (casi todo es el modelo) y el envío.
  const reclamadoEn = Date.now();
  const tiempos = {
    esperaEnColaMs: reclamadoEn - job.createdAt.getTime(),
    esperaDelLockMs: 0,
    turnoMs: 0,
    envioMs: 0,
  };

  // Ítem 172 (reemplaza la guarda transitoria del 171): ver resolverTokenDePagina.
  const pageAccessToken = await resolverTokenDePagina(job, deps);

  const entrante = await findMessageById(job.messageId, organizationId);
  if (!entrante) {
    throw new ErrorPermanenteDelJob("El Message entrante del job ya no existe");
  }
  const conversacion = await findConversationById(entrante.conversationId, organizationId);
  if (!conversacion) {
    throw new ErrorPermanenteDelJob("La conversación del Message entrante ya no existe");
  }

  // Ítem 126: el turno corre con el lock de la conversación tomado, igual que
  // el del canal Web. Dos jobs del mismo contacto —en este proceso o en otra
  // instancia— nunca corren a la vez.
  const clave = {
    agentId: conversacion.agentId,
    contactId: conversacion.contactId,
    channel: conversacion.channel,
    organizationId,
  };
  return conLockDeConversacion(clave, async () => {
    tiempos.esperaDelLockMs = Date.now() - reclamadoEn;
    // Releído BAJO el lock: mientras este worker esperaba, el turno de otro
    // entrante de la ráfaga pudo haber respondido este también y cerrado el
    // job (markAgentInboundJobsCovered), u otro worker pudo haberlo retomado
    // con el lease vencido.
    const vigente = await findAgentInboundJobById(job.id, organizationId);
    if (!vigente || vigente.status !== "PROCESSING" || vigente.attempts !== job.attempts) {
      return "omitido";
    }

    let salienteId = vigente.responseMessageId;
    if (salienteId === null) {
      // OPUS-I-01 (docs-privados/auditoria-2026-10-04-OPUS.md, local): el
      // agente se apagó (o perdió el canal) entre el webhook y este turno.
      // Antes el job terminaba FAILED y el mensaje quedaba sin marcar; ahora
      // la conversación pasa a una persona, igual que si hubiera llegado con
      // el agente ya apagado.
      const agenteDelJob = await findAgentById(clave.agentId, organizationId);
      if (agenteDelJob && !agenteAtiendeElCanal(agenteDelJob, clave.channel)) {
        await derivarEntranteSinAgente({ organizationId, conversationId: conversacion.id });
        await markAgentInboundJobDone(job);
        return "respondido";
      }
      const { agent, contact } = await cargarAgenteYContacto(
        organizationId,
        clave.agentId,
        clave.contactId,
        clave.channel,
      );
      // También releída bajo el lock: un turno anterior pudo haberla derivado.
      const conversacionActual =
        (await findConversationById(conversacion.id, organizationId)) ?? conversacion;
      // B-16 (docs-privados/auditoria-2026-09-30-corta.md, local): un vendedor
      // la cerró mientras el job esperaba. No se corre un turno sobre una
      // conversación cerrada; el entrante queda en la bandeja.
      if (conversacionActual.status === "CLOSED") {
        throw new ErrorPermanenteDelJob(MOTIVO_CONVERSACION_CERRADA);
      }
      // B-09 residual (docs-privados/auditoria-2026-09-24-punta-a-punta.md,
      // local): un video, documento, sticker o contacto compartido no pasa
      // por el modelo. El cliente recibe la respuesta fija y las dos cosas
      // quedan en la conversación. Si una persona atiende el hilo, tampoco
      // esto: el agente no habla.
      if (job.channel === ConversationChannel.WHATSAPP && esEntranteNoSoportado(entrante.content)) {
        if (await humanoAtiendeLaConversacion(conversacionActual)) {
          await markAgentInboundJobDone(job);
          return "respondido";
        }
        salienteId = await registrarRespuestaFija(conversacionActual, job);
      } else {
        const inicioDelTurno = Date.now();
        salienteId = await correrElTurno(
          job,
          entrante.content,
          conversacionActual,
          agent,
          contact,
          deps,
        );
        tiempos.turnoMs = Date.now() - inicioDelTurno;
        if (salienteId === null) {
          // Una persona ya escribió en el hilo (ítem 83), antes del turno o
          // mientras el modelo pensaba (la carrera, ver
          // responderEnLaConversacion): el entrante quedó registrado y el
          // agente se calla. No hay nada que mandar.
          await markAgentInboundJobDone(job);
          logger.info(
            { jobId: job.id, channel: job.channel, ...tiempos },
            "Turno del agente sin respuesta: atiende una persona",
          );
          return "respondido";
        }
      }
    }

    const saliente = await findMessageById(salienteId, organizationId);
    if (!saliente) {
      throw new ErrorPermanenteDelJob("El Message de la respuesta ya no existe");
    }
    if (saliente.deliveryStatus !== "SENT") {
      // I-03 (docs-privados/auditoria-2026-09-24-punta-a-punta.md, local): un
      // reintento de envío que llega DESPUÉS de que un vendedor tomó el hilo
      // desde el CRM no manda la respuesta vieja del agente encima de la suya.
      // Queda en la bandeja con su FAILED/PENDING, como registro de lo que el
      // agente iba a decir.
      const conversacionAlEnviar = await findConversationById(conversacion.id, organizationId);
      if (
        saliente.senderType === "AGENT" &&
        conversacionAlEnviar &&
        (await humanoAtiendeLaConversacion(conversacionAlEnviar))
      ) {
        await markAgentInboundJobDone(job);
        return "respondido";
      }
      const inicioDelEnvio = Date.now();
      await enviarRespuesta(saliente, job, pageAccessToken, deps);
      tiempos.envioMs = Date.now() - inicioDelEnvio;
    }

    await markAgentInboundJobDone(job);
    logger.info(
      {
        jobId: job.id,
        channel: job.channel,
        organizationId,
        conversationId: conversacion.id,
        ...tiempos,
        totalMs: Date.now() - job.createdAt.getTime(),
      },
      "Turno del agente respondido: desglose de tiempos",
    );
    return "respondido";
  });
}

export interface ResumenDrenado {
  respondidos: number;
  omitidos: number;
  // Fallaron con un error transitorio y quedaron en PENDING con su próximo
  // intento programado por backoff.
  pospuestos: number;
  // Pasaron a FAILED: error permanente o reintentos agotados. Es lo único de
  // esta cola que nadie va a reintentar solo.
  fallidos: number;
}

export interface OpcionesDrenado {
  limite?: number;
  // Acota el drenado a una organización (o a varias). Producción no lo usa;
  // los tests de integración sí, para no depender de que el resto de la tabla
  // esté vacía.
  organizationId?: string | string[];
  deps?: DepsDeEnvio;
  leaseMs?: number;
  // Cuántos jobs corren a la vez. Producción: AGENT_INBOUND_WORKER_CONCURRENCY
  // o el cupo de turnos del proceso.
  concurrencia?: number;
  // Consultado antes de cada reclamo: el stop del worker lo pone en false para
  // que la pasada en curso no tome jobs nuevos. A diferencia de la ingesta, acá
  // un job puede tardar minutos, y esperar el lote entero haría que el apagado
  // siempre agote SHUTDOWN_TIMEOUT_MS.
  debeSeguir?: () => boolean;
}

async function registrarFallo(job: JobReclamado, err: unknown, resumen: ResumenDrenado) {
  const lastError = describirError(err);
  const resolucion = resolverFalloDelJob(job.attempts, clasificarFallo(err), new Date(), {
    maxIntentos: env.AGENT_INBOUND_MAX_ATTEMPTS,
    backoff: {
      baseMs: env.AGENT_INBOUND_BACKOFF_BASE_MS,
      topeMs: env.AGENT_INBOUND_BACKOFF_MAX_MS,
    },
  });

  try {
    if (resolucion.estado === "FAILED") {
      await markAgentInboundJobFailed(job, lastError);
      resumen.fallidos++;
      logger.error(
        {
          err,
          jobId: job.id,
          channel: job.channel,
          messageId: job.messageId,
          attempts: job.attempts,
        },
        "Turno del agente en FAILED: el cliente no recibió respuesta y requiere revisión manual",
      );
      return;
    }
    await rescheduleAgentInboundJob(job, { nextAttemptAt: resolucion.nextAttemptAt, lastError });
    resumen.pospuestos++;
    logger.warn(
      {
        err,
        jobId: job.id,
        channel: job.channel,
        attempts: job.attempts,
        nextAttemptAt: resolucion.nextAttemptAt,
      },
      "Turno del agente fallido: queda en PENDING para reintentar con backoff",
    );
  } catch (errContable) {
    // La base es justamente lo que falló: el job queda en PROCESSING y el
    // lease vencido lo devuelve a la cola, con el intento ya contado.
    logger.error(
      { err: errContable, jobId: job.id },
      "No se pudo registrar el fallo del turno del agente; se retoma cuando venza el lease",
    );
  }
}

// Cada cuánto vuelve a mirar la cola un carril libre mientras otro trabaja.
const ESPERA_DEL_CARRIL_LIBRE_MS = 250;

export async function drenarTurnosPendientes(
  opciones: OpcionesDrenado = {},
): Promise<ResumenDrenado> {
  const limite = opciones.limite ?? env.AGENT_INBOUND_WORKER_BATCH_SIZE;
  const deps = opciones.deps ?? depsDeEnvioReales;
  const leaseMs = opciones.leaseMs ?? env.AGENT_INBOUND_LEASE_MS;
  const resumen: ResumenDrenado = { respondidos: 0, omitidos: 0, pospuestos: 0, fallidos: 0 };
  // Mismo rol que en la ingesta: que la pasada no vuelva a elegir el job que
  // acaba de fallar si el backoff configurado fuera muy corto.
  const pospuestos: string[] = [];

  // -------------------------------------------------------------------------
  // CARRILES (FABLE-G-03 de docs-privados/auditoria-2026-10-05-FABLE.md,
  // local). Antes la pasada tomaba un job, corría su turno entero —hasta
  // minuto y medio— y recién después miraba el siguiente: un turno lento de
  // una organización frenaba los mensajes de todas. Ahora corren hasta
  // `concurrencia` jobs a la vez, y una organización nunca ocupa todos los
  // carriles: mientras tiene su tope en curso, el reclamo saltea sus jobs y
  // toma los de otra. Con un solo carril todo queda como antes.
  //
  // El orden dentro de una conversación no cambia: lo da el lock por
  // conversación, no esta pasada.
  // -------------------------------------------------------------------------
  const concurrencia = Math.max(
    1,
    opciones.concurrencia ??
      env.AGENT_INBOUND_WORKER_CONCURRENCY ??
      env.AGENT_TURN_MAX_CONCURRENT ??
      cupoDeTurnosPorDefecto(env.DATABASE_URL),
  );
  const topePorOrganizacion = maximoPorGrupoPorDefecto(concurrencia);
  const enCursoPorOrganizacion = new Map<string, number>();
  let reclamados = 0;
  let cortar = false;
  // Los reclamos van de a uno: elegir qué organizaciones saltear y anotar la
  // del job reclamado tiene que ser un solo paso, o dos carriles tomarían a la
  // vez dos jobs de una organización que ya estaba en su tope.
  let turnoDeReclamo: Promise<unknown> = Promise.resolve();

  const reclamar = (): Promise<JobReclamado | null> => {
    const intento = turnoDeReclamo.then(async () => {
      if (cortar || reclamados >= limite || (opciones.debeSeguir && !opciones.debeSeguir())) {
        return null;
      }
      const alTope = [...enCursoPorOrganizacion]
        .filter(([, n]) => n >= topePorOrganizacion)
        .map(([organizationId]) => organizationId);
      let job: JobReclamado | null;
      try {
        job = await claimNextAgentInboundJob(leaseMs, {
          organizationId: opciones.organizationId,
          excluir: pospuestos,
          excluirOrganizaciones: alTope,
        });
      } catch (err) {
        // No se llegó a reclamar nada (la base no responde): se corta la
        // pasada y se reintenta en el próximo tick.
        logger.error({ err }, "No se pudo reclamar un turno del agente de la cola");
        cortar = true;
        return null;
      }
      if (job) {
        reclamados++;
        enCursoPorOrganizacion.set(
          job.organizationId,
          (enCursoPorOrganizacion.get(job.organizationId) ?? 0) + 1,
        );
      }
      return job;
    });
    turnoDeReclamo = intento.catch(() => undefined);
    return intento;
  };

  const liberar = (organizationId: string) => {
    const quedan = (enCursoPorOrganizacion.get(organizationId) ?? 1) - 1;
    if (quedan <= 0) {
      enCursoPorOrganizacion.delete(organizationId);
    } else {
      enCursoPorOrganizacion.set(organizationId, quedan);
    }
  };

  // Jobs corriendo ahora mismo, entre todos los carriles.
  let enCurso = 0;

  const carril = async () => {
    for (;;) {
      const job = await reclamar();
      if (!job) {
        // Nada para tomar AHORA. Si otro carril sigue con un turno, este no se
        // va: mientras ese turno corre puede llegar el mensaje de otra
        // organización, y es justo lo que este carril tiene que atender. Se
        // vuelve a mirar en un rato. Cuando nadie tiene nada, la pasada termina.
        const puedeHaberMas =
          enCurso > 0 &&
          !cortar &&
          reclamados < limite &&
          (!opciones.debeSeguir || opciones.debeSeguir());
        if (!puedeHaberMas) {
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, ESPERA_DEL_CARRIL_LIBRE_MS));
        continue;
      }
      enCurso++;
      try {
        // Un job que volvió por lease vencido una y otra vez: el proceso muere
        // cada vez que lo toma (o se cuelga más que el lease). attempts subió
        // en cada reclamo, así que esto corta el ciclo sin haber pasado por
        // ningún catch.
        if (job.attempts > env.AGENT_INBOUND_MAX_ATTEMPTS) {
          await markAgentInboundJobFailed(
            job,
            `Agotó sus ${String(env.AGENT_INBOUND_MAX_ATTEMPTS)} intentos sin terminar (el proceso que lo tomaba no llegó a cerrarlo)`,
          ).catch((err: unknown) => {
            logger.error({ err, jobId: job.id }, "No se pudo marcar FAILED un turno del agente");
          });
          resumen.fallidos++;
          continue;
        }

        const latido = setInterval(
          () => {
            renewAgentInboundJobLease(job, leaseMs).catch((err: unknown) => {
              logger.warn({ err, jobId: job.id }, "No se pudo renovar el lease del turno");
            });
          },
          Math.max(1000, Math.floor(leaseMs / 4)),
        );
        // El latido no puede ser lo que mantiene vivo al proceso.
        latido.unref();

        try {
          const resultado = await procesarJob(job, deps);
          if (resultado === "omitido") {
            resumen.omitidos++;
          } else {
            resumen.respondidos++;
          }
        } catch (err) {
          await registrarFallo(job, err, resumen);
          pospuestos.push(job.id);
        } finally {
          clearInterval(latido);
        }
      } finally {
        enCurso--;
        liberar(job.organizationId);
      }
    }
  };

  await Promise.all(Array.from({ length: concurrencia }, () => carril()));

  return resumen;
}

// SOLO PARA TESTS, mismo contrato que OpcionesDelWorker de la ingesta (M-12):
// una cadencia corta y una pasada controlada por el test.
export interface OpcionesDelWorker {
  pollMs?: number;
  drenar?: (debeSeguir: () => boolean) => Promise<ResumenDrenado>;
}

export function iniciarWorkerDeTurnosDeAgente(
  opciones: OpcionesDelWorker = {},
): () => Promise<void> {
  if (!env.AGENT_INBOUND_WORKER_ENABLED) {
    logger.info(
      "Worker de turnos del agente deshabilitado por AGENT_INBOUND_WORKER_ENABLED: los mensajes quedan en la cola",
    );
    return () => Promise.resolve();
  }

  const pollMs = opciones.pollMs ?? env.AGENT_INBOUND_WORKER_POLL_MS;
  const drenar =
    opciones.drenar ?? ((debeSeguir: () => boolean) => drenarTurnosPendientes({ debeSeguir }));

  let detenido = false;
  let timer: NodeJS.Timeout | undefined;
  let tickEnCurso: Promise<void> | undefined;

  const tick = async () => {
    if (detenido) {
      return;
    }

    tickEnCurso = (async () => {
      try {
        const resumen = await drenar(() => !detenido);
        if (resumen.respondidos + resumen.omitidos + resumen.pospuestos + resumen.fallidos > 0) {
          logger.info(resumen, "Drenado de turnos del agente");
        }
        if (resumen.fallidos > 0) {
          // Con nombre propio y en warn, igual que los DEAD_LETTER de las
          // otras colas: un FAILED acá es un cliente sin respuesta.
          logger.warn(
            { fallidos: resumen.fallidos },
            "Turnos del agente en FAILED: clientes sin respuesta que requieren revisión manual",
          );
        }
      } catch (err) {
        // Red de seguridad del bucle, mismo motivo que en la ingesta: si el
        // bucle muere, la cola deja de drenarse en silencio.
        logger.error({ err }, "Fallo inesperado en el drenado de turnos del agente");
      }
    })();

    await tickEnCurso;

    if (!detenido) {
      timer = setTimeout(() => void tick(), pollMs);
    }
  };

  logger.info(
    { pollMs, batchSize: env.AGENT_INBOUND_WORKER_BATCH_SIZE },
    "Worker de turnos del agente iniciado",
  );

  timer = setTimeout(() => void tick(), pollMs);

  return async () => {
    detenido = true;
    if (timer) {
      clearTimeout(timer);
    }
    // Espera al job en curso (el lote ya no toma nuevos: debeSeguir). Si el
    // turno tarda más que SHUTDOWN_TIMEOUT_MS, el shutdown sale igual y el job
    // queda en PROCESSING; sin latido, su lease vence y lo retoma el próximo
    // proceso. Ese es justamente el caso que esta cola vino a cubrir.
    await tickEnCurso;
  };
}
