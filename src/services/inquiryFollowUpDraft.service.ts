import { prisma } from "../lib/prisma";
import { findLastMessages } from "../repositories/message.repository";
import { AppError } from "../utils/AppError";
import { nombreUsableDelContacto } from "./agentOrchestration.service";
import { vehiculoParaElMensaje } from "./automationActions/inquiryFollowUp";
import { armarTranscript, limpiarRespuesta } from "./conversationBrief.service";
import { LlmProviderError, getLlmProvider, type LlmProvider } from "./llmProvider.service";

// ---------------------------------------------------------------------------
// El mensaje libre con el que el agente retoma una consulta estancada por
// WhatsApp dentro de la ventana de 24 h (ítem 185 de
// docs/frontend-cambios-pendientes.md). A diferencia del borrador de una
// oportunidad (opportunityFollowUpDraft.service.ts), ESTE SÍ SE LE MANDA AL
// CLIENTE sin que nadie lo revise: por eso el prompt es más corto y más
// estricto (nada que no esté en la conversación, sin precios, sin promesas),
// y el worker lo usa solo cuando Meta acepta texto libre; pasada la ventana
// sale la plantilla aprobada.
//
// MISMO MOLDE que el borrador: llm.complete sin tools, proveedor inyectable.
// ---------------------------------------------------------------------------

export const MENSAJE_MAX_LENGTH = 1000;
export const MENSAJES_DE_CONTEXTO = 40;
const MS_POR_DIA = 24 * 60 * 60 * 1000;

export function armarPromptDeSeguimientoDeConsulta(): string {
  return [
    "Sos el asistente virtual de un negocio que atiende consultas de clientes por WhatsApp.",
    "",
    'Te paso la conversación que tuviste con un cliente que consultó y después dejó de responder, y algunos datos. Cada línea empieza con quién habló: "Cliente" es el cliente, "Agente" sos vos y "Humano" es alguien del equipo.',
    "",
    "Escribí UN mensaje breve para retomar la conversación, que se le va a mandar al cliente tal cual, sin revisión.",
    "",
    "Reglas:",
    "- Español rioplatense, tono cordial y cercano, sin presionar ni insistir.",
    "- Entre 2 y 3 oraciones. Retomá lo último que quedó pendiente y terminá con una pregunta concreta y fácil de responder.",
    "- Si te paso el nombre del cliente, saludalo por su nombre; si no, saludá sin nombre. No inventes un nombre.",
    "- No inventes precios, descuentos, plazos, stock ni ningún dato que no esté en lo que te paso. No prometas nada.",
    "- No uses marcadores para completar (nada entre corchetes ni entre llaves).",
    "- Respondé SOLO con el texto del mensaje. Sin títulos, sin comillas y sin ninguna explicación.",
  ].join("\n");
}

export interface DatosDeLaConsulta {
  nombre: string | null;
  vehiculo: string;
  lastInboundAt: Date;
}

export function armarContextoDeConsulta(
  datos: DatosDeLaConsulta,
  transcript: string,
  ahora: Date,
): string {
  const dias = Math.max(
    0,
    Math.floor((ahora.getTime() - datos.lastInboundAt.getTime()) / MS_POR_DIA),
  );
  return [
    "Datos:",
    `- Nombre del cliente: ${datos.nombre ?? "no se sabe (saludá sin nombre)"}`,
    `- Le interesa: ${datos.vehiculo}`,
    `- Su último mensaje fue hace ${String(dias)} ${dias === 1 ? "día" : "días"}`,
    "",
    "Conversación (del más viejo al más nuevo):",
    transcript,
  ].join("\n");
}

export interface OpcionesDeMensaje {
  llmProvider?: LlmProvider;
  ahora?: Date;
  signal?: AbortSignal;
}

// Devuelve el texto y no escribe nada: mandarlo y anotarlo es trabajo del
// worker.
export async function generarMensajeDeSeguimientoDeConsulta(
  organizationId: string,
  contactId: string,
  conversationId: string,
  lastInboundAt: Date,
  opciones: OpcionesDeMensaje = {},
): Promise<string> {
  const contacto = await prisma.contact.findFirst({
    where: { id: contactId, organizationId, deletedAt: null },
    select: {
      firstName: true,
      lastName: true,
      leadServiceOfInterest: true,
      vehicleOfInterest: { select: { make: true, model: true, trim: true, year: true } },
    },
  });
  if (!contacto) {
    throw new AppError("Contacto no encontrado", 404);
  }
  const mensajes = await findLastMessages(conversationId, organizationId, MENSAJES_DE_CONTEXTO);
  const transcript = armarTranscript(mensajes);

  const llm = opciones.llmProvider ?? getLlmProvider();
  const resultado = await llm.complete({
    systemPrompt: armarPromptDeSeguimientoDeConsulta(),
    messages: [
      {
        role: "user",
        content: armarContextoDeConsulta(
          {
            nombre: nombreUsableDelContacto(contacto),
            vehiculo: vehiculoParaElMensaje(contacto),
            lastInboundAt,
          },
          transcript,
          opciones.ahora ?? new Date(),
        ),
      },
    ],
    tools: [],
    signal: opciones.signal,
  });

  const texto = limpiarRespuesta(resultado.text ?? "", MENSAJE_MAX_LENGTH);
  if (texto.length === 0) {
    throw new LlmProviderError("El modelo no devolvió ningún mensaje de seguimiento");
  }
  return texto;
}
