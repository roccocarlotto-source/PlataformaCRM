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
  findOpenConversation,
  updateConversation,
} from "../repositories/conversation.repository";
import { createMessage, findLastMessages } from "../repositories/message.repository";
import { AppError } from "../utils/AppError";
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
} from "./llmProvider.service";

// ---------------------------------------------------------------------------
// Loop de orquestación del agente de IA — docs/ai-agent-architecture.md §4,
// paso a paso. Paso 2b del plan de §9.
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

// El cierre fijo de la red de seguridad. Es texto fijo y no generado a
// propósito: cuando se llega acá el modelo ya demostró que no puede resolver
// el turno, y pedirle "un cierre amable" sería darle otra oportunidad de
// inventar algo.
export const MENSAJE_DE_HANDOFF =
  "No pude resolver tu consulta en este momento, alguien del equipo te va a contactar.";

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
}

// ---------------------------------------------------------------------------
// Armado del contexto
// ---------------------------------------------------------------------------

function armarSystemPrompt(agent: { instructions: string; tone: string | null }): string {
  const partes = [agent.instructions.trim()];
  if (agent.tone && agent.tone.trim().length > 0) {
    partes.push(`Tono de la conversación: ${agent.tone.trim()}.`);
  }
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
// teléfono; si no lo tiene, el modelo tiene que pedirlo (y hoy no hay tool
// para guardarlo — eso es create_lead/update_lead, paso 3).
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
  let conversation =
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
    };
  }

  // Paso 2 de §4: el contexto.
  const systemPrompt = armarSystemPrompt(agent);
  const mensajes = await findLastMessages(conversation.id, organizationId, VENTANA_DE_MENSAJES);
  const historial = aHistorial(mensajes);
  const tools = toolsHabilitadas(agent.enabledTools);
  const toolsPorNombre = new Map<string, ToolDelAgente>(tools.map((t) => [t.definition.name, t]));
  const definiciones = tools.map((t) => t.definition);
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
    }

    // Texto final CON tools en la misma respuesta: se ejecutaron las tools
    // (el modelo las pidió y su resultado queda auditado) y el texto es la
    // respuesta del turno — se corta acá, no se le vuelve a preguntar.
    if (resultado.text !== null) {
      respuestaFinal = resultado.text;
      break;
    }
  }

  // Paso 7 de §4, con la red de seguridad de la nota bajo §6: si no hubo
  // respuesta final, se deriva.
  const handoff = respuestaFinal === null;
  const contenido: string = respuestaFinal ?? MENSAJE_DE_HANDOFF;

  if (handoff) {
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

  const saliente = await createMessage({
    organizationId,
    conversationId: conversation.id,
    direction: "OUTBOUND",
    senderType: "AGENT",
    content: contenido,
    ...(auditoria.length > 0 ? { toolCalls: auditoria as unknown as Prisma.InputJsonValue } : {}),
  });

  const statusFinal: ConversationStatus = handoff ? "TRANSFERRED_TO_HUMAN" : conversation.status;
  await updateConversation(conversation.id, organizationId, {
    lastMessageAt: saliente.createdAt,
    ...(handoff ? { status: statusFinal } : {}),
  });
  conversation = { ...conversation, status: statusFinal };

  return {
    conversationId: conversation.id,
    status: statusFinal,
    respuesta: contenido,
    toolCalls: auditoria,
    handoff,
  };
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
