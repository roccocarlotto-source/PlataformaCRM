import type {
  Contact,
  ConversationChannel,
  ConversationStatus,
  Message,
  Prisma,
} from "@prisma/client";
import { logger } from "../lib/logger";
import { findAgentById } from "../repositories/agent.repository";
import { findContactById } from "../repositories/contact.repository";
import {
  createConversation,
  findConversationById,
  findOpenConversation,
  updateConversation,
} from "../repositories/conversation.repository";
import { createMessage, findLastMessages } from "../repositories/message.repository";
import { AppError } from "../utils/AppError";
import { createActivity } from "./activity.service";
import { puedeEjecutarTool, type DatosDisponibles } from "./agentPermissions.service";
import {
  toolsHabilitadas,
  type ContextoDeEjecucionDeTool,
  type ResultadoDeTool,
  type ToolDelAgente,
} from "./agentTools.service";
import {
  getLlmProvider,
  type LlmMessage,
  type LlmProvider,
  type LlmToolCall,
  type LlmToolDefinition,
} from "./llmProvider.service";

// ---------------------------------------------------------------------------
// Loop de orquestación del agente de IA — docs/ai-agent-architecture.md §4,
// paso a paso. Paso 2b del plan de §9; el handoff completo es el paso 4.
//
// ES EL MISMO LOOP PARA TODOS LOS CANALES: lo que cambia entre Web y WhatsApp
// es cómo entra el mensaje y cómo sale la respuesta, y eso vive en el endpoint
// de cada canal, no acá. Hoy el único caller es el endpoint interno de prueba
// (POST /api/agents/:id/test-message); el canal Web público y el webhook de
// WhatsApp son pasos posteriores del plan y van a llamar a esta misma función.
//
// EL PROVEEDOR DE LLM ES INYECTABLE y por default es getLlmProvider(), mismo
// patrón exacto que `cliente?: ClienteGoogleCalendar` en createBooking: los
// tests de integración de este archivo ejercitan el loop entero contra
// Postgres real con un proveedor falso guionado, sin red.
// ---------------------------------------------------------------------------

// Tope de rondas de tool-calling por turno (nota del 12/09/2026 bajo §6, punto
// 3). Una "ronda" es una llamada al modelo: si en 5 llamadas seguidas el
// modelo pide tools y nunca produce una respuesta final, algo no está
// funcionando —una tool que falla siempre, un modelo que insiste con una
// acción prohibida— y seguir insistiendo no lo va a arreglar. Cinco alcanza
// para el flujo real más largo de las tools de hoy (consultar disponibilidad,
// reservar, crear la oportunidad, responder) con margen para un reintento.
export const MAX_TOOL_ROUNDS_PER_TURN = 5;

// Ventana de contexto (§10, resuelta el 12/09/2026): los últimos 20 mensajes,
// truncado simple.
export const VENTANA_DE_MENSAJES = 20;

// El cierre fijo de una derivación cuando el modelo no dio texto propio. Es
// texto fijo y no generado a propósito: si se llega acá por el tope de rondas
// el modelo ya demostró que no puede resolver el turno, y pedirle "un cierre
// amable" sería darle otra oportunidad de inventar algo.
export const MENSAJE_DE_HANDOFF =
  "No pude resolver tu consulta en este momento, alguien del equipo te va a contactar.";

// El motivo con el que la red de seguridad del tope de rondas deriva (nota
// del paso 4 bajo §6, punto 4).
export const MOTIVO_TOPE_DE_RONDAS = "El agente no pudo resolver el caso en el tiempo esperado";

// ---------------------------------------------------------------------------
// request_human_handoff — la tool del sistema (nota del paso 4 bajo §6,
// punto 2). SIEMPRE disponible, sin importar Agent.enabledTools, y SIN pasar
// por puedeEjecutarTool: es la salida de emergencia, y bloquearla sería
// contradictorio con para qué sirve. Vive acá y no en CATALOGO_DE_TOOLS
// justamente porque no es una acción de negocio configurable.
// ---------------------------------------------------------------------------
export const REQUEST_HUMAN_HANDOFF_TOOL_NAME = "request_human_handoff";

export const REQUEST_HUMAN_HANDOFF_TOOL: LlmToolDefinition = {
  name: REQUEST_HUMAN_HANDOFF_TOOL_NAME,
  description:
    "Deriva esta conversación a una persona del equipo y deja de responder como agente. Usala cuando el contacto pide explícitamente hablar con una persona, cuando la conversación coincide con una situación de derivación configurada, cuando te preguntan por un tema sobre el que no podés opinar, o cuando la única forma de ayudar es una acción que no tenés disponible. Podés acompañarla con un mensaje de cierre para el contacto.",
  parameters: {
    type: "object",
    properties: {
      reason: {
        type: "string",
        description:
          "Motivo breve de la derivación, para la persona que va a tomar la conversación (ej. el cliente pide hablar con un vendedor; reclamo por una entrega).",
      },
    },
    required: ["reason"],
    additionalProperties: false,
  },
};

export interface RunAgentTurnInput {
  organizationId: string;
  agentId: string;
  contactId: string;
  channel: ConversationChannel;
  texto: string;
}

export interface RunAgentTurnOptions {
  llmProvider?: LlmProvider;
}

// Auditoría de una tool call del turno: lo que va a Message.toolCalls (§6) y
// lo que devuelve el endpoint. `allowed: false` lleva el motivo de
// puedeEjecutarTool; `result` solo existe si se ejecutó.
export interface ToolCallDelTurno {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  allowed: boolean;
  reason?: string;
  result?: ResultadoDeTool;
}

export interface ResultadoDelTurno {
  conversationId: string;
  status: ConversationStatus;
  // null cuando el agente NO respondió: la conversación ya estaba derivada a
  // un humano y el mensaje solo se registró en el hilo.
  respuesta: string | null;
  toolCalls: ToolCallDelTurno[];
  // true si ESTE turno disparó la derivación.
  handoff: boolean;
  // El id de la Activity creada por la derivación de ESTE turno, o null: sin
  // handoff, o con handoff pero sin vendedor asignado al contacto (nota del
  // paso 4 bajo §6, punto 1). Expuesto para poder verificarlo desde el
  // endpoint de prueba sin ir a mirar la base.
  handoffActivityId: string | null;
}

// ---------------------------------------------------------------------------
// Armado del contexto
// ---------------------------------------------------------------------------

// Lecturas tolerantes del Json de guardrails, mismo criterio que
// puedeEjecutarTool: una clave ausente o mal tipeada es "no configurada".
function listaDeGuardrails(guardrails: unknown, clave: string): string[] {
  if (!guardrails || typeof guardrails !== "object" || Array.isArray(guardrails)) {
    return [];
  }
  const valor = (guardrails as Record<string, unknown>)[clave];
  return Array.isArray(valor)
    ? valor.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    : [];
}

function enumerar(items: string[]): string {
  return items.map((item) => `- ${item.trim()}`).join("\n");
}

// instructions + tono + lo que gobierna lo que el modelo puede DECIR (nota
// del paso 4 bajo §6, punto 3): temasProhibidos, promesasProhibidas y
// condicionesDeDerivacion no son gates de ejecución de tools —eso es
// puedeEjecutarTool— sino instrucciones que el modelo tiene que conocer de
// antemano. La instrucción de derivación va SIEMPRE, con o sin condiciones
// configuradas: los otros dos disparadores de §6 (el contacto lo pide, una
// acción bloqueada es la única forma de seguir) no dependen de configuración.
export function armarSystemPrompt(agent: {
  instructions: string;
  tone: string | null;
  guardrails: unknown;
}): string {
  const partes = [agent.instructions.trim()];

  if (agent.tone && agent.tone.trim().length > 0) {
    partes.push(`Tono de la conversación: ${agent.tone.trim()}.`);
  }

  const temas = listaDeGuardrails(agent.guardrails, "temasProhibidos");
  if (temas.length > 0) {
    partes.push(
      `No respondas ni opines sobre los siguientes temas:\n${enumerar(temas)}\nSi te preguntan por alguno, derivá con ${REQUEST_HUMAN_HANDOFF_TOOL_NAME}.`,
    );
  }

  const promesas = listaDeGuardrails(agent.guardrails, "promesasProhibidas");
  if (promesas.length > 0) {
    partes.push(`Nunca prometas ni confirmes:\n${enumerar(promesas)}`);
  }

  const condiciones = listaDeGuardrails(agent.guardrails, "condicionesDeDerivacion");
  const disparadoresFijos = `si el contacto pide explícitamente hablar con una persona, o si una acción que necesitás no está disponible y no hay otra forma de ayudar.`;
  partes.push(
    condiciones.length > 0
      ? `Llamá a ${REQUEST_HUMAN_HANDOFF_TOOL_NAME} si la conversación coincide con alguna de estas situaciones:\n${enumerar(condiciones)}\nTambién usá ${REQUEST_HUMAN_HANDOFF_TOOL_NAME} ${disparadoresFijos}`
      : `Usá ${REQUEST_HUMAN_HANDOFF_TOOL_NAME} ${disparadoresFijos}`,
  );

  return partes.join("\n\n");
}

// Los Message persistidos → el historial neutral que entiende LlmProvider.
//
// Los turnos previos del asistente van como TEXTO: sus tool calls quedaron en
// Message.toolCalls como auditoría y no se reinyectan como `tool_calls` al
// modelo, porque reconstruir el par pedido/resultado exacto de turnos viejos
// no aporta nada a la conversación y sí obliga a que la ventana no corte a
// mitad de un par (varios proveedores rechazan un tool_call sin su
// resultado). Lo que un humano escribió en el hilo (HUMAN, tras un handoff)
// también va del lado del asistente: para el modelo es "lo que dijo el
// negocio".
function aHistorial(mensajes: Message[]): LlmMessage[] {
  const historial: LlmMessage[] = [];
  for (const m of mensajes) {
    if (m.content.trim().length === 0) {
      continue;
    }
    if (m.direction === "INBOUND") {
      historial.push({ role: "user", content: m.content });
    } else {
      historial.push({ role: "assistant", content: m.content });
    }
  }
  return historial;
}

// Lo que la conversación YA SABE, para la comprobación (4) de
// puedeEjecutarTool: los ids de la conversación misma y los datos del Contact
// que ya están cargados. Un guardrail como
// `datosRequeridosAntesDeAccion.create_booking = ["contactId", "phone"]`
// se satisface con el contacto de la conversación si ese contacto tiene
// teléfono; si no lo tiene, el modelo tiene que pedirlo.
function datosDisponiblesDeLaConversacion(
  conversation: {
    id: string;
    contactId: string;
    branchId: string;
    agentId: string;
    channel: ConversationChannel;
  },
  contact: Contact,
): DatosDisponibles {
  return {
    conversationId: conversation.id,
    contactId: conversation.contactId,
    branchId: conversation.branchId,
    agentId: conversation.agentId,
    channel: conversation.channel,
    firstName: contact.firstName,
    lastName: contact.lastName,
    email: contact.email,
    phone: contact.phone,
    companyId: contact.companyId,
  };
}

// ---------------------------------------------------------------------------
// La derivación — compartida por la tool y por el tope de rondas (nota del
// paso 4 bajo §6).
//
// DOS MITADES CON GARANTÍAS DISTINTAS. La transición de status es la garantía
// central —el agente deja de responder solo— y ocurre SIEMPRE. La Activity es
// la notificación al negocio y es best-effort: necesita un vendedor asignado
// al contacto (authorId es NOT NULL) y puede fallar por lo que sea; en los dos
// casos se loguea y se sigue, porque la transición ya ocurrió y es lo que no
// puede fallar. Idempotente: una conversación ya derivada no genera una
// segunda Activity.
// ---------------------------------------------------------------------------
export interface HandoffInput {
  organizationId: string;
  conversationId: string;
  contact: Pick<Contact, "id" | "ownerId" | "firstName" | "lastName">;
  agentName: string;
  motivo: string;
}

export async function ejecutarHandoff(input: HandoffInput): Promise<{ activityId: string | null }> {
  const { organizationId, conversationId, contact, motivo } = input;

  const actual = await findConversationById(conversationId, organizationId);
  if (!actual) {
    throw new AppError("Conversación no encontrada", 404);
  }
  if (actual.status === "TRANSFERRED_TO_HUMAN") {
    // Ya derivada: nada que hacer, y sobre todo nada que notificar dos veces.
    return { activityId: null };
  }

  await updateConversation(conversationId, organizationId, {
    status: "TRANSFERRED_TO_HUMAN",
    assignedUserId: contact.ownerId,
  });

  if (!contact.ownerId) {
    logger.warn(
      { organizationId, conversationId, contactId: contact.id },
      "Conversación derivada a humano sin vendedor asignado al contacto: no se crea Activity (derivación silenciosa)",
    );
    return { activityId: null };
  }

  try {
    const nombre = `${contact.firstName} ${contact.lastName}`.trim();
    const activity = await createActivity(organizationId, contact.ownerId, {
      type: "TASK",
      subject: `Conversación derivada por el agente ${input.agentName}: ${nombre}`.slice(0, 255),
      body: motivo,
      assigneeId: contact.ownerId,
      contactId: contact.id,
    });
    return { activityId: activity.id };
  } catch (err) {
    // El vendedor pudo haber sido desactivado, o la base tuvo un mal momento.
    // La conversación ya está derivada; lo que se pierde es el aviso.
    logger.warn(
      { err, organizationId, conversationId, contactId: contact.id },
      "Conversación derivada a humano pero no se pudo crear la Activity de aviso",
    );
    return { activityId: null };
  }
}

// ---------------------------------------------------------------------------
// El turno
// ---------------------------------------------------------------------------

export async function runAgentTurn(
  input: RunAgentTurnInput,
  options: RunAgentTurnOptions = {},
): Promise<ResultadoDelTurno> {
  const { organizationId, agentId, contactId, channel } = input;
  const texto = input.texto.trim();
  if (texto.length === 0) {
    throw new AppError("El mensaje no puede estar vacío", 400);
  }

  const agent = await findAgentById(agentId, organizationId);
  if (!agent) {
    throw new AppError("Agente no encontrado", 404);
  }
  if (!agent.isActive) {
    throw new AppError("El agente está desactivado", 400);
  }
  // Agent.channels es "en qué canales puede operar" (§3). Un agente sin el
  // canal no atiende por él, y el endpoint de prueba no es excepción: prueba
  // el agente tal como va a operar.
  if (!agent.channels.includes(channel)) {
    throw new AppError(`El agente no opera en el canal ${channel}`, 400);
  }

  const contact = await findContactById(contactId, organizationId);
  if (!contact) {
    throw new AppError("El contacto indicado no existe o no pertenece a tu organización", 400);
  }

  // Paso 1 de §4: resolver o crear la Conversation y persistir el entrante.
  const conversation =
    (await findOpenConversation(organizationId, agentId, contactId, channel)) ??
    (await createConversation({
      organizationId,
      branchId: agent.branchId,
      agentId,
      contactId,
      channel,
    }));

  const entrante = await createMessage({
    organizationId,
    conversationId: conversation.id,
    direction: "INBOUND",
    senderType: "CONTACT",
    content: texto,
  });
  await updateConversation(conversation.id, organizationId, {
    lastMessageAt: entrante.createdAt,
  });

  // Una conversación YA DERIVADA no la responde el agente: el mensaje queda
  // en el hilo para el humano que la tomó, y nada más. Volver a meter al
  // agente después de un handoff sería deshacer la derivación por la puerta
  // de atrás.
  if (conversation.status === "TRANSFERRED_TO_HUMAN") {
    return {
      conversationId: conversation.id,
      status: conversation.status,
      respuesta: null,
      toolCalls: [],
      handoff: false,
      handoffActivityId: null,
    };
  }

  // Paso 2 de §4: el contexto.
  const systemPrompt = armarSystemPrompt(agent);
  const mensajes = await findLastMessages(conversation.id, organizationId, VENTANA_DE_MENSAJES);
  const historial = aHistorial(mensajes);
  const tools = toolsHabilitadas(agent.enabledTools);
  const toolsPorNombre = new Map<string, ToolDelAgente>(tools.map((t) => [t.definition.name, t]));
  // El catálogo filtrado por enabledTools + la tool del sistema, SIEMPRE.
  const definiciones = [...tools.map((t) => t.definition), REQUEST_HUMAN_HANDOFF_TOOL];
  const datosDisponibles = datosDisponiblesDeLaConversacion(conversation, contact);
  const contextoDeTools: ContextoDeEjecucionDeTool = {
    organizationId,
    conversation: {
      id: conversation.id,
      contactId: conversation.contactId,
      branchId: conversation.branchId,
      agentId: conversation.agentId,
    },
  };

  const llm = options.llmProvider ?? getLlmProvider();
  const auditoria: ToolCallDelTurno[] = [];
  let respuestaFinal: string | null = null;
  // El motivo con el que se deriva, si este turno deriva. null = no derivar.
  let motivoDeHandoff: string | null = null;

  // Pasos 3 a 6 de §4: el loop de tool-calling.
  for (let ronda = 0; ronda < MAX_TOOL_ROUNDS_PER_TURN; ronda++) {
    const resultado = await llm.complete({
      systemPrompt,
      messages: historial,
      tools: definiciones,
      model: agent.modelName,
    });

    if (resultado.toolCalls.length === 0) {
      // Sin tools. Texto = respuesta final. Sin texto tampoco = el modelo no
      // produjo nada: se cuenta como una ronda fallida y se sigue, para que
      // el tope de rondas decida (un modelo que devuelve vacío dos veces
      // seguidas no va a mejorar a la tercera, pero una vez puede ser ruido).
      if (resultado.text !== null) {
        respuestaFinal = resultado.text;
        break;
      }
      continue;
    }

    // El modelo pidió tools. Se registra su turno tal cual (texto + pedidos)
    // y se resuelve cada pedido en orden.
    historial.push({
      role: "assistant",
      content: resultado.text,
      toolCalls: resultado.toolCalls,
    });

    for (const llamada of resultado.toolCalls) {
      const entrada = await resolverToolCall(llamada, {
        agent,
        toolsPorNombre,
        datosDisponibles,
        contextoDeTools,
      });
      auditoria.push(entrada);
      historial.push({
        role: "tool",
        toolCallId: llamada.id,
        content: JSON.stringify(
          entrada.result ?? { ok: false, error: entrada.reason ?? "Acción no disponible" },
        ),
      });

      if (llamada.name === REQUEST_HUMAN_HANDOFF_TOOL_NAME && motivoDeHandoff === null) {
        motivoDeHandoff = motivoDeLaLlamada(llamada);
      }
    }

    // El modelo pidió derivar: se corta acá, con el texto de esta misma
    // respuesta si lo dio (igual que el caso texto+tools de abajo) o con el
    // cierre fijo si no. No se le vuelve a preguntar: ya decidió.
    if (motivoDeHandoff !== null) {
      respuestaFinal = resultado.text ?? MENSAJE_DE_HANDOFF;
      break;
    }

    // Texto final CON tools en la misma respuesta: se ejecutaron las tools
    // (el modelo las pidió y su resultado queda auditado) y el texto es la
    // respuesta del turno — se corta acá, no se le vuelve a preguntar.
    if (resultado.text !== null) {
      respuestaFinal = resultado.text;
      break;
    }
  }

  // Paso 7 de §4, con la red de seguridad de la nota bajo §6: sin respuesta
  // final tras el tope de rondas, se deriva con el motivo fijo.
  if (respuestaFinal === null) {
    motivoDeHandoff = MOTIVO_TOPE_DE_RONDAS;
    respuestaFinal = MENSAJE_DE_HANDOFF;
    logger.warn(
      {
        organizationId,
        agentId,
        conversationId: conversation.id,
        rondas: MAX_TOOL_ROUNDS_PER_TURN,
      },
      "El agente agotó el tope de rondas de tool-calling sin respuesta final: conversación derivada a humano",
    );
  }

  const handoff = motivoDeHandoff !== null;
  let handoffActivityId: string | null = null;
  if (motivoDeHandoff !== null) {
    ({ activityId: handoffActivityId } = await ejecutarHandoff({
      organizationId,
      conversationId: conversation.id,
      contact,
      agentName: agent.name,
      motivo: motivoDeHandoff,
    }));
  }

  const saliente = await createMessage({
    organizationId,
    conversationId: conversation.id,
    direction: "OUTBOUND",
    senderType: "AGENT",
    content: respuestaFinal,
    ...(auditoria.length > 0 ? { toolCalls: auditoria as unknown as Prisma.InputJsonValue } : {}),
  });
  await updateConversation(conversation.id, organizationId, {
    lastMessageAt: saliente.createdAt,
  });

  const statusFinal: ConversationStatus = handoff ? "TRANSFERRED_TO_HUMAN" : conversation.status;

  return {
    conversationId: conversation.id,
    status: statusFinal,
    respuesta: respuestaFinal,
    toolCalls: auditoria,
    handoff,
    handoffActivityId,
  };
}

// El `reason` de request_human_handoff. Si el modelo no lo mandó o mandó algo
// que no es texto, la derivación ocurre IGUAL con un motivo genérico: la
// salida de emergencia no se cierra por un argumento mal formado.
function motivoDeLaLlamada(llamada: LlmToolCall): string {
  const reason = llamada.arguments.reason;
  return typeof reason === "string" && reason.trim().length > 0
    ? reason.trim().slice(0, 2000)
    : "El agente pidió derivar la conversación sin indicar un motivo";
}

// Paso 4-5 de §4 para UNA tool call: permisos primero, ejecución después.
// Nunca se inventa un resultado: si no se puede, la entrada dice por qué.
async function resolverToolCall(
  llamada: LlmToolCall,
  deps: {
    agent: { enabledTools: string[]; guardrails: unknown };
    toolsPorNombre: Map<string, ToolDelAgente>;
    datosDisponibles: DatosDisponibles;
    contextoDeTools: ContextoDeEjecucionDeTool;
  },
): Promise<ToolCallDelTurno> {
  const base = { id: llamada.id, name: llamada.name, arguments: llamada.arguments };

  // La tool del sistema: sin puedeEjecutarTool y sin catálogo. Se "ejecuta"
  // registrando el pedido; la derivación real la hace el loop al terminar la
  // ronda (ejecutarHandoff), una sola vez aunque el modelo la pida dos veces.
  if (llamada.name === REQUEST_HUMAN_HANDOFF_TOOL_NAME) {
    return {
      ...base,
      allowed: true,
      result: { ok: true, data: { handoff: true, reason: motivoDeLaLlamada(llamada) } },
    };
  }

  const decision = puedeEjecutarTool(
    deps.agent,
    llamada.name,
    llamada.arguments,
    deps.datosDisponibles,
  );
  if (!decision.allowed) {
    return { ...base, allowed: false, reason: decision.reason };
  }

  // Permitida por el agente pero inexistente en el catálogo (un nombre de
  // enabledTools que no corresponde a nada real, o un modelo que inventó una
  // tool que nunca se le ofreció). No es "prohibida": es "no existe".
  const tool = deps.toolsPorNombre.get(llamada.name);
  if (!tool) {
    return {
      ...base,
      allowed: false,
      reason: `La acción "${llamada.name}" no existe`,
    };
  }

  const result = await tool.ejecutar(llamada.arguments, deps.contextoDeTools);
  return { ...base, allowed: true, result };
}
