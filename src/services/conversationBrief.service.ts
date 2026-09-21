import type { Message } from "@prisma/client";
import { updateConversation } from "../repositories/conversation.repository";
import { findMessagesByConversation } from "../repositories/message.repository";
import { AppError } from "../utils/AppError";
import { LlmProviderError, getLlmProvider, type LlmProvider } from "./llmProvider.service";

// ---------------------------------------------------------------------------
// El brief de una conversación (ítem 73 de docs/frontend-cambios-pendientes.md):
// dos a cuatro oraciones que cuentan qué pasó, redactadas por la IA.
//
// POR QUÉ EXISTE. Hasta acá, lo único parecido a un resumen era la Activity
// que `ejecutarHandoff` crea al derivar, con el motivo que dio el propio
// agente. Eso es una tarea en la bandeja de otro módulo, no algo que se vea en
// la conversación; y una conversación que nunca se derivó no tenía nada
// equivalente. Quien abre la bandeja y ve treinta hilos necesita saber de qué
// va cada uno sin leerlos enteros, y eso es todo lo que hace este archivo.
//
// ARCHIVO APARTE Y NO UNA FUNCIÓN MÁS EN agentOrchestration.service.ts, aunque
// su disparador automático viva ahí: esto no es parte del loop del turno. No
// ejecuta tools, no decide nada del comportamiento del agente y no toca el
// estado de la conversación más allá de su propio par de columnas. La relación
// es al revés de la que sugiere la cercanía — `ejecutarHandoff` importa esto,
// no esto a `ejecutarHandoff`—, y tenerlo separado es lo que deja que el
// endpoint manual (POST /api/conversations/:id/generate-brief) lo llame sin
// arrastrar el loop entero detrás.
//
// MISMO MOLDE QUE agentGuardrailsTranslation.service.ts, que es el otro lugar
// del proyecto donde se le pide una tarea puntual al modelo fuera de una
// conversación: `llm.complete({ systemPrompt, messages, tools: [] })`, SIN
// tools y SIN `model` —el adaptador usa el default de OPENROUTER_MODEL—, y con
// el proveedor inyectable para que el test sea unitario, sin red y sin base.
// Resumir es una tarea de criterio fijo, no parte del comportamiento
// configurable de ningún agente, así que no depende del `modelName` del Agent
// que atendió la conversación.
// ---------------------------------------------------------------------------

// Tope de lo que se guarda, no del prompt. El prompt ya pide 2 a 4 oraciones y
// un modelo que respeta la consigna nunca se acerca a esto; el recorte existe
// para el que no la respeta, porque `brief` es TEXT y sin tope una respuesta
// desbocada entraría entera en la columna y después en cada fila del listado.
export const BRIEF_MAX_LENGTH = 2000;

// Los tres autores posibles de un mensaje, con el mismo criterio de etiquetas
// que las burbujas del hilo en ConversationDetail.tsx: quién ESCRIBIÓ el
// mensaje lo dice `senderType`, no `direction` (los dos enums son ortogonales
// en el schema — la dirección dice por dónde viajó, el tipo de emisor dice
// quién lo redactó).
//
// Rótulos genéricos y no los nombres reales (el contacto, el agente, el
// vendedor): el modelo tiene que resumir QUÉ PASÓ, y meter tres nombres
// propios en el transcript lo empuja a repetirlos en el resumen, que es
// justamente lo que la pantalla ya muestra al lado del brief. Además evita
// mandarle datos personales al proveedor sin necesidad
// (docs/data-classification.md).
const ROTULO_POR_EMISOR: Record<Message["senderType"], string> = {
  CONTACT: "Cliente",
  AGENT: "Agente",
  HUMAN: "Humano",
};

// El transcript que ve el modelo: una línea por mensaje, en el orden en que
// ocurrieron (findMessagesByConversation ya devuelve por createdAt ascendente,
// así que acá no se reordena nada).
//
// SIN toolCalls, SIN fechas y SIN ids. Lo que el brief tiene que contar —qué
// quería el cliente, qué se resolvió, por qué se derivó— está en lo que se
// dijeron; la auditoría del turno es otra cosa y ya tiene su lugar en el hilo.
// Un mensaje vacío o en blanco se saltea en vez de producir una línea huérfana
// que el modelo tendría que interpretar.
export function armarTranscript(messages: Message[]): string {
  return messages
    .filter((message) => message.content.trim().length > 0)
    .map((message) => `${ROTULO_POR_EMISOR[message.senderType]}: ${message.content.trim()}`)
    .join("\n");
}

// Fijo y sin interpolación: no depende del agente, de la organización ni de la
// conversación. Es una constante con forma de función por simetría con
// armarPromptDeTraduccion(), y para que el test lo compare contra la misma
// fuente que usa producción en vez de contra una copia pegada a mano.
export function armarPromptDeBrief(): string {
  return [
    "Sos un asistente que resume conversaciones de atención comercial para el equipo de ventas de una empresa.",
    "",
    "Te paso la transcripción completa de una conversación. Cada línea empieza con quién habló:",
    '- "Cliente" es la persona que escribió desde afuera.',
    '- "Agente" es el asistente automático que la atendió.',
    '- "Humano" es alguien del equipo de ventas que entró a contestar después de una derivación.',
    "",
    "Escribí un resumen de 2 a 4 oraciones, en español rioplatense, que cuente:",
    "1. Qué quería el cliente.",
    "2. Qué se resolvió o qué acción se tomó.",
    "3. Si la conversación se derivó a una persona, por qué.",
    "",
    "Reglas:",
    "- Respondé SOLO con el texto del resumen. Sin títulos, sin viñetas, sin comillas y sin ninguna explicación de lo que hiciste.",
    "- Escribí en tercera persona y en pasado.",
    "- No inventes nada que no esté en la transcripción. Si algo no quedó claro, decilo en vez de suponerlo.",
    "- Si la conversación es demasiado corta para saber qué quería el cliente, decí exactamente eso en una sola oración.",
  ].join("\n");
}

// El modelo puede responder null (solo pidió tools, imposible acá porque no se
// le dan) o un texto en blanco. Ninguna de las dos cosas es un resumen, y
// guardar "" sería peor que no guardar nada: la pantalla lo mostraría como si
// hubiera un brief vacío en vez de ofrecer generarlo.
const MENSAJE_SIN_RESUMEN = "El modelo no devolvió ningún resumen";

// Las comillas envolventes son el desvío más común del "respondé solo con el
// texto": el modelo entrega el resumen entrecomillado. Se sacan acá y no se le
// pide una vez más en el prompt, porque limpiar una comilla es determinístico y
// pedirlo de nuevo no lo es.
//
// Exportada con el tope como parámetro (ítem 76): el borrador de seguimiento
// de opportunityFollowUpDraft.service.ts tiene exactamente el mismo desvío que
// limpiar, con otro tope.
export function limpiarRespuesta(texto: string, max: number = BRIEF_MAX_LENGTH): string {
  const sinEspacios = texto.trim();
  const entrecomillado =
    sinEspacios.length >= 2 &&
    ((sinEspacios.startsWith('"') && sinEspacios.endsWith('"')) ||
      (sinEspacios.startsWith("“") && sinEspacios.endsWith("”")));
  return (entrecomillado ? sinEspacios.slice(1, -1).trim() : sinEspacios).slice(0, max);
}

// ---------------------------------------------------------------------------
// El punto de entrada
//
// Devuelve el brief que quedó GUARDADO, no la conversación: quien necesita la
// fila entera la vuelve a leer (lo hace el controller, para devolver el detalle
// completo y que la cache del frontend quede consistente de una).
//
// `briefEditedByUserId` vuelve a NULL SIEMPRE, incluso si una persona había
// editado el brief a mano antes. No es un efecto colateral: es lo que la
// columna significa —quién escribió el texto que hoy está guardado—, y el texto
// que queda después de esto lo escribió el modelo. Regenerar es exactamente
// pedir eso.
// ---------------------------------------------------------------------------
export async function generarBriefDeConversacion(
  organizationId: string,
  conversationId: string,
  llmProvider?: LlmProvider,
): Promise<string> {
  const messages = await findMessagesByConversation(conversationId, organizationId);
  const transcript = armarTranscript(messages);

  // Sin un solo mensaje con texto no hay nada que resumir, y gastar una llamada
  // al proveedor para que conteste "la conversación está vacía" es peor que no
  // llamarlo: cuesta, tarda y puede fallar. Mismo criterio que el texto vacío
  // en translateGuardrailsText. 400 y no 500 porque no falló nada: pedir el
  // resumen de una conversación sin mensajes es un pedido que no tiene
  // respuesta, y quien lo hizo tiene que poder leer por qué.
  if (transcript.length === 0) {
    throw new AppError("La conversación todavía no tiene mensajes para resumir", 400);
  }

  const llm = llmProvider ?? getLlmProvider();

  const resultado = await llm.complete({
    systemPrompt: armarPromptDeBrief(),
    messages: [{ role: "user", content: transcript }],
    tools: [],
  });

  const brief = limpiarRespuesta(resultado.text ?? "");
  if (brief.length === 0) {
    throw new LlmProviderError(MENSAJE_SIN_RESUMEN);
  }

  await updateConversation(conversationId, organizationId, {
    brief,
    briefEditedByUserId: null,
  });

  return brief;
}
