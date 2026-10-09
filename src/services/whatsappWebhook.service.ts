import { ConversationChannel, Prisma } from "@prisma/client";
import { z } from "zod";
import { logger } from "../lib/logger";
import { findAgentByWhatsappPhoneNumberId } from "../repositories/agent.repository";
import { createAgentInboundJob } from "../repositories/agentInboundJob.repository";
import {
  applyDeliveryStatusByExternalId,
  findMessageByExternalId,
} from "../repositories/message.repository";
import { esFalloReintentable } from "../utils/falloDeEntrante";
import {
  agenteAtiendeElCanal,
  derivarEntranteSinAgente,
  registrarEntrante,
  respondeSinAgente,
} from "./agentOrchestration.service";
import { aplicarEstadosRetenidos, retenerEstado } from "./estadosDeEntregaRetenidos.service";
import { resolveWhatsappContact } from "./whatsappContact.service";
import { applyWhatsappTemplateStatusFromMeta } from "./whatsappTemplate.service";

// ---------------------------------------------------------------------------
// El procesamiento de un POST /webhooks/whatsapp ya verificado (ítem 81; paso
// 6 de §9 de docs/ai-agent-architecture.md). La firma HMAC y el parseo del
// cuerpo los resolvió la cadena del router; esto recorre el lote y, por cada
// mensaje de texto, de audio (ítem 162), de imagen (ítem 163) o de ubicación
// (ítem 164), resuelve el Contact, persiste el Message entrante y ENCOLA el
// turno. El turno lo corre
// src/workers/agentInboundWorker.ts, con el mismo
// loop de orquestación que el canal Web (§9), y es el worker quien manda la
// respuesta por la Graph API.
//
// Desde el ítem 160 el mismo lote puede traer además cambios de estado de las
// plantillas (campo message_template_status_update): Meta aprobó o rechazó la
// plantilla de seguimiento de un negocio. Ver procesarCambioDePlantilla.
//
// UN MENSAJE QUE FALLA NO TUMBA EL LOTE. Cada mensaje corre en su propio
// try/catch: el error se loguea y se sigue con el siguiente. Lo que cambió con
// FABLE-C-01 (docs-privados/auditoria-2026-10-05-FABLE.md, local) es la
// respuesta a Meta: si un mensaje no se pudo GUARDAR, el webhook contesta 503
// para que Meta reentregue el lote; los que sí se guardaron caen en el dedup.
// Antes contestaba 200 y ese mensaje se perdía. Ver utils/falloDeEntrante.ts.
//
// ENCOLADO, NO SÍNCRONO (ítem 125 de docs/auditoria-2026-09-24-punta-a-punta.md,
// D-01). Antes el turno del LLM corría acá adentro y el 200 salía al final;
// este comentario decía que así "ningún mensaje se pierde por un reinicio", y
// era al revés: el entrante se persistía con su wamid ANTES del modelo, así
// que si el proceso moría a mitad, el LLM fallaba o el envío fallaba, la
// reentrega de Meta caía en el dedup como "duplicado" y el cliente no recibía
// respuesta nunca. Ahora el entrante y su job se escriben en la MISMA
// transacción y el 200 sale en milisegundos: la reentrega sigue cayendo en el
// dedup —y está bien, porque el trabajo ya no depende de ella—, y el que
// reintenta es el worker, con backoff.
// ---------------------------------------------------------------------------

// Forma mínima del payload que se exige para contestar 200. Todo lo demás se
// lee con tolerancia (ver mensajeDeTextoSchema): Meta agrega campos, y un
// campo nuevo no puede convertir un webhook válido en un 400 que Meta
// reintentaría para siempre.
export const whatsappWebhookPayloadSchema = z.object({
  object: z.string(),
  entry: z.array(
    z.object({
      changes: z.array(
        z.object({
          field: z.string(),
          value: z.record(z.unknown()),
        }),
      ),
    }),
  ),
});

export type WhatsappWebhookPayload = z.infer<typeof whatsappWebhookPayloadSchema>;

// Los tipos que se procesan: texto (ítem 81), audio (ítem 162), imagen (ítem
// 163) y ubicación (ítem 164). Botones como texto, y el resto con respuesta
// fija (B-09 residual, ver MARCADORES_NO_SOPORTADOS). Las reacciones se
// ignoran sin error.
const mensajeDeTextoSchema = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  type: z.literal("text"),
  text: z.object({ body: z.string() }),
});

// Un audio trae el id del media, no los bytes (ver downloadWhatsappMediaReal).
// Una nota de voz y un archivo de audio llegan igual; la nota trae además
// voice: true, que acá no cambia nada.
const mensajeDeAudioSchema = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  type: z.literal("audio"),
  audio: z.object({ id: z.string().min(1), mime_type: z.string().min(1) }),
});

// Lo que queda en Message.content de un audio: es lo que se ve en el historial
// del CRM y lo que el modelo lee al lado del audio. El audio en sí no se
// guarda.
export const MARCADOR_DE_AUDIO = "[audio]";

// Ítem 163: igual que un audio (id del media, no los bytes), más un caption
// opcional — WhatsApp deja mandar la imagen con un texto al pie.
const mensajeDeImagenSchema = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  type: z.literal("image"),
  image: z.object({
    id: z.string().min(1),
    mime_type: z.string().min(1),
    caption: z.string().optional(),
  }),
});

// El de una imagen sin caption. Con caption, el caption ES el texto del
// entrante (lo que escribió el cliente), igual que un mensaje de texto común.
export const MARCADOR_DE_IMAGEN = "[imagen]";

// Ítem 164: una ubicación compartida no trae media — las coordenadas vienen en
// el propio payload, así que se convierte en texto y sigue el camino de un
// mensaje de texto común (sin adjunto, sin tocar el contrato del LLM). name y
// address vienen cuando el cliente elige un lugar en vez de su posición.
const mensajeDeUbicacionSchema = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  type: z.literal("location"),
  location: z.object({
    latitude: z.number(),
    longitude: z.number(),
    name: z.string().optional(),
    address: z.string().optional(),
  }),
});

export const MARCADOR_DE_UBICACION = "[ubicación]";

// Pura y exportada para probar el formato sin base. 6 decimales: la precisión
// que manda WhatsApp, fija para que el historial se lea parejo. Un name o
// address de puros espacios no dice nada: cuenta como ausente, mismo criterio
// que el caption de una imagen. No se valida que el lugar exista ni se hace
// geocoding: es un dato más que el cliente comparte, y el modelo lo lee así.
export function textoDeUbicacion(ubicacion: {
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
}): string {
  let texto = `${MARCADOR_DE_UBICACION} ${ubicacion.latitude.toFixed(6)}, ${ubicacion.longitude.toFixed(6)}`;
  const nombre = ubicacion.name?.trim();
  const direccion = ubicacion.address?.trim();
  if (nombre) texto += ` — ${nombre}`;
  if (direccion) texto += ` (${direccion})`;
  return texto;
}

// ---------------------------------------------------------------------------
// B-09 residual (docs-privados/auditoria-2026-09-24-punta-a-punta.md, local;
// ítem 165 de docs/frontend-cambios-pendientes.md). Lo que el agente todavía
// no interpreta —video, documento, sticker, contacto compartido, y lo que Meta
// marca como "unsupported"— ya no se ignora en silencio: se registra en la
// conversación con un marcador y el cliente recibe una respuesta fija, sin
// pasar por el modelo (ver agentInboundWorker.ts). Las reacciones (un emoji
// sobre un mensaje) se siguen ignorando sin respuesta.
//
// Los botones (la respuesta rápida de una plantilla, type "button") y las
// respuestas de un mensaje interactivo (type "interactive") traen el TEXTO que
// el cliente tocó, así que se leen como texto y los contesta el agente:
// "no puedo abrir este tipo de archivo" ante un "Sí, me interesa" sería
// absurdo. Sin texto legible, caen en la respuesta fija como los demás.
// ---------------------------------------------------------------------------

export const MARCADORES_NO_SOPORTADOS = {
  video: "[video]",
  document: "[documento]",
  sticker: "[sticker]",
  contacts: "[contacto compartido]",
  unsupported: "[mensaje no soportado]",
} as const;

// Los valores de arriba, más el de un botón sin texto: todo lo que el worker
// contesta con la respuesta fija.
const MARCADOR_BOTON_SIN_TEXTO = "[botón]";
const MARCADORES_CON_RESPUESTA_FIJA = new Set<string>([
  ...Object.values(MARCADORES_NO_SOPORTADOS),
  MARCADOR_BOTON_SIN_TEXTO,
]);

// La respuesta que recibe el cliente. Corta y sin prometer nada que el agente
// no pueda cumplir.
export const RESPUESTA_TIPO_NO_SOPORTADO =
  "Por ahora no puedo abrir este tipo de archivo. ¿Me lo escribís?";

// ¿Este entrante se contesta con la respuesta fija? Por su contenido, que es
// el marcador que puso leerMensaje. Pura y exportada para el worker.
export function esEntranteNoSoportado(contenido: string): boolean {
  return MARCADORES_CON_RESPUESTA_FIJA.has(contenido.trim());
}

const mensajeBaseSchema = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  type: z.string(),
});

const botonSchema = z.object({ button: z.object({ text: z.string().optional() }) });
const interactivoSchema = z.object({
  interactive: z.object({
    button_reply: z.object({ title: z.string().optional() }).optional(),
    list_reply: z.object({ title: z.string().optional() }).optional(),
  }),
});

export interface MensajeLeido {
  wamid: string;
  waId: string;
  texto: string;
  media?: { id: string; mimeType: string };
}

// Pura, para probar sin base qué se procesa y cómo. null = tipo que no se
// procesa, o sin la forma esperada: se ignora sin error.
export function leerMensaje(crudo: unknown): MensajeLeido | null {
  const texto = mensajeDeTextoSchema.safeParse(crudo);
  if (texto.success) {
    return { wamid: texto.data.id, waId: texto.data.from, texto: texto.data.text.body };
  }
  const audio = mensajeDeAudioSchema.safeParse(crudo);
  if (audio.success) {
    return {
      wamid: audio.data.id,
      waId: audio.data.from,
      texto: MARCADOR_DE_AUDIO,
      media: { id: audio.data.audio.id, mimeType: audio.data.audio.mime_type },
    };
  }
  const imagen = mensajeDeImagenSchema.safeParse(crudo);
  if (imagen.success) {
    // Un caption de puros espacios no dice nada: cuenta como sin caption. Uno
    // con contenido se guarda tal cual, como el body de un texto.
    const caption = imagen.data.image.caption;
    return {
      wamid: imagen.data.id,
      waId: imagen.data.from,
      texto: caption?.trim() ? caption : MARCADOR_DE_IMAGEN,
      media: { id: imagen.data.image.id, mimeType: imagen.data.image.mime_type },
    };
  }
  const ubicacion = mensajeDeUbicacionSchema.safeParse(crudo);
  if (ubicacion.success) {
    // Sin media a propósito: para el resto del camino es un texto más.
    return {
      wamid: ubicacion.data.id,
      waId: ubicacion.data.from,
      texto: textoDeUbicacion(ubicacion.data.location),
    };
  }

  // B-09 residual: todo lo demás que trae id y remitente.
  const base = mensajeBaseSchema.safeParse(crudo);
  if (!base.success) {
    return null;
  }
  const { id: wamid, from: waId, type } = base.data;

  if (type === "button" || type === "interactive") {
    let tocado: string | undefined;
    const boton = botonSchema.safeParse(crudo);
    if (type === "button" && boton.success) {
      tocado = boton.data.button.text;
    }
    const interactivo = interactivoSchema.safeParse(crudo);
    if (type === "interactive" && interactivo.success) {
      const { button_reply, list_reply } = interactivo.data.interactive;
      tocado = button_reply?.title ?? list_reply?.title;
    }
    return { wamid, waId, texto: tocado?.trim() ? tocado.trim() : MARCADOR_BOTON_SIN_TEXTO };
  }

  if (type in MARCADORES_NO_SOPORTADOS) {
    return {
      wamid,
      waId,
      texto: MARCADORES_NO_SOPORTADOS[type as keyof typeof MARCADORES_NO_SOPORTADOS],
    };
  }

  // Reacciones, y cualquier tipo que Meta agregue y no esté en la lista de
  // arriba (system, order…): se ignoran sin error, como siempre.
  return null;
}

const contactoDelPayloadSchema = z.object({
  wa_id: z.string(),
  profile: z.object({ name: z.string().optional() }).optional(),
});

// "derivado": el agente del número está apagado o no atiende WhatsApp; el
// mensaje quedó en la conversación para una persona, sin job (OPUS-I-01).
// "fallido": no se pudo guardar y Meta tiene que reintentarlo. "descartado":
// lo rechazó una regla de negocio, y reintentar daría lo mismo. Ver
// utils/falloDeEntrante.ts.
export type ResultadoDelMensaje =
  "encolado" | "derivado" | "duplicado" | "ignorado" | "fallido" | "descartado";

// Los mensajes, más cuántas plantillas cambiaron de estado (ítem 160),
// cuántos salientes avanzaron de estado de entrega (WA-1) y cuántos statuses
// no se pudieron aplicar (cuentan para el reintento igual que un "fallido").
export type ResumenDelLote = Record<ResultadoDelMensaje, number> & {
  plantillas: number;
  estados: number;
  estadosFallidos: number;
};

// ¿Hay que pedirle a Meta que reintente el lote? Ver utils/falloDeEntrante.ts.
export function hayQueReintentarElLote(resumen: ResumenDelLote): boolean {
  return resumen.fallido + resumen.estadosFallidos > 0;
}

// Lo que el procesamiento toca afuera y un test necesita reemplazar para
// simular que la base no respondió al guardar. Producción usa los reales.
export interface DepsDelWebhookDeWhatsapp {
  registrarEntrante: typeof registrarEntrante;
}

const depsDelWebhookDeWhatsappReales: DepsDelWebhookDeWhatsapp = { registrarEntrante };

// ---------------------------------------------------------------------------
// Statuses de entrega (WA-1 de los pendientes post F1–F5,
// docs-privados/prueba-en-vivo-2026-09-29.md (local, no está en GitHub)). Meta manda, para cada mensaje SALIENTE, un status por
// transición: sent, delivered, read o failed (este con errors[]). Hasta WA-1
// el webhook los ignoraba y el vendedor no sabía si el cliente recibió o leyó
// un WhatsApp.
//
// Se aplica al Message por su wamid (externalMessageId) con
// applyDeliveryStatusByExternalId, que no deja retroceder el estado y es
// idempotente (Meta reintenta). La organización sale del phone_number_id del
// change, como con los mensajes: la firma ya se verificó en el middleware, y
// el wamid solo se busca dentro de esa organización. Un wamid desconocido
// (un mensaje que no salió de este CRM, o uno cuyo envío todavía no guardó el
// wamid) actualiza 0 filas y no es un error: desde D-15 el estado se RETIENE
// unos minutos y se aplica cuando se guarde el wamid
// (estadosDeEntregaRetenidos.service.ts). Cualquier otro status (Meta
// agrega valores, por ejemplo "deleted") se ignora.
// ---------------------------------------------------------------------------
const ESTADO_DE_META = {
  sent: "SENT",
  delivered: "DELIVERED",
  read: "READ",
  failed: "FAILED",
} as const;

const statusDelPayloadSchema = z.object({
  id: z.string().min(1),
  status: z.string(),
  errors: z
    .array(
      z.object({
        code: z.union([z.number(), z.string()]).optional(),
        title: z.string().optional(),
        message: z.string().optional(),
        error_data: z.object({ details: z.string().optional() }).optional(),
      }),
    )
    .optional(),
});

// El motivo de un failed, como lo manda Meta: código, título y detalle.
// Recortado igual que el deliveryError de un envío fallido.
const MOTIVO_MAX = 500;

function motivoDeMeta(errores: z.infer<typeof statusDelPayloadSchema>["errors"]): string {
  const e = errores?.[0];
  if (!e) return "Meta informó que el mensaje no se pudo entregar (sin detalle)";
  const partes = [
    e.code !== undefined ? `(${e.code})` : null,
    e.title ?? e.message ?? null,
    e.error_data?.details ?? null,
  ].filter((parte): parte is string => parte !== null && parte.trim() !== "");
  return partes.join(" ").slice(0, MOTIVO_MAX);
}

async function procesarEstados(
  phoneNumberId: string,
  statuses: unknown[],
): Promise<{ aplicados: number; fallidos: number }> {
  const agent = await findAgentByWhatsappPhoneNumberId(phoneNumberId);
  if (!agent) {
    return { aplicados: 0, fallidos: 0 };
  }
  let aplicados = 0;
  let fallidos = 0;
  for (const crudo of statuses) {
    const parsed = statusDelPayloadSchema.safeParse(crudo);
    if (!parsed.success) continue;
    const estado = ESTADO_DE_META[parsed.data.status as keyof typeof ESTADO_DE_META];
    if (!estado) continue;
    const entrega = {
      status: estado,
      ...(estado === "FAILED" ? { error: motivoDeMeta(parsed.data.errors) } : {}),
    };
    try {
      const r = await applyDeliveryStatusByExternalId(
        agent.organizationId,
        parsed.data.id,
        entrega,
      );
      aplicados += r.count;
      if (r.count === 0) {
        // D-15: el wamid todavía no está guardado (o no es de este CRM). Se
        // retiene y se reintenta UNA vez enseguida: si quien guarda el wamid
        // commiteó entre el UPDATE de arriba y el retener, su propio
        // aplicarEstadosRetenidos ya pasó y no lo vio; este segundo intento
        // lo encuentra. Si no, lo aplica quien guarde el wamid después.
        retenerEstado(agent.organizationId, parsed.data.id, entrega);
        aplicados += await aplicarEstadosRetenidos(agent.organizationId, parsed.data.id);
      }
    } catch (err) {
      // Mismo criterio que un mensaje: un fallo se loguea y no tumba el lote.
      // Se cuenta para que el webhook le pida a Meta que reintente; la
      // escritura es idempotente.
      logger.error(
        { err, phoneNumberId, wamid: parsed.data.id },
        "No se pudo aplicar un status de WhatsApp — se sigue con el resto del lote",
      );
      fallidos += 1;
    }
  }
  return { aplicados, fallidos };
}

// El cambio de estado de una plantilla (campo message_template_status_update
// del webhook, ítem 160). Meta manda el id como NÚMERO; se acepta también como
// string por si algún día cambia, y se normaliza a string, que es como se
// guarda. Tolerante como el resto: lo que no tenga esta forma se ignora.
const cambioDePlantillaSchema = z.object({
  event: z.string().min(1),
  message_template_id: z.union([z.number(), z.string().min(1)]),
  reason: z.string().nullish(),
});

function esDuplicadoPorIndiceUnico(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

interface MensajeEntrante {
  phoneNumberId: string;
  wamid: string;
  waId: string;
  profileName: string | undefined;
  texto: string;
  media?: { id: string; mimeType: string };
}

async function procesarMensaje(
  mensaje: MensajeEntrante,
  deps: DepsDelWebhookDeWhatsapp,
): Promise<ResultadoDelMensaje> {
  const log = logger.child({ phoneNumberId: mensaje.phoneNumberId, wamid: mensaje.wamid });

  // 1. ¿De qué agente es este número? Sin agente, el mensaje no tiene dueño
  //    (el número es lo único que dice de qué organización es): warning y a
  //    otra cosa — no es un error del request, es configuración.
  const agent = await findAgentByWhatsappPhoneNumberId(mensaje.phoneNumberId);
  if (!agent) {
    log.warn("Mensaje de WhatsApp para un phone_number_id sin agente asignado");
    return "ignorado";
  }
  // OPUS-I-01 (docs-privados/auditoria-2026-10-04-OPUS.md, local): un agente
  // apagado o sin el canal ya no descarta el mensaje. Se guarda igual, sin
  // job, y la conversación queda para una persona (paso 5).
  const atiende = agenteAtiendeElCanal(agent, ConversationChannel.WHATSAPP);
  const organizationId = agent.organizationId;

  if (mensaje.texto.trim().length === 0) {
    return "ignorado";
  }
  // Se encola con el agente atendiendo, y también sin él si el rubro contesta
  // igual (la urgencia de una clínica, docs/rubros.md §5.3): el worker es el
  // que puede mandar la respuesta fija. En AUTOMOTORA, encola === atiende.
  const encola = atiende || (await respondeSinAgente(organizationId));

  // 2. Dedup: Meta reintentando una entrega ya procesada. Es el atajo del
  //    caso común; la garantía real es el UNIQUE, más abajo.
  const yaGuardado = await findMessageByExternalId(organizationId, mensaje.wamid);
  if (yaGuardado) {
    if (!encola) {
      await derivarEntranteSinAgente({
        organizationId,
        conversationId: yaGuardado.conversationId,
      });
    }
    return "duplicado";
  }

  // 3. El Contact, por teléfono.
  const contactId = await resolveWhatsappContact(organizationId, mensaje.waId, mensaje.profileName);

  // 4. El Message entrante con su wamid y, en la misma transacción, el job
  //    que el worker va a tomar. Sin el lock de la conversación a propósito:
  //    ese lock lo sostiene un turno en curso durante minutos, y el webhook
  //    tiene que contestar en milisegundos. Lo que el lock protegía acá —que
  //    dos entregas en paralelo abran dos conversaciones— lo garantiza el
  //    índice conversations_open_unique (ítem 126).
  let conversationId: string;
  try {
    const { conversation } = await deps.registrarEntrante(
      {
        organizationId,
        agentId: agent.id,
        branchId: agent.branchId,
        contactId,
        channel: ConversationChannel.WHATSAPP,
        texto: mensaje.texto.trim(),
        externalThreadId: mensaje.waId,
        externalMessageId: mensaje.wamid,
      },
      // Sin job cuando nadie va a contestar: no hay turno que correr.
      encola
        ? {
            enLaMismaTransaccion: (tx, entrante) =>
              createAgentInboundJob(
                {
                  organizationId,
                  messageId: entrante.id,
                  channel: ConversationChannel.WHATSAPP,
                  channelAccountId: mensaje.phoneNumberId,
                  externalUserId: mensaje.waId,
                  // Ítem 162: solo el id. El media (audio o imagen) lo baja el worker; bajarlo acá
                  // sumaría una llamada a Meta al camino que tiene que contestar
                  // en milisegundos (ítem 125).
                  ...(mensaje.media
                    ? { mediaId: mensaje.media.id, mediaType: mensaje.media.mimeType }
                    : {}),
                },
                tx,
              ),
          }
        : {},
    );
    conversationId = conversation.id;
  } catch (err) {
    // Dos entregas del mismo mensaje en paralelo: las dos pasaron el atajo de
    // arriba y la segunda chocó con el UNIQUE al persistir el entrante (su
    // transacción se revirtió entera, job incluido). Se confirma releyendo,
    // para no confundir un P2002 de otra tabla con un duplicado.
    if (
      esDuplicadoPorIndiceUnico(err) &&
      (await findMessageByExternalId(organizationId, mensaje.wamid))
    ) {
      return "duplicado";
    }
    throw err;
  }

  if (encola) {
    return "encolado";
  }

  // 5. Sin agente que conteste: la conversación pasa a "atiende una persona",
  //    con la tarea para el vendedor. Si esto falla, el mensaje ya está
  //    guardado; el error sube, Meta reentrega y el dedup de arriba deriva.
  log.info(
    { agentId: agent.id, isActive: agent.isActive },
    "Mensaje de WhatsApp para un agente apagado o sin el canal: queda para una persona",
  );
  await derivarEntranteSinAgente({ organizationId, conversationId });
  return "derivado";
}

// Meta aprobó, rechazó o pausó una plantilla (ítem 160): se actualiza la fila
// que la tiene por metaTemplateId. Mismo criterio que un mensaje: un fallo se
// loguea y NO tumba el lote ni el 200 — y si se perdió, el botón "Actualizar
// estado" de la pantalla lo repregunta. Una plantilla que no es de este CRM
// (el WABA puede tener otras, dadas de alta a mano) actualiza 0 filas, sin
// error.
async function procesarCambioDePlantilla(value: Record<string, unknown>): Promise<number> {
  const parsed = cambioDePlantillaSchema.safeParse(value);
  if (!parsed.success) {
    logger.warn("Cambio de estado de plantilla de WhatsApp sin la forma esperada: se ignora");
    return 0;
  }
  const metaTemplateId = String(parsed.data.message_template_id);
  try {
    const actualizadas = await applyWhatsappTemplateStatusFromMeta(
      metaTemplateId,
      parsed.data.event,
      parsed.data.reason ?? null,
    );
    logger.info(
      { metaTemplateId, event: parsed.data.event, actualizadas },
      "Cambio de estado de plantilla de WhatsApp",
    );
    return actualizadas;
  } catch (err) {
    logger.error(
      { err, metaTemplateId },
      "No se pudo aplicar el cambio de estado de una plantilla de WhatsApp — se sigue con el lote",
    );
    return 0;
  }
}

export async function procesarWebhookDeWhatsapp(
  payload: WhatsappWebhookPayload,
  deps: DepsDelWebhookDeWhatsapp = depsDelWebhookDeWhatsappReales,
): Promise<ResumenDelLote> {
  const resumen: ResumenDelLote = {
    encolado: 0,
    derivado: 0,
    duplicado: 0,
    ignorado: 0,
    fallido: 0,
    descartado: 0,
    plantillas: 0,
    estados: 0,
    estadosFallidos: 0,
  };

  // Otro producto de Meta suscripto a la misma app (Instagram, Page...): no es
  // de este webhook.
  if (payload.object !== "whatsapp_business_account") {
    return resumen;
  }

  for (const entry of payload.entry) {
    for (const change of entry.changes) {
      if (change.field === "message_template_status_update") {
        resumen.plantillas += await procesarCambioDePlantilla(change.value);
        continue;
      }
      if (change.field !== "messages") continue;
      const value = change.value;

      const metadata = value.metadata as { phone_number_id?: unknown } | undefined;
      const phoneNumberId =
        typeof metadata?.phone_number_id === "string" ? metadata.phone_number_id : undefined;
      if (!phoneNumberId) continue;
      // WA-1: los statuses de los salientes (enviado, entregado, leído,
      // fallido). Un change puede traer statuses, messages o los dos.
      const statuses = Array.isArray(value.statuses) ? (value.statuses as unknown[]) : [];
      if (statuses.length > 0) {
        const estados = await procesarEstados(phoneNumberId, statuses);
        resumen.estados += estados.aplicados;
        resumen.estadosFallidos += estados.fallidos;
      }
      const mensajes = Array.isArray(value.messages) ? (value.messages as unknown[]) : [];
      if (mensajes.length === 0) continue;

      const contactos = Array.isArray(value.contacts) ? (value.contacts as unknown[]) : [];
      const nombres = new Map<string, string | undefined>();
      for (const c of contactos) {
        const parsed = contactoDelPayloadSchema.safeParse(c);
        if (parsed.success) nombres.set(parsed.data.wa_id, parsed.data.profile?.name);
      }

      for (const crudo of mensajes) {
        const m = leerMensaje(crudo);
        if (!m) {
          resumen.ignorado += 1;
          continue;
        }
        try {
          const r = await procesarMensaje(
            {
              phoneNumberId,
              wamid: m.wamid,
              waId: m.waId,
              profileName: nombres.get(m.waId),
              texto: m.texto,
              media: m.media,
            },
            deps,
          );
          resumen[r] += 1;
        } catch (err) {
          const reintentable = esFalloReintentable(err);
          logger.error(
            { err, phoneNumberId, wamid: m.wamid, reintentable },
            "No se pudo procesar un mensaje de WhatsApp — se sigue con el resto del lote",
          );
          resumen[reintentable ? "fallido" : "descartado"] += 1;
        }
      }
    }
  }

  return resumen;
}
