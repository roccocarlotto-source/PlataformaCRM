import { ConversationChannel, Prisma } from "@prisma/client";
import { z } from "zod";
import { logger } from "../lib/logger";
import type { Db } from "../lib/prisma";
import { findAgentByFacebookPageId } from "../repositories/agent.repository";
import { createAgentInboundJob } from "../repositories/agentInboundJob.repository";
import { findMessageByExternalId } from "../repositories/message.repository";
import { findPageIdByInstagramBusinessAccountId } from "../repositories/metaPageConnection.repository";
import { registrarEntrante, type RegistrarEntranteInput } from "./agentOrchestration.service";
import { resolveMetaContact, type CanalMeta } from "./metaContact.service";

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
//    aparte `message_echoes`; en Instagram llegan dentro de `messages`. En los
//    dos casos se descartan acá, antes de cualquier otra cosa: procesado como
//    entrante, el agente contestaría sus propias respuestas.
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
  message: z.object({
    mid: z.string().min(1),
    text: z.string().optional(),
    is_echo: z.boolean().optional(),
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

export type ResultadoDelMensaje = "encolado" | "duplicado" | "ignorado" | "fallido";
export type ResumenDelLote = Record<ResultadoDelMensaje, number>;

// Lo que el procesamiento toca afuera, inyectable para probar la DECISIÓN sin
// base (metaWebhook.service.test.ts). Producción usa depsDelWebhookMetaReales;
// el recorrido real contra Postgres lo cubre
// metaWebhook.controller.integration-test.ts.
export interface DepsDelWebhookMeta {
  findPageIdByInstagramBusinessAccountId: (
    instagramBusinessAccountId: string,
  ) => Promise<{ pageId: string } | null>;
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
  ) => Promise<{ id: string } | null>;
  resolveMetaContact: (
    organizationId: string,
    channel: CanalMeta,
    externalId: string,
  ) => Promise<string>;
  registrarEntrante: (
    input: RegistrarEntranteInput,
    opciones: { enLaMismaTransaccion: (tx: Db, entrante: { id: string }) => Promise<unknown> },
  ) => Promise<unknown>;
  createAgentInboundJob: (
    data: Parameters<typeof createAgentInboundJob>[0],
    db: Db,
  ) => Promise<unknown>;
}

export const depsDelWebhookMetaReales: DepsDelWebhookMeta = {
  findPageIdByInstagramBusinessAccountId: (id) => findPageIdByInstagramBusinessAccountId(id),
  findAgentByFacebookPageId: (pageId) => findAgentByFacebookPageId(pageId),
  findMessageByExternalId: (organizationId, mid) => findMessageByExternalId(organizationId, mid),
  resolveMetaContact,
  registrarEntrante,
  createAgentInboundJob,
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

  // 1. La página. Messenger ya la trae; Instagram trae su propia cuenta y la
  //    página se busca en la conexión de Meta (ítem 170). Sin conexión, el
  //    Instagram no es de ningún negocio de este CRM.
  let pageId = mensaje.cuentaId;
  if (mensaje.channel === ConversationChannel.INSTAGRAM) {
    const conexion = await deps.findPageIdByInstagramBusinessAccountId(mensaje.cuentaId);
    if (!conexion) {
      log.warn("Mensaje de Instagram para una cuenta sin página conectada");
      return "ignorado";
    }
    pageId = conexion.pageId;
  }

  // 2. ¿De qué agente es esta página? Mismo criterio que WhatsApp: sin agente,
  //    desactivado o sin el canal, es configuración y no un error del request.
  const agent = await deps.findAgentByFacebookPageId(pageId);
  if (!agent) {
    log.warn({ pageId }, "Mensaje de Meta para una página sin agente asignado");
    return "ignorado";
  }
  if (!agent.isActive || !agent.channels.includes(mensaje.channel)) {
    log.warn(
      { agentId: agent.id, isActive: agent.isActive },
      "Mensaje de Meta para un agente desactivado o sin el canal",
    );
    return "ignorado";
  }
  const organizationId = agent.organizationId;

  // 3. Dedup: Meta reintentando una entrega ya procesada. Atajo del caso
  //    común; la garantía real es el UNIQUE, más abajo.
  if (await deps.findMessageByExternalId(organizationId, mensaje.mid)) {
    return "duplicado";
  }

  // 4. El Contact, por su PSID/IGSID.
  const contactId = await deps.resolveMetaContact(
    organizationId,
    mensaje.channel,
    mensaje.senderId,
  );

  // 5. Entrante + job en la misma transacción. channelAccountId es SIEMPRE el
  //    Page ID, también para Instagram: es con lo que el envío (ítem 172) va a
  //    encontrar la MetaPageConnection y su token.
  try {
    await deps.registrarEntrante(
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
      {
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
      },
    );
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

  return "encolado";
}

export async function procesarWebhookDeMeta(
  payload: MetaWebhookPayload,
  deps: DepsDelWebhookMeta = depsDelWebhookMetaReales,
): Promise<ResumenDelLote> {
  const resumen: ResumenDelLote = { encolado: 0, duplicado: 0, ignorado: 0, fallido: 0 };

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
      const m = leerMensaje(crudo);
      if (!m) {
        resumen.ignorado += 1;
        continue;
      }
      try {
        resumen[await procesarMensaje({ ...m, channel, cuentaId }, deps)] += 1;
      } catch (err) {
        logger.error(
          { err, channel, cuentaId, mid: m.mid },
          "No se pudo procesar un mensaje de Meta — se sigue con el resto del lote",
        );
        resumen.fallido += 1;
      }
    }
  }

  return resumen;
}
