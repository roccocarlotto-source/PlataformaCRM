import { ConversationChannel, Prisma } from "@prisma/client";
import { z } from "zod";
import { logger } from "../lib/logger";
import type { Db } from "../lib/prisma";
import { findAgentByFacebookPageId } from "../repositories/agent.repository";
import { createAgentInboundJob } from "../repositories/agentInboundJob.repository";
import { findMessageByExternalId } from "../repositories/message.repository";
import {
  findActiveMetaConnectionByPageId,
  findPageIdByInstagramBusinessAccountId,
} from "../repositories/metaPageConnection.repository";
import { env } from "../config/env";
import { findContactIdByExternalIdentity } from "../repositories/contactChannelIdentity.repository";
import { esFalloReintentable } from "../utils/falloDeEntrante";
import {
  registrarRespuestaDesdeLaBandejaDeMeta,
  type RespuestaDesdeMeta,
  type ResultadoDeLaRespuestaDesdeMeta,
} from "./conversationReply.service";
import {
  agenteAtiendeElCanal,
  derivarEntranteSinAgente,
  registrarEntrante,
  type RegistrarEntranteInput,
} from "./agentOrchestration.service";
import {
  completarNombreDesdeElPerfil,
  resolveMetaContact,
  type CanalMeta,
  type CompletarNombreInput,
  type ContactoDeMeta,
} from "./metaContact.service";

// ---------------------------------------------------------------------------
// El procesamiento de un POST /webhooks/meta ya verificado (ítem 171, paso 3
// de 5 de los canales de Meta). El calco de whatsappWebhook.service.ts para
// Messenger e Instagram: la firma y el parseo los resolvió la cadena del
// router; esto recorre el lote y, por cada mensaje de TEXTO, resuelve el
// Contact, persiste el Message entrante y ENCOLA el turno en la misma
// transacción. El turno lo corre el mismo worker que WhatsApp
// (src/workers/agentInboundWorker.ts), que desde el ítem 172 también manda la
// respuesta por el Send API de Messenger e Instagram.
//
// SOLO TEXTO, decisión de toda la serie de canales de Meta: imágenes, audio,
// adjuntos, postbacks y reacciones se ignoran sin error, igual que WhatsApp
// ignoraba todo lo que no era texto antes de los ítems 162-164.
//
// Mismos criterios que WhatsApp, por los mismos motivos (ver el encabezado de
// whatsappWebhook.service.ts): un mensaje que falla no tumba el lote ni el
// 200; dedup por mid antes de tocar la base, con el UNIQUE
// (organizationId, externalMessageId) como garantía real; entrante + job en
// la misma transacción (ítem 125).
//
// ---------------------------------------------------------------------------
// VERIFICADO CONTRA LA DOCUMENTACIÓN DE META (27/09/2026), NO ASUMIDO
// ---------------------------------------------------------------------------
//
// 1. Messenger (Messenger Platform > Reference > Webhook Events > messages):
//    object "page"; cada entry trae `id` = "The ID for your Facebook Page", y
//    un array `messaging[]` con sender.id (el PSID), recipient.id (el Page
//    ID), timestamp y message { mid, text, attachments? }. NO usa
//    `changes`/`value` como WhatsApp.
//
// 2. Instagram (Messenger Platform > Instagram > Webhooks, y los ejemplos de
//    Instagram Platform > Webhooks): object "instagram" y LA MISMA forma
//    `entry[].messaging[]` que Messenger. entry.id y recipient.id son el "ID
//    of your Instagram Professional account" (el IGID = el
//    instagram_business_account id que guarda MetaPageConnection), NO el Page
//    ID — por eso Instagram pasa por findPageIdByInstagramBusinessAccountId
//    antes de buscar el agente. sender.id es el IGSID.
//
// 3. La cuenta del negocio se toma de entry.id y no de recipient.id: en un
//    echo recipient es el cliente (se invierten los roles), mientras que
//    entry.id es siempre la cuenta dueña de la suscripción. En un mensaje
//    entrante los dos coinciden.
//
// 4. Echoes: un mensaje que MANDÓ el propio negocio (Send API o a mano desde
//    la bandeja) vuelve con message.is_echo: true, sender = la página/cuenta y
//    recipient = el cliente. En Messenger solo llegan si se suscribe el campo
//    aparte `message_echoes`; en Instagram llegan dentro de `messages`. NUNCA
//    se procesan como entrantes: el agente contestaría sus propias respuestas.
//    Desde OPUS-B-01 (docs-privados/auditoria-2026-10-04-OPUS.md, local) ya
//    no se descartan todos: el eco de lo que una persona escribió desde la
//    bandeja de Meta se registra como respuesta humana (ver procesarEco). Los
//    de lo que mandó este CRM se siguen descartando: traen `app_id` de esta
//    app (Messenger lo manda siempre), y si no, se reconocen por el texto.
//
// 5. Adjuntos: message.attachments[] con { type, payload: { url } } y, si es
//    solo un adjunto, SIN `text` (ni campo `type` a nivel mensaje, a
//    diferencia de WhatsApp). Instagram suma además message.is_deleted y
//    message.is_unsupported, también sin text. Todo eso cae en "sin texto" y
//    se ignora. Eventos que no son un mensaje (read, postback, reaction,
//    referral) vienen en el mismo messaging[] sin `message`: ignorados igual.
// ---------------------------------------------------------------------------

// Forma mínima para contestar 200; todo lo demás se lee con tolerancia, mismo
// criterio que whatsappWebhookPayloadSchema. `messaging` es opcional porque
// otros campos de una página (feed, por ejemplo) llegan con `changes`, e `id`
// también, por las dudas: un entry raro se saltea, no convierte el lote en un
// 400 que Meta reintentaría para siempre.
export const metaWebhookPayloadSchema = z.object({
  object: z.string(),
  entry: z.array(
    z.object({
      id: z.string().optional(),
      messaging: z.array(z.unknown()).optional(),
    }),
  ),
});

export type MetaWebhookPayload = z.infer<typeof metaWebhookPayloadSchema>;

// El fork real del webhook: qué producto de Meta manda el lote.
export function canalDelObjeto(object: string): CanalMeta | null {
  if (object === "page") return ConversationChannel.MESSENGER;
  if (object === "instagram") return ConversationChannel.INSTAGRAM;
  return null;
}

const eventoDeMensajeSchema = z.object({
  sender: z.object({ id: z.string().min(1) }),
  // Solo se usa en un eco, donde es el cliente.
  recipient: z.object({ id: z.string().min(1) }).optional(),
  message: z.object({
    mid: z.string().min(1),
    text: z.string().optional(),
    is_echo: z.boolean().optional(),
    // La app que mandó el mensaje, en un eco. Meta lo manda como número.
    app_id: z.union([z.number(), z.string()]).optional(),
  }),
});

export interface MensajeLeido {
  mid: string;
  // El PSID (Messenger) o IGSID (Instagram) de quien escribe.
  senderId: string;
  texto: string;
}

// Pura, para probar sin base qué se procesa. null = no es un mensaje de texto
// entrante (echo, adjunto, postback, lectura...): se ignora sin error.
export function leerMensaje(crudo: unknown): MensajeLeido | null {
  const parsed = eventoDeMensajeSchema.safeParse(crudo);
  if (!parsed.success) return null;
  const { sender, message } = parsed.data;
  if (message.is_echo === true) return null;
  if (message.text === undefined || message.text.trim().length === 0) return null;
  return { mid: message.mid, senderId: sender.id, texto: message.text.trim() };
}

export interface EcoLeido {
  mid: string;
  // El cliente al que se le escribió: PSID (Messenger) o IGSID (Instagram).
  recipientId: string;
  texto: string;
  // La app que lo mandó, o null si el eco no lo dice.
  appId: string | null;
}

// Pura. null = no es el eco de un mensaje de texto.
export function leerEco(crudo: unknown): EcoLeido | null {
  const parsed = eventoDeMensajeSchema.safeParse(crudo);
  if (!parsed.success) return null;
  const { recipient, message } = parsed.data;
  if (message.is_echo !== true || !recipient) return null;
  if (message.text === undefined || message.text.trim().length === 0) return null;
  return {
    mid: message.mid,
    recipientId: recipient.id,
    texto: message.text.trim(),
    appId: message.app_id === undefined ? null : String(message.app_id),
  };
}

// "eco": la respuesta de una persona desde la bandeja de Meta, registrada.
// Los mismos resultados que whatsappWebhook.service.ts: "derivado" es el
// entrante de un agente apagado o sin el canal, que queda para una persona;
// "fallido" es el que Meta tiene que reintentar y "descartado" el que no.
export type ResultadoDelMensaje =
  "encolado" | "derivado" | "eco" | "duplicado" | "ignorado" | "fallido" | "descartado";
export type ResumenDelLote = Record<ResultadoDelMensaje, number>;

// ¿Hay que pedirle a Meta que reintente el lote? Ver utils/falloDeEntrante.ts.
export function hayQueReintentarElLote(resumen: ResumenDelLote): boolean {
  return resumen.fallido > 0;
}

// Lo que el procesamiento toca afuera, inyectable para probar la DECISIÓN sin
// base (metaWebhook.service.test.ts). Producción usa depsDelWebhookMetaReales;
// el recorrido real contra Postgres lo cubre
// metaWebhook.controller.integration-test.ts.
export interface DepsDelWebhookMeta {
  findPageIdByInstagramBusinessAccountId: (
    instagramBusinessAccountId: string,
  ) => Promise<{ pageId: string; organizationId: string } | null>;
  findActiveMetaConnectionByPageId: (
    pageId: string,
  ) => Promise<{ pageId: string; organizationId: string } | null>;
  findAgentByFacebookPageId: (pageId: string) => Promise<{
    id: string;
    organizationId: string;
    branchId: string;
    isActive: boolean;
    channels: ConversationChannel[];
  } | null>;
  findMessageByExternalId: (
    organizationId: string,
    externalMessageId: string,
  ) => Promise<{ id: string; conversationId: string } | null>;
  resolveMetaContact: (
    organizationId: string,
    channel: CanalMeta,
    externalId: string,
  ) => Promise<ContactoDeMeta>;
  // El nombre real del contacto recién creado, pedido a Meta. Se DISPARA y no
  // se espera (ver el paso 4): no puede lanzar ni frenar el mensaje.
  completarNombreDelContacto: (entrada: CompletarNombreInput) => Promise<unknown>;
  registrarEntrante: (
    input: RegistrarEntranteInput,
    opciones: { enLaMismaTransaccion?: (tx: Db, entrante: { id: string }) => Promise<unknown> },
  ) => Promise<{ conversation: { id: string } }>;
  createAgentInboundJob: (
    data: Parameters<typeof createAgentInboundJob>[0],
    db: Db,
  ) => Promise<unknown>;
  derivarEntranteSinAgente: (entrada: {
    organizationId: string;
    conversationId: string;
  }) => Promise<void>;
  // OPUS-B-01: los ecos. El id de esta app en Meta (META_APP_ID), para
  // descartar los de lo que mandó el CRM; el contacto de un cliente SIN
  // crearlo (un eco no da de alta a nadie); y el registro de la respuesta.
  appId: () => string | undefined;
  findContactIdByExternalIdentity: (identidad: {
    organizationId: string;
    channel: CanalMeta;
    externalId: string;
  }) => Promise<string | null>;
  registrarRespuestaDesdeLaBandejaDeMeta: (
    input: RespuestaDesdeMeta,
  ) => Promise<ResultadoDeLaRespuestaDesdeMeta>;
}

export const depsDelWebhookMetaReales: DepsDelWebhookMeta = {
  findPageIdByInstagramBusinessAccountId: (id) => findPageIdByInstagramBusinessAccountId(id),
  findActiveMetaConnectionByPageId: (pageId) => findActiveMetaConnectionByPageId(pageId),
  findAgentByFacebookPageId: (pageId) => findAgentByFacebookPageId(pageId),
  findMessageByExternalId: (organizationId, mid) => findMessageByExternalId(organizationId, mid),
  resolveMetaContact,
  completarNombreDelContacto: (entrada) => completarNombreDesdeElPerfil(entrada),
  registrarEntrante,
  createAgentInboundJob,
  derivarEntranteSinAgente,
  appId: () => env.META_APP_ID,
  findContactIdByExternalIdentity: (identidad) => findContactIdByExternalIdentity(identidad),
  registrarRespuestaDesdeLaBandejaDeMeta: (input) => registrarRespuestaDesdeLaBandejaDeMeta(input),
};

function esDuplicadoPorIndiceUnico(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

interface MensajeEntrante extends MensajeLeido {
  channel: CanalMeta;
  // entry.id: el Page ID (Messenger) o el IGID (Instagram).
  cuentaId: string;
}

async function procesarMensaje(
  mensaje: MensajeEntrante,
  deps: DepsDelWebhookMeta,
): Promise<ResultadoDelMensaje> {
  const log = logger.child({
    channel: mensaje.channel,
    cuentaId: mensaje.cuentaId,
    mid: mensaje.mid,
  });

  // 1. La página y su conexión vigente (no REVOKED). Messenger trae la página;
  //    Instagram trae su propia cuenta y la página sale de la conexión (ítem
  //    170). Sin conexión, el mensaje no es de ningún negocio de este CRM —
  //    desde D-11 también para Messenger: una página desconectada que Meta
  //    sigue mandando no se registra en ninguna organización.
  const conexion =
    mensaje.channel === ConversationChannel.INSTAGRAM
      ? await deps.findPageIdByInstagramBusinessAccountId(mensaje.cuentaId)
      : await deps.findActiveMetaConnectionByPageId(mensaje.cuentaId);
  if (!conexion) {
    log.warn("Mensaje de Meta para una cuenta sin página conectada");
    return "ignorado";
  }
  const pageId = conexion.pageId;

  // 2. ¿De qué agente es esta página? Mismo criterio que WhatsApp: sin agente
  //    es configuración y no un error del request (una conversación necesita
  //    un agente y su sucursal: sin él no hay dónde guardar el mensaje).
  const agent = await deps.findAgentByFacebookPageId(pageId);
  if (!agent) {
    log.warn({ pageId }, "Mensaje de Meta para una página sin agente asignado");
    return "ignorado";
  }
  // A-08 de docs-privados/auditoria-2026-09-30-corta.md (local): la página
  //    tiene que estar conectada en la MISMA organización que el agente. Sin
  //    esto, una página asignada por error al agente de otra organización
  //    guardaba los mensajes de los clientes de una en la bandeja de la otra.
  if (conexion.organizationId !== agent.organizationId) {
    log.warn(
      { pageId, agentId: agent.id },
      "Mensaje de Meta para una página conectada en otra organización que la del agente",
    );
    return "ignorado";
  }
  // OPUS-I-01 (docs-privados/auditoria-2026-10-04-OPUS.md, local): un agente
  //    apagado o sin el canal ya no descarta el mensaje. Se guarda igual, sin
  //    job, y la conversación queda para una persona (paso 6).
  const atiende = agenteAtiendeElCanal(agent, mensaje.channel);
  const organizationId = agent.organizationId;

  // 3. Dedup: Meta reintentando una entrega ya procesada. Atajo del caso
  //    común; la garantía real es el UNIQUE, más abajo.
  const yaGuardado = await deps.findMessageByExternalId(organizationId, mensaje.mid);
  if (yaGuardado) {
    if (!atiende) {
      await deps.derivarEntranteSinAgente({
        organizationId,
        conversationId: yaGuardado.conversationId,
      });
    }
    return "duplicado";
  }

  // 4. El Contact, por su PSID/IGSID. Si se acaba de crear (con el nombre
  //    genérico), se le pide a Meta el nombre del perfil SIN ESPERARLO: el
  //    webhook tiene que contestar ya (ítem 125) y el mensaje no depende de
  //    ese dato. El .catch es por si un doble de test rechaza: la real no lanza.
  const { contactId, creado } = await deps.resolveMetaContact(
    organizationId,
    mensaje.channel,
    mensaje.senderId,
  );
  if (creado) {
    void deps
      .completarNombreDelContacto({
        organizationId,
        channel: mensaje.channel,
        pageId,
        externalId: mensaje.senderId,
        contactId,
      })
      .catch((err: unknown) => {
        log.warn({ err }, "No se pudo completar el nombre del contacto de Meta");
      });
  }

  // 5. Entrante + job en la misma transacción. channelAccountId es SIEMPRE el
  //    Page ID, también para Instagram: es con lo que el envío (ítem 172) va a
  //    encontrar la MetaPageConnection y su token.
  let conversationId: string;
  try {
    const { conversation } = await deps.registrarEntrante(
      {
        organizationId,
        agentId: agent.id,
        branchId: agent.branchId,
        contactId,
        channel: mensaje.channel,
        texto: mensaje.texto,
        externalThreadId: mensaje.senderId,
        externalMessageId: mensaje.mid,
      },
      // Sin job cuando el agente no atiende: no hay turno que correr.
      atiende
        ? {
            enLaMismaTransaccion: (tx, entrante) =>
              deps.createAgentInboundJob(
                {
                  organizationId,
                  messageId: entrante.id,
                  channel: mensaje.channel,
                  channelAccountId: pageId,
                  externalUserId: mensaje.senderId,
                },
                tx,
              ),
          }
        : {},
    );
    conversationId = conversation.id;
  } catch (err) {
    // Dos entregas del mismo mid en paralelo: ver el mismo catch en
    // whatsappWebhook.service.ts.
    if (
      esDuplicadoPorIndiceUnico(err) &&
      (await deps.findMessageByExternalId(organizationId, mensaje.mid))
    ) {
      return "duplicado";
    }
    throw err;
  }

  if (atiende) {
    return "encolado";
  }

  // 6. Sin agente que conteste: la conversación pasa a "atiende una persona",
  //    con la tarea para el vendedor. Mismo criterio que WhatsApp.
  log.info(
    { agentId: agent.id, isActive: agent.isActive },
    "Mensaje de Meta para un agente apagado o sin el canal: queda para una persona",
  );
  await deps.derivarEntranteSinAgente({ organizationId, conversationId });
  return "derivado";
}

// OPUS-B-01 (docs-privados, local): el eco de un mensaje que salió de la
// página. Si lo escribió una persona desde la bandeja de Meta, queda en el
// hilo como respuesta humana y el agente se calla; si es de algo que mandó
// este CRM, se ignora. Ver registrarRespuestaDesdeLaBandejaDeMeta.
async function procesarEco(
  eco: EcoLeido & { channel: CanalMeta; cuentaId: string },
  deps: DepsDelWebhookMeta,
): Promise<ResultadoDelMensaje> {
  // Lo mandó esta app (el agente, una persona desde el CRM, el aviso): nada
  // que registrar. Es el atajo; sin app_id decide el texto, más abajo.
  const appId = deps.appId();
  if (appId !== undefined && eco.appId === appId) {
    return "ignorado";
  }

  // La página y su agente, con el mismo criterio que un entrante. Que el
  // agente esté apagado no importa: la persona respondió igual.
  const conexion =
    eco.channel === ConversationChannel.INSTAGRAM
      ? await deps.findPageIdByInstagramBusinessAccountId(eco.cuentaId)
      : await deps.findActiveMetaConnectionByPageId(eco.cuentaId);
  if (!conexion) {
    return "ignorado";
  }
  const agent = await deps.findAgentByFacebookPageId(conexion.pageId);
  if (!agent || conexion.organizationId !== agent.organizationId) {
    return "ignorado";
  }
  const organizationId = agent.organizationId;

  if (await deps.findMessageByExternalId(organizationId, eco.mid)) {
    return "duplicado";
  }

  // Solo si ese cliente ya es un contacto: un eco no crea contactos (el
  // negocio le escribió primero a alguien que este CRM todavía no conoce).
  const contactId = await deps.findContactIdByExternalIdentity({
    organizationId,
    channel: eco.channel,
    externalId: eco.recipientId,
  });
  if (!contactId) {
    return "ignorado";
  }

  try {
    const resultado = await deps.registrarRespuestaDesdeLaBandejaDeMeta({
      organizationId,
      agentId: agent.id,
      branchId: agent.branchId,
      contactId,
      channel: eco.channel,
      externalThreadId: eco.recipientId,
      externalMessageId: eco.mid,
      texto: eco.texto,
    });
    return resultado === "registrada" ? "eco" : "ignorado";
  } catch (err) {
    // Dos entregas del mismo eco en paralelo: mismo criterio que un entrante.
    if (
      esDuplicadoPorIndiceUnico(err) &&
      (await deps.findMessageByExternalId(organizationId, eco.mid))
    ) {
      return "duplicado";
    }
    throw err;
  }
}

export async function procesarWebhookDeMeta(
  payload: MetaWebhookPayload,
  deps: DepsDelWebhookMeta = depsDelWebhookMetaReales,
): Promise<ResumenDelLote> {
  const resumen: ResumenDelLote = {
    encolado: 0,
    derivado: 0,
    eco: 0,
    duplicado: 0,
    ignorado: 0,
    fallido: 0,
    descartado: 0,
  };

  // Otro objeto suscripto a la misma app (whatsapp_business_account tiene su
  // propio webhook, user, permissions...): no es de este.
  const channel = canalDelObjeto(payload.object);
  if (!channel) {
    return resumen;
  }

  for (const entry of payload.entry) {
    const cuentaId = entry.id;
    const eventos = entry.messaging ?? [];
    if (!cuentaId || eventos.length === 0) continue;

    for (const crudo of eventos) {
      const eco = leerEco(crudo);
      const m = eco ? null : leerMensaje(crudo);
      if (!eco && !m) {
        resumen.ignorado += 1;
        continue;
      }
      const mid = eco?.mid ?? m?.mid;
      try {
        const resultado = eco
          ? await procesarEco({ ...eco, channel, cuentaId }, deps)
          : await procesarMensaje({ ...m!, channel, cuentaId }, deps);
        resumen[resultado] += 1;
      } catch (err) {
        const reintentable = esFalloReintentable(err);
        logger.error(
          { err, channel, cuentaId, mid, reintentable },
          "No se pudo procesar un mensaje de Meta — se sigue con el resto del lote",
        );
        resumen[reintentable ? "fallido" : "descartado"] += 1;
      }
    }
  }

  return resumen;
}
