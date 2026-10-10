import type {
  InternalAgent,
  InternalAgentMessage,
  OrganizationIndustry,
  Prisma,
} from "@prisma/client";
import { logger } from "../lib/logger";
import {
  createInternalAgentMessage,
  findInternalAgentByOrganization,
  findLastInternalAgentMessages,
  type CreateInternalAgentMessageData,
} from "../repositories/internalAgent.repository";
import { findOrganizationById } from "../repositories/organization.repository";
import type { RoleName } from "../types/auth";
import { AppError } from "../utils/AppError";
import { isoEnZona } from "../utils/timezone";
import {
  MAX_TOOL_ROUNDS_PER_TURN,
  VENTANA_DE_MENSAJES,
  type ToolCallDelTurno,
} from "./agentOrchestration.service";
import { canonizarNombreDeTool } from "./agentTools.service";
import {
  toolsHabilitadasInternas,
  type ContextoDeEjecucionDeToolInterna,
  type ToolInterna,
} from "./internalAgentTools.service";
import {
  getLlmProvider,
  LlmProviderError,
  type LlmCompletionResult,
  type LlmMessage,
  type LlmProvider,
  type LlmToolCall,
} from "./llmProvider.service";

// ---------------------------------------------------------------------------
// Loop del agente de IA INTERNO (ítem 179 de docs/frontend-cambios-pendientes.md).
//
// MUCHO MÁS CHICO QUE agentOrchestration.service.ts, y a propósito: no hay
// canales, ni contacto, ni derivación a una persona, ni brief, ni guardas de
// fuga del prompt hacia un cliente. Quien escribe es un empleado de la
// organización consultando sobre su propio negocio. De aquel loop se reusa
// solo lo que ya es agnóstico: getLlmProvider y sus tipos, el tope de rondas y
// la ventana de mensajes (mismos valores, por las mismas razones), la
// canonización de nombres de tools (ítem 90) y la forma de la auditoría.
//
// El proveedor de LLM es inyectable, mismo patrón que runAgentTurn: los tests
// guionan un proveedor falso. Y a diferencia de aquel loop, también lo son la
// base y el catálogo (DependenciasDelTurnoInterno, mismo patrón que
// DependenciasDeCupones del ítem 176): el loop entero se prueba sin Postgres
// en internalAgentOrchestration.service.test.ts, y contra Postgres real en la
// integración.
// ---------------------------------------------------------------------------

export const MENSAJE_SIN_AGENTE_INTERNO =
  "Esta organización no configuró un agente interno todavía";

// El cierre fijo cuando el turno no produce una respuesta utilizable (tope de
// rondas agotado, o el proveedor caído). No hay a quién derivar: se le dice a
// la persona que no se pudo y cuál es el camino alternativo.
export const MENSAJE_TURNO_SIN_RESPUESTA =
  "No pude resolver esto. Probá de nuevo o hacelo desde el panel.";

export const INSTRUCCION_INTERNA_BASE =
  "Estás hablando con una persona del equipo de esta organización, no con un cliente. Para consultar datos o hacer una acción usá las herramientas que tenés; si no tenés una herramienta para lo que te piden, decilo y sugerí hacerlo desde el panel. Nunca afirmes que hiciste algo que ninguna herramienta confirmó, ni inventes datos que ninguna herramienta te devolvió.";

// La referencia temporal, mismo motivo que lineaDeFechaActual (ítems 99 y
// 174): sin ella "mañana" o "el viernes" no se pueden convertir en la fecha
// ISO con offset que piden las tools, y el offset va ya calculado para que el
// modelo lo copie en vez de deducirlo. La zona es la de la ORGANIZACIÓN: este
// agente no tiene sucursal (las horas de cada turno las devuelve get_agenda en
// la zona de su sucursal).
export function lineaDeFechaActualInterna(ahora: Date, zona: string): string {
  const formato = new Intl.DateTimeFormat("es-AR", {
    timeZone: zona,
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const conOffset = isoEnZona(ahora, zona);
  const offset = conOffset.slice(-6);
  return `Referencia temporal: ahora es ${formato.format(ahora)} en la zona horaria de la organización (${zona}), offset ${offset} (ahora mismo en ISO 8601: ${conOffset}). Usala para interpretar "hoy", "mañana" o "el viernes", y mandá toda fecha a una herramienta en ISO 8601 con este offset exacto (${offset}), nunca en UTC ni terminada en "Z".`;
}

export function armarSystemPromptInterno(
  agente: { instructions: string },
  persona: { fullName: string },
  contextoTemporal: { ahora: Date; zona: string },
): string {
  return [
    agente.instructions.trim(),
    INSTRUCCION_INTERNA_BASE,
    `La persona que te escribe se llama ${persona.fullName}.`,
    lineaDeFechaActualInterna(contextoTemporal.ahora, contextoTemporal.zona),
  ].join("\n\n");
}

// El hilo persistido, en el formato del proveedor. Solo texto: las tool calls
// de turnos anteriores no se reinyectan (mismo criterio que aHistorial) — lo
// que el agente contestó con esos resultados ya está en su respuesta.
export function aHistorialInterno(
  mensajes: Pick<InternalAgentMessage, "senderType" | "content">[],
): LlmMessage[] {
  return mensajes
    .filter((m) => m.content.trim().length > 0)
    .map((m) =>
      m.senderType === "USER"
        ? { role: "user" as const, content: m.content }
        : { role: "assistant" as const, content: m.content },
    );
}

async function resolverToolCallInterna(
  llamada: LlmToolCall,
  toolsPorNombre: Map<string, ToolInterna>,
  contexto: ContextoDeEjecucionDeToolInterna,
): Promise<ToolCallDelTurno> {
  const base = { id: llamada.id, name: llamada.name, arguments: llamada.arguments };
  const tool = toolsPorNombre.get(llamada.name);
  // Sin puedeEjecutarTool: aquel chequeo existe por los guardrails de un
  // agente de cliente, que acá no hay. Lo único que decide es enabledTools.
  if (!tool) {
    return { ...base, allowed: false, reason: `La acción "${llamada.name}" no está habilitada` };
  }
  const result = await tool.ejecutar(llamada.arguments, contexto);
  return { ...base, allowed: true, result };
}

export interface TurnoInternoInput {
  organizationId: string;
  userId: string;
  role: RoleName;
  // El rubro y las sedes de quien escribe (R20): get_agenda le muestra a una
  // Recepción de clínica solo los turnos de sus sedes, como el panel.
  industry?: OrganizationIndustry;
  sedes?: readonly string[];
  userFullName: string;
  texto: string;
}

export interface DependenciasDelTurnoInterno {
  leerAgente: (organizationId: string) => Promise<InternalAgent | null>;
  guardarMensaje: (data: CreateInternalAgentMessageData) => Promise<InternalAgentMessage>;
  leerVentana: (
    organizationId: string,
    internalAgentId: string,
    userId: string,
    take: number,
  ) => Promise<InternalAgentMessage[]>;
  leerZona: (organizationId: string) => Promise<string>;
  tools: (enabledTools: string[]) => ToolInterna[];
  ahora: () => Date;
}

const dependenciasReales: DependenciasDelTurnoInterno = {
  leerAgente: (organizationId) => findInternalAgentByOrganization(organizationId),
  guardarMensaje: (data) => createInternalAgentMessage(data),
  leerVentana: (organizationId, internalAgentId, userId, take) =>
    findLastInternalAgentMessages(organizationId, internalAgentId, userId, take),
  leerZona: async (organizationId) =>
    (await findOrganizationById(organizationId))?.timezone ?? "UTC",
  tools: toolsHabilitadasInternas,
  ahora: () => new Date(),
};

export interface TurnoInternoOptions {
  llmProvider?: LlmProvider;
  deps?: DependenciasDelTurnoInterno;
}

export interface ResultadoDelTurnoInterno {
  mensaje: InternalAgentMessage;
  toolCalls: ToolCallDelTurno[];
}

export async function runInternalAgentTurn(
  input: TurnoInternoInput,
  options: TurnoInternoOptions = {},
): Promise<ResultadoDelTurnoInterno> {
  const { organizationId, userId, role } = input;
  const deps = options.deps ?? dependenciasReales;

  // 1. El agente de la organización.
  const agente = await deps.leerAgente(organizationId);
  if (!agente) {
    throw new AppError(MENSAJE_SIN_AGENTE_INTERNO, 404);
  }

  // Antes de guardar nada: si el proveedor no está configurado en el servidor
  // (getLlmProvider lanza), el mensaje de la persona no queda huérfano en el
  // hilo sin respuesta.
  const llm = options.llmProvider ?? getLlmProvider();

  // 2. El mensaje de la persona.
  await deps.guardarMensaje({
    organizationId,
    internalAgentId: agente.id,
    userId,
    senderType: "USER",
    content: input.texto,
  });

  // 3. La ventana del hilo, que ya incluye el mensaje recién guardado.
  const historial = aHistorialInterno(
    await deps.leerVentana(organizationId, agente.id, userId, VENTANA_DE_MENSAJES),
  );
  const systemPrompt = armarSystemPromptInterno(
    agente,
    { fullName: input.userFullName },
    { ahora: deps.ahora(), zona: await deps.leerZona(organizationId) },
  );
  const tools = deps.tools(agente.enabledTools);
  const toolsPorNombre = new Map(tools.map((t) => [t.definition.name, t]));
  const definiciones = tools.map((t) => t.definition);
  const existeLaTool = (nombre: string) => toolsPorNombre.has(nombre);
  const contextoDeTools: ContextoDeEjecucionDeToolInterna = {
    organizationId,
    userId,
    role,
    ...(input.industry ? { industry: input.industry } : {}),
    ...(input.sedes ? { sedes: input.sedes } : {}),
  };

  // 4. El loop de tool-calling, con el mismo tope que el de cliente: una tool
  // que falla siempre no se arregla insistiendo.
  const auditoria: ToolCallDelTurno[] = [];
  let respuestaFinal: string | null = null;

  for (let ronda = 0; ronda < MAX_TOOL_ROUNDS_PER_TURN; ronda++) {
    let resultado: LlmCompletionResult;
    try {
      resultado = await llm.complete({
        systemPrompt,
        messages: historial,
        tools: definiciones,
        model: agente.modelName,
      });
    } catch (err) {
      // Solo la falla del proveedor se cierra con el mensaje fijo (mismo
      // criterio que el ítem 120): un error de programación tiene que seguir
      // rompiendo fuerte.
      if (!(err instanceof LlmProviderError)) {
        throw err;
      }
      logger.error(
        { err, organizationId, internalAgentId: agente.id, ronda },
        "El proveedor del modelo falló en un turno del agente interno",
      );
      respuestaFinal = MENSAJE_TURNO_SIN_RESPUESTA;
      break;
    }

    if (resultado.toolCalls.length === 0) {
      // Sin texto tampoco = ronda perdida; decide el tope.
      if (resultado.text !== null) {
        respuestaFinal = resultado.text;
        break;
      }
      continue;
    }

    const llamadas = resultado.toolCalls.map((llamada) => ({
      ...llamada,
      name: canonizarNombreDeTool(llamada.name, existeLaTool),
    }));
    historial.push({ role: "assistant", content: resultado.text, toolCalls: llamadas });

    for (const llamada of llamadas) {
      const entrada = await resolverToolCallInterna(llamada, toolsPorNombre, contextoDeTools);
      auditoria.push(entrada);
      historial.push({
        role: "tool",
        toolCallId: llamada.id,
        content: JSON.stringify(
          entrada.result ?? { ok: false, error: entrada.reason ?? "Acción no disponible" },
        ),
      });
    }
    // Con tools siempre hay otra ronda (ítem 88): el texto que vino junto a
    // los pedidos se escribió antes de conocer los resultados.
  }

  // 5. Sin respuesta utilizable tras el tope: el mensaje fijo.
  if (respuestaFinal === null) {
    logger.warn(
      { organizationId, internalAgentId: agente.id, rondas: MAX_TOOL_ROUNDS_PER_TURN },
      "El agente interno agotó el tope de rondas de tool-calling sin respuesta final",
    );
    respuestaFinal = MENSAJE_TURNO_SIN_RESPUESTA;
  }

  // 6. La respuesta, con la auditoría de las tools si se usó alguna.
  const mensaje = await deps.guardarMensaje({
    organizationId,
    internalAgentId: agente.id,
    userId,
    senderType: "AGENT",
    content: respuestaFinal,
    ...(auditoria.length > 0 ? { toolCalls: auditoria as unknown as Prisma.InputJsonValue } : {}),
  });

  return { mensaje, toolCalls: auditoria };
}
