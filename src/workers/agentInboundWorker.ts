import { ConversationChannel, type Message } from "@prisma/client";
import { env } from "../config/env";
import { logger } from "../lib/logger";
import { prisma } from "../lib/prisma";
import {
  claimNextAgentInboundJob,
  findAgentInboundJobById,
  findPendingInboundMessages,
  markAgentInboundJobDone,
  markAgentInboundJobFailed,
  markAgentInboundJobsCovered,
  renewAgentInboundJobLease,
  rescheduleAgentInboundJob,
  setAgentInboundJobResponse,
  type EntrantePendiente,
  type JobReclamado,
} from "../repositories/agentInboundJob.repository";
import { findConversationById } from "../repositories/conversation.repository";
import { findMessageById, markMessageDelivery } from "../repositories/message.repository";
import {
  cargarAgenteYContacto,
  conLockDeConversacion,
  responderEnLaConversacion,
} from "../services/agentOrchestration.service";
import { esTransitorio, type LlmContentPart } from "../services/llmProvider.service";
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
import { AppError } from "../utils/AppError";
import { describirError, resolverFalloDelJob, type ClaseDeFallo } from "../utils/backoff";

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
    return esTransitorio(err.causa.status) ? "TRANSITORIO" : "PERMANENTE";
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
export async function enviarPorElCanal(
  job: JobReclamado,
  texto: string,
  pageAccessToken: string | null,
  deps: Pick<DepsDeEnvio, "accessToken" | "sendText" | "sendMetaText">,
): Promise<string | null> {
  if (esCanalDeMeta(job.channel)) {
    if (!pageAccessToken) {
      // resolverTokenDePagina corre antes y no devuelve null para estos
      // canales: llegar acá es un bug, no un estado de la conexión.
      throw new Error(`Falta el token de página para mandar por ${job.channel}`);
    }
    await deps.sendMetaText({ pageAccessToken, recipientId: job.externalUserId, text: texto });
    return null;
  }
  const accessToken = deps.accessToken();
  if (!accessToken) {
    throw new Error("Falta WHATSAPP_ACCESS_TOKEN en el entorno");
  }
  const { wamid } = await deps.sendText({
    phoneNumberId: job.channelAccountId,
    to: job.externalUserId,
    body: texto,
    accessToken,
  });
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
    wamid = await enviarPorElCanal(job, saliente.content, pageAccessToken, deps);
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

export async function procesarJob(job: JobReclamado, deps: DepsDeEnvio): Promise<ResultadoDelJob> {
  const { organizationId } = job;

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
  };
  return conLockDeConversacion(clave, async () => {
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
      const { agent, contact } = await cargarAgenteYContacto(
        organizationId,
        clave.agentId,
        clave.contactId,
        clave.channel,
      );
      // También releída bajo el lock: un turno anterior pudo haberla derivado.
      const conversacionActual =
        (await findConversationById(conversacion.id, organizationId)) ?? conversacion;
      const entrantesPendientes = await findPendingInboundMessages(organizationId, conversacion.id);
      const pendientes = entrantesPendientes.map((p) => p.messageId);
      const adjuntos = await descargarAdjuntos(entrantesPendientes, deps);

      const respuesta = await responderEnLaConversacion(
        { agent, contact, conversation: conversacionActual, texto: entrante.content },
        { entrantesPendientes: pendientes, adjuntos },
      );

      // La ráfaga: los otros entrantes pendientes que el modelo tuvo en su
      // ventana quedaron respondidos por ESTE turno. Sus jobs se cierran para
      // que no corran un turno cada uno sobre un historial que ya termina en
      // la respuesta.
      const vistos = new Set(respuesta.mensajesVistos);
      const cubiertos = pendientes.filter((id) => id !== job.messageId && vistos.has(id));
      if (cubiertos.length > 0) {
        await markAgentInboundJobsCovered(organizationId, cubiertos);
      }

      if (respuesta.salienteId === null) {
        // Una persona ya escribió en el hilo (ítem 83): el entrante quedó
        // registrado y el agente se calla. No hay nada que mandar.
        await markAgentInboundJobDone(job);
        return "respondido";
      }

      salienteId = respuesta.salienteId;
      const idDelSaliente = salienteId;
      await prisma.$transaction(async (tx) => {
        await setAgentInboundJobResponse(job, idDelSaliente, tx);
        await markMessageDelivery(idDelSaliente, organizationId, { status: "PENDING" }, tx);
      });
    }

    const saliente = await findMessageById(salienteId, organizationId);
    if (!saliente) {
      throw new ErrorPermanenteDelJob("El Message de la respuesta ya no existe");
    }
    if (saliente.deliveryStatus !== "SENT") {
      await enviarRespuesta(saliente, job, pageAccessToken, deps);
    }

    await markAgentInboundJobDone(job);
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
  // Acota el drenado a una organización. Producción no lo usa; los tests de
  // integración sí, para no depender de que el resto de la tabla esté vacía.
  organizationId?: string;
  deps?: DepsDeEnvio;
  leaseMs?: number;
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

  for (let i = 0; i < limite; i++) {
    if (opciones.debeSeguir && !opciones.debeSeguir()) {
      break;
    }

    let job: JobReclamado | null;
    try {
      job = await claimNextAgentInboundJob(leaseMs, {
        organizationId: opciones.organizationId,
        excluir: pospuestos,
      });
    } catch (err) {
      // No se llegó a reclamar nada (la base no responde): se corta la pasada
      // y se reintenta en el próximo tick.
      logger.error({ err }, "No se pudo reclamar un turno del agente de la cola");
      break;
    }
    if (!job) {
      break;
    }

    // Un job que volvió por lease vencido una y otra vez: el proceso muere
    // cada vez que lo toma (o se cuelga más que el lease). attempts subió en
    // cada reclamo, así que esto corta el ciclo sin haber pasado por ningún
    // catch.
    if (job.attempts > env.AGENT_INBOUND_MAX_ATTEMPTS) {
      await markAgentInboundJobFailed(
        job,
        `Agotó sus ${String(env.AGENT_INBOUND_MAX_ATTEMPTS)} intentos sin terminar (el proceso que lo tomaba no llegó a cerrarlo)`,
      ).catch((err: unknown) => {
        logger.error({ err, jobId: job?.id }, "No se pudo marcar FAILED un turno del agente");
      });
      resumen.fallidos++;
      continue;
    }

    const reclamado = job;
    const latido = setInterval(
      () => {
        renewAgentInboundJobLease(reclamado, leaseMs).catch((err: unknown) => {
          logger.warn({ err, jobId: reclamado.id }, "No se pudo renovar el lease del turno");
        });
      },
      Math.max(1000, Math.floor(leaseMs / 4)),
    );
    // El latido no puede ser lo que mantiene vivo al proceso.
    latido.unref();

    try {
      const resultado = await procesarJob(reclamado, deps);
      if (resultado === "omitido") {
        resumen.omitidos++;
      } else {
        resumen.respondidos++;
      }
    } catch (err) {
      await registrarFallo(reclamado, err, resumen);
      pospuestos.push(reclamado.id);
    } finally {
      clearInterval(latido);
    }
  }

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
