import { ConversationChannel, Prisma } from "@prisma/client";
import { z } from "zod";
import { logger } from "../lib/logger";
import { findAgentByWhatsappPhoneNumberId } from "../repositories/agent.repository";
import { findMessageByExternalId } from "../repositories/message.repository";
import { runAgentTurn } from "./agentOrchestration.service";
import type { SendWhatsappText } from "./whatsappGraph.service";
import { resolveWhatsappContact } from "./whatsappContact.service";

// ---------------------------------------------------------------------------
// El procesamiento de un POST /webhooks/whatsapp ya verificado (ítem 81; paso
// 6 de §9 de docs/ai-agent-architecture.md). La firma HMAC y el parseo del
// cuerpo los resolvió la cadena del router; esto recorre el lote y, por cada
// mensaje de texto, hace lo mismo que el canal Web — resolver el Contact y
// llamar a runAgentTurn — y manda la respuesta por la Graph API. El loop de
// orquestación es EL MISMO para los dos canales (§9); acá solo cambia cómo
// entra el mensaje y cómo sale la respuesta.
//
// UN MENSAJE QUE FALLA NO TUMBA EL LOTE NI LA RESPUESTA A META. Cada mensaje
// corre en su propio try/catch: el error se loguea y se sigue con el
// siguiente. El webhook contesta 200 igual, porque un 4xx/5xx haría que Meta
// reintente el lote ENTERO — incluidos los mensajes que sí se procesaron (que
// el dedup frenaría, pero sin ganar nada).
//
// SÍNCRONO, NO fire-and-forget: el 200 sale cuando el lote terminó. Si un
// turno tarda más que la paciencia de Meta y Meta reintenta, la reentrega
// choca con el mensaje entrante que runAgentTurn ya persistió (antes de llamar
// al modelo) y se descarta como duplicado. Así ningún mensaje se pierde por un
// reinicio del servidor a mitad de camino, que es lo que pasaría respondiendo
// 200 antes de procesar.
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

export interface WhatsappWebhookDeps {
  accessToken: string;
  sendText: SendWhatsappText;
}

export type ResultadoDelMensaje = "procesado" | "duplicado" | "ignorado" | "fallido";

export type ResumenDelLote = Record<ResultadoDelMensaje, number>;

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

async function procesarMensaje(
  mensaje: MensajeEntrante,
  deps: WhatsappWebhookDeps,
): Promise<ResultadoDelMensaje> {
  const log = logger.child({ phoneNumberId: mensaje.phoneNumberId, wamid: mensaje.wamid });

  // 1. ¿De qué agente es este número? Sin agente, el mensaje no tiene dueño:
  //    warning y a otra cosa — no es un error del request, es configuración.
  const agent = await findAgentByWhatsappPhoneNumberId(mensaje.phoneNumberId);
  if (!agent) {
    log.warn("Mensaje de WhatsApp para un phone_number_id sin agente asignado");
    return "ignorado";
  }
  // runAgentTurn rechazaría estos dos casos con un AppError; se cortan antes
  // para no crear un Contact por un mensaje que nadie va a atender.
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

  // 4 y 5. El turno — que también persiste el Message entrante con el wamid.
  let resultado;
  try {
    resultado = await runAgentTurn({
      organizationId,
      agentId: agent.id,
      contactId,
      channel: ConversationChannel.WHATSAPP,
      texto: mensaje.texto,
      externalThreadId: mensaje.waId,
      externalMessageId: mensaje.wamid,
    });
  } catch (err) {
    // Dos entregas del mismo mensaje en paralelo: las dos pasaron el atajo de
    // arriba y la segunda chocó con el UNIQUE al persistir el entrante, antes
    // de llamar al modelo. Se confirma releyendo, para no confundir un P2002
    // de otra tabla con un duplicado.
    if (
      esDuplicadoPorIndiceUnico(err) &&
      (await findMessageByExternalId(organizationId, mensaje.wamid))
    ) {
      return "duplicado";
    }
    throw err;
  }

  // 6. La respuesta por WhatsApp. null = la conversación ya estaba derivada a
  //    un humano: el agente no contesta, y nadie más puede todavía (no existe
  //    un endpoint para mandar un mensaje manual — mismo estado que Web).
  if (resultado.respuesta !== null) {
    await deps.sendText({
      phoneNumberId: mensaje.phoneNumberId,
      to: mensaje.waId,
      body: resultado.respuesta,
      accessToken: deps.accessToken,
    });
  }
  return "procesado";
}

export async function procesarWebhookDeWhatsapp(
  payload: WhatsappWebhookPayload,
  deps: WhatsappWebhookDeps,
): Promise<ResumenDelLote> {
  const resumen: ResumenDelLote = { procesado: 0, duplicado: 0, ignorado: 0, fallido: 0 };

  // Otro producto de Meta suscripto a la misma app (Instagram, Page...): no es
  // de este webhook.
  if (payload.object !== "whatsapp_business_account") {
    return resumen;
  }

  for (const entry of payload.entry) {
    for (const change of entry.changes) {
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
          const r = await procesarMensaje(
            {
              phoneNumberId,
              wamid: m.id,
              waId: m.from,
              profileName: nombres.get(m.from),
              texto: m.text.body,
            },
            deps,
          );
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
