import { env } from "../config/env";
import { AppError } from "../utils/AppError";

// ---------------------------------------------------------------------------
// Proveedor de LLM del módulo de Agentes de IA (docs/ai-agent-architecture.md,
// paso 2a de §9). Dos cosas en un solo archivo, a propósito:
//
//   1. La interfaz `LlmProvider`, que es lo ÚNICO que el loop de orquestación
//      del paso 2b va a importar. §10 del documento: Rocco pidió que el sistema
//      pueda funcionar con cualquier proveedor de IA, y esta interfaz es la
//      pieza que lo garantiza — el loop nunca sabe si detrás hay OpenRouter,
//      Anthropic u OpenAI directo.
//   2. El primer adaptador concreto, OpenRouter. Un segundo adaptador es un
//      archivo nuevo que implementa la misma interfaz, y nada más.
//
// AISLADO A PROPÓSITO, misma regla que googleCalendar.service.ts: este archivo
// habla HTTP con el proveedor y NADA MÁS — no toca Postgres, no conoce Prisma,
// no sabe qué es un Agent ni una Conversation. Todo lo que necesita entra por
// parámetro. El motivo es que sea probable de verdad: llmProvider.service.test.ts
// corre como test UNITARIO, sin base y sin red, inyectando un fetch falso.
//
// Quien SÍ va a cruzar los dos mundos es el loop del paso 2b: lee el Agent, arma
// el system prompt y la ventana de mensajes, llama acá, y persiste el resultado.
// ---------------------------------------------------------------------------

// El subconjunto de `fetch` que usa este archivo. Tiparlo así —y no como
// `typeof fetch`— es lo que permite que el test inyecte una función de dos
// líneas en vez de tener que satisfacer la firma completa del fetch del runtime.
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

// ---------------------------------------------------------------------------
// El contrato — independiente de proveedor
// ---------------------------------------------------------------------------

// Un pedido de ejecución de tool hecho por el modelo. El `id` lo asigna el
// proveedor y es lo que permite asociar después el resultado de esa tool con
// el pedido exacto que la originó (LlmToolResultMessage.toolCallId): un turno
// puede pedir varias tools a la vez y sin el id no habría forma de saber cuál
// resultado corresponde a cuál pedido.
export interface LlmToolCall {
  id: string;
  name: string;
  // Ya parseados. El formato de OpenAI los transporta como STRING JSON y el
  // adaptador los decodifica acá para que el loop nunca tenga que saberlo.
  arguments: Record<string, unknown>;
}

// Definición de una tool tal como se le describe al modelo. `parameters` es un
// JSON Schema (el mismo formato que usan OpenAI, Anthropic y Google, así que
// no ata la interfaz a ningún proveedor).
export interface LlmToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface LlmUserMessage {
  role: "user";
  content: string;
}

export interface LlmAssistantMessage {
  role: "assistant";
  // null cuando el turno solo pidió tools (sin texto para el usuario).
  content: string | null;
  toolCalls?: LlmToolCall[];
}

// El resultado de ejecutar una tool, que vuelve al modelo para que arme la
// respuesta final (paso 6 de §4). `content` es texto: si el resultado es un
// objeto, quien llama lo serializa — la interfaz no decide el formato.
export interface LlmToolResultMessage {
  role: "tool";
  toolCallId: string;
  content: string;
}

// El historial que se le pasa al modelo. El system prompt NO va acá: entra por
// separado en LlmCompletionRequest, porque cada proveedor lo transporta
// distinto (OpenAI lo mete como primer mensaje; Anthropic lo manda como campo
// aparte) y esa diferencia es del adaptador, no del loop.
export type LlmMessage = LlmUserMessage | LlmAssistantMessage | LlmToolResultMessage;

export interface LlmCompletionRequest {
  systemPrompt: string;
  messages: LlmMessage[];
  // El catálogo YA FILTRADO por Agent.enabledTools (paso 2 de §4). Vacío es
  // válido: el modelo solo puede responder texto.
  tools: LlmToolDefinition[];
  // El modelo a usar (Agent.modelName). Si no viene, el adaptador usa su
  // default de configuración.
  model?: string;
}

export interface LlmCompletionResult {
  // null si el modelo solo pidió ejecutar tools y no dijo nada al usuario.
  text: string | null;
  // Vacía si el modelo respondió directo. Nunca undefined: el loop itera
  // sobre esto sin chequear.
  toolCalls: LlmToolCall[];
}

export interface LlmProvider {
  // Identificador estable del adaptador ("openrouter"). Es lo que
  // Agent.modelProvider guarda y lo que valida el CRUD de agentes.
  readonly name: string;
  complete(request: LlmCompletionRequest): Promise<LlmCompletionResult>;
}

// Los adaptadores que existen. Agent.modelProvider es VarChar libre en la base
// (el catálogo cambia más rápido de lo que conviene versionar en un enum de
// Postgres — comentario del schema), así que el borde HTTP valida contra esta
// lista: un agente con un proveedor que ningún adaptador implementa no puede
// ejecutarse jamás, y es mejor un 400 al crearlo que un 500 en su primera
// conversación.
export const OPENROUTER_PROVIDER_NAME = "openrouter";
export const LLM_PROVIDER_NAMES = [OPENROUTER_PROVIDER_NAME] as const;
export type LlmProviderName = (typeof LLM_PROVIDER_NAMES)[number];

export function isLlmProviderName(value: string): value is LlmProviderName {
  return (LLM_PROVIDER_NAMES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Errores del proveedor
//
// 502, mismo criterio que GoogleAuthError: el que falló es un servicio externo,
// no este servidor ni el cliente. El loop del 2b decide qué hacer con él
// (reintentar, derivar a humano, responder un mensaje genérico) — acá solo se
// describe lo que pasó, y nunca con el cuerpo crudo de la respuesta, que puede
// traer HTML de un balanceador cuando el que falla no es el proveedor sino
// algo en el medio.
// ---------------------------------------------------------------------------
export class LlmProviderError extends AppError {
  constructor(message: string) {
    super(message, 502);
    Object.setPrototypeOf(this, LlmProviderError.prototype);
  }
}

// ---------------------------------------------------------------------------
// Adaptador OpenRouter — API compatible con OpenAI (chat completions +
// tool-calling). Referencia: openrouter.ai/docs/api-reference/chat-completion
// y openrouter.ai/docs/features/tool-calling. El formato del cuerpo es el de
// OpenAI, así que un proxy compatible (o un mock local) sirve igual cambiando
// OPENROUTER_BASE_URL.
// ---------------------------------------------------------------------------

export interface ConfiguracionOpenRouter {
  apiKey: string;
  // El modelo cuando el request no trae uno (OPENROUTER_MODEL).
  defaultModel: string;
  // Raíz de la API, SIN barra final ("https://openrouter.ai/api/v1").
  baseUrl: string;
  fetch?: FetchLike;
}

// Tope por llamada. Un LLM tarda MUCHO más que Google Calendar —decenas de
// segundos en un modelo grande con contexto largo—, así que el tope es seis
// veces el de aquel archivo. Sigue existiendo por lo mismo: un request colgado
// no puede sostener indefinidamente el turno que lo espera.
const TIMEOUT_MS = 60_000;

// Formato de OpenAI para las tool calls de un mensaje del asistente.
interface ToolCallDeOpenAi {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface MensajeDeOpenAi {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCallDeOpenAi[];
  tool_call_id?: string;
}

// Traduce el historial neutral al formato de OpenAI. Es la mitad del adaptador
// que existe para que el loop no sepa nada de `tool_calls`/`tool_call_id`.
function aMensajesDeOpenAi(systemPrompt: string, messages: LlmMessage[]): MensajeDeOpenAi[] {
  const salida: MensajeDeOpenAi[] = [{ role: "system", content: systemPrompt }];

  for (const mensaje of messages) {
    switch (mensaje.role) {
      case "user":
        salida.push({ role: "user", content: mensaje.content });
        break;

      case "assistant": {
        const toolCalls = mensaje.toolCalls ?? [];
        salida.push({
          role: "assistant",
          content: mensaje.content,
          ...(toolCalls.length > 0
            ? {
                tool_calls: toolCalls.map((tc): ToolCallDeOpenAi => ({
                  id: tc.id,
                  type: "function",
                  // Vuelven al modelo como STRING JSON, que es como él los
                  // emitió — el formato de OpenAI no acepta el objeto.
                  function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
                })),
              }
            : {}),
        });
        break;
      }

      case "tool":
        salida.push({ role: "tool", tool_call_id: mensaje.toolCallId, content: mensaje.content });
        break;
    }
  }

  return salida;
}

// OpenRouter devuelve sus errores como { error: { message, code } } (forma de
// OpenAI). Se contempla eso y se cae a un texto genérico: nunca el cuerpo crudo.
async function describirFallo(res: Response): Promise<string> {
  let cuerpo: unknown;

  try {
    cuerpo = await res.json();
  } catch {
    return `OpenRouter respondió ${res.status} sin un cuerpo interpretable`;
  }

  if (cuerpo && typeof cuerpo === "object") {
    const error = (cuerpo as { error?: unknown }).error;
    if (error && typeof error === "object") {
      const mensaje = (error as { message?: unknown }).message;
      if (typeof mensaje === "string") {
        return `OpenRouter rechazó la solicitud (${res.status}): ${mensaje}`;
      }
    }
    if (typeof error === "string") {
      return `OpenRouter rechazó la solicitud (${res.status}): ${error}`;
    }
  }

  return `OpenRouter respondió ${res.status}`;
}

// Los argumentos de una tool call llegan como string JSON escrito por el
// modelo, y un modelo puede escribir JSON inválido. Se falla con el motivo y
// el nombre de la tool: el loop del 2b decide si eso es un reintento o un
// handoff, pero nunca debe llegarle un `arguments` a medias.
function parsearArgumentos(nombre: string, crudo: unknown): Record<string, unknown> {
  // Algunos modelos emiten "" cuando la tool no tiene parámetros.
  if (crudo === undefined || crudo === null || crudo === "") {
    return {};
  }

  if (typeof crudo !== "string") {
    // Ya es un objeto: hay proveedores compatibles que no lo serializan.
    if (crudo && typeof crudo === "object" && !Array.isArray(crudo)) {
      return crudo as Record<string, unknown>;
    }
    throw new LlmProviderError(
      `El modelo devolvió argumentos ininteligibles para la tool "${nombre}"`,
    );
  }

  let parseado: unknown;
  try {
    parseado = JSON.parse(crudo);
  } catch {
    throw new LlmProviderError(
      `El modelo devolvió argumentos que no son JSON válido para la tool "${nombre}"`,
    );
  }

  if (!parseado || typeof parseado !== "object" || Array.isArray(parseado)) {
    throw new LlmProviderError(
      `El modelo devolvió argumentos que no son un objeto para la tool "${nombre}"`,
    );
  }

  return parseado as Record<string, unknown>;
}

// FACTORY, mismo patrón que crearClienteGoogleCalendar(): recibe su
// configuración y su fetch en vez de leerlos de un singleton. Es lo que hace
// que el test unitario exista.
export function crearProveedorOpenRouter(config: ConfiguracionOpenRouter): LlmProvider {
  const hacerFetch = config.fetch ?? ((url, init) => fetch(url, init));
  const urlChatCompletions = `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`;

  return {
    name: OPENROUTER_PROVIDER_NAME,

    async complete({ systemPrompt, messages, tools, model }) {
      const cuerpo: Record<string, unknown> = {
        model: model ?? config.defaultModel,
        messages: aMensajesDeOpenAi(systemPrompt, messages),
      };

      // `tools` y `tool_choice` SOLO cuando hay tools. Un `tools: []` no es
      // neutro: varios modelos detrás de OpenRouter lo rechazan con 400, y
      // `tool_choice` sin tools es directamente inválido en el formato de
      // OpenAI. Sin tools, el modelo solo puede responder texto, que es
      // exactamente lo que se quiere.
      if (tools.length > 0) {
        cuerpo.tools = tools.map((tool) => ({
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          },
        }));
        // "auto": el modelo decide si responde texto o pide una tool. Forzar
        // una tool ("required") sería decisión del loop, no del adaptador.
        cuerpo.tool_choice = "auto";
      }

      let res: Response;
      try {
        res = await hacerFetch(urlChatCompletions, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(cuerpo),
          // AbortSignal.timeout: nativo desde Node 18, sin dependencia.
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (err) {
        // Falla de RED: no llegó respuesta.
        const detalle = err instanceof Error ? err.message : String(err);
        throw new LlmProviderError(`No se pudo contactar a OpenRouter: ${detalle}`);
      }

      if (!res.ok) {
        throw new LlmProviderError(await describirFallo(res));
      }

      let datos: {
        choices?: unknown;
        error?: unknown;
      };
      try {
        datos = (await res.json()) as typeof datos;
      } catch {
        throw new LlmProviderError("OpenRouter respondió 200 con un cuerpo que no es JSON");
      }

      // OpenRouter puede responder 200 con { error } cuando el fallo es del
      // proveedor de más abajo y no de su propio borde. Un 200 con error no
      // es un éxito.
      if (datos.error && typeof datos.error === "object") {
        const mensaje = (datos.error as { message?: unknown }).message;
        throw new LlmProviderError(
          `OpenRouter devolvió un error: ${typeof mensaje === "string" ? mensaje : "sin detalle"}`,
        );
      }

      // Un 200 sin choices no es un fallo del modelo: es el proveedor
      // devolviendo algo que no entendemos, o un intermediario respondiendo
      // por él.
      if (!Array.isArray(datos.choices) || datos.choices.length === 0) {
        throw new LlmProviderError("OpenRouter respondió sin choices");
      }

      const primera = datos.choices[0] as { message?: unknown };
      const mensaje = primera?.message;
      if (!mensaje || typeof mensaje !== "object") {
        throw new LlmProviderError("OpenRouter respondió sin message en el primer choice");
      }

      const { content, tool_calls: toolCallsCrudos } = mensaje as {
        content?: unknown;
        tool_calls?: unknown;
      };

      const toolCalls: LlmToolCall[] = [];
      if (Array.isArray(toolCallsCrudos)) {
        for (const crudo of toolCallsCrudos) {
          if (!crudo || typeof crudo !== "object") {
            continue;
          }
          const { id, function: fn } = crudo as { id?: unknown; function?: unknown };
          const nombre = fn && typeof fn === "object" ? (fn as { name?: unknown }).name : undefined;

          if (typeof id !== "string" || typeof nombre !== "string") {
            // Sin id no hay forma de devolverle el resultado al modelo; sin
            // nombre no hay qué ejecutar. Una tool call así no se puede
            // atender y tampoco se puede ignorar en silencio.
            throw new LlmProviderError("OpenRouter devolvió una tool call sin id o sin nombre");
          }

          toolCalls.push({
            id,
            name: nombre,
            arguments: parsearArgumentos(nombre, (fn as { arguments?: unknown }).arguments),
          });
        }
      }

      // `content` puede ser null (solo tools) o "" — se normaliza a null para
      // que el loop tenga UNA sola forma de "no dijo nada".
      const text = typeof content === "string" && content.length > 0 ? content : null;

      return { text, toolCalls };
    },
  };
}

// ---------------------------------------------------------------------------
// El proveedor que usa producción. PEREZOSO, mismo criterio que
// getClienteGoogleCalendar(): OPENROUTER_API_KEY es opcional en config/env.ts
// para que el servidor arranque sin ella, así que la validación de presencia
// tiene que ocurrir en el momento de uso y no al importar. Un CRM que no usa
// agentes de IA no tiene por qué configurar una clave de OpenRouter.
// ---------------------------------------------------------------------------
let proveedor: LlmProvider | undefined;

export function getLlmProvider(): LlmProvider {
  if (proveedor) {
    return proveedor;
  }

  if (!env.OPENROUTER_API_KEY) {
    // isOperational: false — nombra una variable de entorno; es para el log,
    // no para el cliente (M-11 b).
    throw new AppError(
      "El proveedor de LLM no está configurado en el servidor. Falta: OPENROUTER_API_KEY",
      500,
      false,
    );
  }

  proveedor = crearProveedorOpenRouter({
    apiKey: env.OPENROUTER_API_KEY,
    defaultModel: env.OPENROUTER_MODEL,
    baseUrl: env.OPENROUTER_BASE_URL,
  });

  return proveedor;
}

// Solo para tests, mismo motivo que resetClienteParaTests().
export function resetLlmProviderParaTests(): void {
  proveedor = undefined;
}
