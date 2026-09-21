import { findLatestConversationByContact } from "../repositories/conversation.repository";
import { findLastMessages } from "../repositories/message.repository";
import { findOpportunityForFollowUpDraft } from "../repositories/opportunity.repository";
import { AppError } from "../utils/AppError";
import { armarTranscript, limpiarRespuesta } from "./conversationBrief.service";
import { LlmProviderError, getLlmProvider, type LlmProvider } from "./llmProvider.service";

// ---------------------------------------------------------------------------
// El borrador de un mensaje de seguimiento para una oportunidad estancada
// (ítem 76 de docs/frontend-cambios-pendientes.md): lo redacta la IA, lo lee
// un vendedor y, si le sirve, lo manda él a mano.
//
// EL AGENTE NUNCA LE ESCRIBE AL CLIENTE. Esto devuelve un texto y nada más;
// quien lo convierte en una Activity para el dueño de la oportunidad es la
// acción agent.draft_follow_up. Por eso la pregunta abierta de
// docs/automations-architecture.md §2 —qué significa "iniciar" una
// conversación sin un mensaje entrante— no entra en juego: no se inicia
// ninguna.
//
// MISMO MOLDE QUE conversationBrief.service.ts (ítem 73), que es el otro
// lugar donde se le pide al modelo una tarea puntual fuera de un turno:
// `llm.complete({ systemPrompt, messages, tools: [] })`, SIN tools y SIN
// `model` —el adaptador usa el default de OPENROUTER_MODEL—, con el proveedor
// inyectable para que el test sea unitario. Redactar un seguimiento es una
// tarea de criterio fijo, no parte del comportamiento configurable de ningún
// Agent.
// ---------------------------------------------------------------------------

// Tope de lo que se devuelve. El prompt ya pide un mensaje breve; esto es para
// el modelo que no respeta la consigna, igual que BRIEF_MAX_LENGTH. Queda muy
// por debajo del tope de Activity.body que usa la acción (MAX_NOTES).
export const BORRADOR_MAX_LENGTH = 2000;

// Cuántos mensajes de la conversación se le pasan como contexto: los ÚLTIMOS,
// no todos. A diferencia del brief —que resume el hilo entero y por eso lo lee
// entero—, para retomar el contacto importa cómo terminó la charla, no cómo
// empezó; y una conversación larga no tiene por qué inflar cada llamada.
export const MENSAJES_DE_CONTEXTO = 40;

const MS_POR_DIA = 24 * 60 * 60 * 1000;

export interface DatosDeOportunidadParaBorrador {
  title: string;
  // Decimal serializado (Opportunity.amount): se pasa como texto, sin
  // convertirlo a number, para no perder decimales en el camino.
  amount: string;
  currency: string;
  stageName: string;
  createdAt: Date;
  updatedAt: Date;
}

function fechaIso(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

// El mensaje de usuario que ve el modelo: los datos de la oportunidad y, si
// hay, el transcript de la conversación más reciente del contacto. Pura y
// exportada para probarla sin base.
//
// SIN NOMBRES PROPIOS (ni del contacto, ni de la empresa, ni del vendedor), con
// el mismo criterio que el transcript del brief: evita mandarle datos
// personales al proveedor sin necesidad (docs/data-classification.md), y el
// vendedor personaliza el saludo en dos segundos al leerlo. El título de la
// oportunidad sí va: es lo que dice DE QUÉ se habló, y sin eso el borrador
// sería genérico.
export function armarContextoDeBorrador(
  datos: DatosDeOportunidadParaBorrador,
  transcript: string | null,
  ahora: Date,
): string {
  const diasQuieta = Math.max(
    0,
    Math.floor((ahora.getTime() - datos.updatedAt.getTime()) / MS_POR_DIA),
  );
  const monto =
    Number(datos.amount) > 0 ? `${datos.amount} ${datos.currency}` : "sin monto cargado";

  const lineas = [
    "Datos de la oportunidad:",
    `- Título: ${datos.title}`,
    `- Monto: ${monto}`,
    `- Etapa: ${datos.stageName}`,
    `- Creada el: ${fechaIso(datos.createdAt)}`,
    `- Último movimiento: ${fechaIso(datos.updatedAt)} (hace ${String(diasQuieta)} días)`,
    "",
  ];

  if (transcript && transcript.length > 0) {
    lineas.push("Última conversación con el cliente (del más viejo al más nuevo):", transcript);
  } else {
    lineas.push("No hay ninguna conversación registrada con el cliente.");
  }

  return lineas.join("\n");
}

// Fijo y sin interpolación, por simetría con armarPromptDeBrief().
export function armarPromptDeBorrador(): string {
  return [
    "Sos un asistente que ayuda al equipo de ventas de una empresa a retomar el contacto con clientes.",
    "",
    'Te paso los datos de una oportunidad de venta que lleva varios días sin movimiento y, si existe, la última conversación que hubo con el cliente. Cada línea de la conversación empieza con quién habló: "Cliente" es el cliente, "Agente" es un asistente automático y "Humano" es alguien del equipo de ventas.',
    "",
    "Redactá UN mensaje breve para retomar el contacto con el cliente, que el vendedor va a revisar y mandar él mismo por WhatsApp o por email.",
    "",
    "Reglas:",
    "- Escribilo en primera persona, como si lo escribiera el vendedor. No sos vos quien lo manda y el mensaje no tiene que mencionar a ningún asistente ni a ninguna automatización.",
    "- Español rioplatense, tono cordial y profesional, sin presionar.",
    "- Entre 2 y 5 oraciones. Terminá con una pregunta concreta que invite a responder.",
    "- Si hay una conversación, retomá lo último que quedó pendiente en ella. Si no hay, basate solo en los datos de la oportunidad.",
    "- No inventes precios, descuentos, plazos, stock ni ningún dato que no esté en lo que te paso.",
    "- No uses nombres propios ni marcadores para completar (nada entre corchetes). Empezá con un saludo genérico.",
    "- Respondé SOLO con el texto del mensaje. Sin títulos, sin comillas y sin ninguna explicación de lo que hiciste.",
  ].join("\n");
}

const MENSAJE_SIN_BORRADOR = "El modelo no devolvió ningún borrador de seguimiento";

export interface OpcionesDeBorrador {
  llmProvider?: LlmProvider;
  ahora?: Date;
}

// ---------------------------------------------------------------------------
// El punto de entrada
//
// Devuelve el texto del borrador y NO escribe nada: guardarlo (como Activity)
// y dejar la marca anti-redraft es trabajo de la acción que lo llama. Así una
// falla acá —el proveedor caído, una respuesta vacía— no puede dejar ningún
// efecto a medias.
// ---------------------------------------------------------------------------
export async function generarBorradorDeSeguimiento(
  organizationId: string,
  opportunityId: string,
  opciones: OpcionesDeBorrador = {},
): Promise<string> {
  const oportunidad = await findOpportunityForFollowUpDraft(opportunityId, organizationId);
  if (!oportunidad) {
    throw new AppError("Oportunidad no encontrada", 404);
  }

  // El transcript es OPCIONAL: una oportunidad puede no tener contacto (solo
  // empresa), o tener un contacto que nunca habló con ningún agente. En los
  // dos casos el borrador se arma solo con los datos de la oportunidad.
  let transcript: string | null = null;
  if (oportunidad.contactId) {
    const conversacion = await findLatestConversationByContact(
      organizationId,
      oportunidad.contactId,
    );
    if (conversacion) {
      const mensajes = await findLastMessages(
        conversacion.id,
        organizationId,
        MENSAJES_DE_CONTEXTO,
      );
      transcript = armarTranscript(mensajes);
    }
  }

  const llm = opciones.llmProvider ?? getLlmProvider();

  const resultado = await llm.complete({
    systemPrompt: armarPromptDeBorrador(),
    messages: [
      {
        role: "user",
        content: armarContextoDeBorrador(
          {
            title: oportunidad.title,
            amount: oportunidad.amount.toString(),
            currency: oportunidad.currency,
            stageName: oportunidad.stage.name,
            createdAt: oportunidad.createdAt,
            updatedAt: oportunidad.updatedAt,
          },
          transcript,
          opciones.ahora ?? new Date(),
        ),
      },
    ],
    tools: [],
  });

  const borrador = limpiarRespuesta(resultado.text ?? "", BORRADOR_MAX_LENGTH);
  if (borrador.length === 0) {
    throw new LlmProviderError(MENSAJE_SIN_BORRADOR);
  }
  return borrador;
}
