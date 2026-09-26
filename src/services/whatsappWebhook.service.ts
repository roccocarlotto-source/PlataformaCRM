import { ConversationChannel, Prisma } from "@prisma/client";
import { z } from "zod";
import { logger } from "../lib/logger";
import { findAgentByWhatsappPhoneNumberId } from "../repositories/agent.repository";
import { createAgentInboundJob } from "../repositories/agentInboundJob.repository";
import { findMessageByExternalId } from "../repositories/message.repository";
import { registrarEntrante } from "./agentOrchestration.service";
import { resolveWhatsappContact } from "./whatsappContact.service";
import { applyWhatsappTemplateStatusFromMeta } from "./whatsappTemplate.service";

// ---------------------------------------------------------------------------
// El procesamiento de un POST /webhooks/whatsapp ya verificado (ítem 81; paso
// 6 de §9 de docs/ai-agent-architecture.md). La firma HMAC y el parseo del
// cuerpo los resolvió la cadena del router; esto recorre el lote y, por cada
// mensaje de texto, resuelve el Contact, persiste el Message entrante y ENCOLA
// el turno. El turno lo corre src/workers/agentInboundWorker.ts, con el mismo
// loop de orquestación que el canal Web (§9), y es el worker quien manda la
// respuesta por la Graph API.
//
// Desde el ítem 160 el mismo lote puede traer además cambios de estado de las
// plantillas (campo message_template_status_update): Meta aprobó o rechazó la
// plantilla de seguimiento de un negocio. Ver procesarCambioDePlantilla.
//
// UN MENSAJE QUE FALLA NO TUMBA EL LOTE NI LA RESPUESTA A META. Cada mensaje
// corre en su propio try/catch: el error se loguea y se sigue con el
// siguiente. El webhook contesta 200 igual, porque un 4xx/5xx haría que Meta
// reintente el lote ENTERO — incluidos los mensajes que sí se procesaron (que
// el dedup frenaría, pero sin ganar nada).
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

// El único tipo que este ítem procesa. Imágenes, audios, ubicaciones,
// reacciones, botones: fuera de alcance, se ignoran sin error.
const mensajeDeTextoSchema = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  type: z.literal("text"),
  text: z.object({ body: z.string() }),
});

const contactoDelPayloadSchema = z.object({
  wa_id: z.string(),
  profile: z.object({ name: z.string().optional() }).optional(),
});

export type ResultadoDelMensaje = "encolado" | "duplicado" | "ignorado" | "fallido";

// Los mensajes, más cuántas plantillas cambiaron de estado (ítem 160).
export type ResumenDelLote = Record<ResultadoDelMensaje, number> & { plantillas: number };

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
}

async function procesarMensaje(mensaje: MensajeEntrante): Promise<ResultadoDelMensaje> {
  const log = logger.child({ phoneNumberId: mensaje.phoneNumberId, wamid: mensaje.wamid });

  // 1. ¿De qué agente es este número? Sin agente, el mensaje no tiene dueño:
  //    warning y a otra cosa — no es un error del request, es configuración.
  const agent = await findAgentByWhatsappPhoneNumberId(mensaje.phoneNumberId);
  if (!agent) {
    log.warn("Mensaje de WhatsApp para un phone_number_id sin agente asignado");
    return "ignorado";
  }
  // El turno rechazaría estos dos casos con un AppError; se cortan antes para
  // no crear un Contact ni encolar un mensaje que nadie va a atender.
  if (!agent.isActive || !agent.channels.includes(ConversationChannel.WHATSAPP)) {
    log.warn(
      { agentId: agent.id, isActive: agent.isActive },
      "Mensaje de WhatsApp para un agente desactivado o sin el canal WHATSAPP",
    );
    return "ignorado";
  }
  const organizationId = agent.organizationId;

  if (mensaje.texto.trim().length === 0) {
    return "ignorado";
  }

  // 2. Dedup: Meta reintentando una entrega ya procesada. Es el atajo del
  //    caso común; la garantía real es el UNIQUE, más abajo.
  if (await findMessageByExternalId(organizationId, mensaje.wamid)) {
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
  try {
    await registrarEntrante(
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
      {
        enLaMismaTransaccion: (tx, entrante) =>
          createAgentInboundJob(
            {
              organizationId,
              messageId: entrante.id,
              phoneNumberId: mensaje.phoneNumberId,
              waId: mensaje.waId,
            },
            tx,
          ),
      },
    );
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

  return "encolado";
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
): Promise<ResumenDelLote> {
  const resumen: ResumenDelLote = {
    encolado: 0,
    duplicado: 0,
    ignorado: 0,
    fallido: 0,
    plantillas: 0,
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
      // Un change con `statuses` (entregado/leído) y sin `messages` cae acá
      // sin nada que recorrer: se ignora en silencio, como pide Meta.
      const mensajes = Array.isArray(value.messages) ? (value.messages as unknown[]) : [];
      if (!phoneNumberId || mensajes.length === 0) continue;

      const contactos = Array.isArray(value.contacts) ? (value.contacts as unknown[]) : [];
      const nombres = new Map<string, string | undefined>();
      for (const c of contactos) {
        const parsed = contactoDelPayloadSchema.safeParse(c);
        if (parsed.success) nombres.set(parsed.data.wa_id, parsed.data.profile?.name);
      }

      for (const crudo of mensajes) {
        const parsed = mensajeDeTextoSchema.safeParse(crudo);
        if (!parsed.success) {
          resumen.ignorado += 1;
          continue;
        }
        const m = parsed.data;
        try {
          const r = await procesarMensaje({
            phoneNumberId,
            wamid: m.id,
            waId: m.from,
            profileName: nombres.get(m.from),
            texto: m.text.body,
          });
          resumen[r] += 1;
        } catch (err) {
          logger.error(
            { err, phoneNumberId, wamid: m.id },
            "No se pudo procesar un mensaje de WhatsApp — se sigue con el resto del lote",
          );
          resumen.fallido += 1;
        }
      }
    }
  }

  return resumen;
}
