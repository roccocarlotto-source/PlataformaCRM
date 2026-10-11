import type { WidgetConfig } from "./config";

// ---------------------------------------------------------------------------
// Cliente de los endpoints públicos del canal Web (paso 5b):
//
//   POST {apiUrl}/api/public/agents/{agentId}/web/messages
//   x-embed-token: {embedToken}
//   { sessionId, message }  →  { conversationId, respuesta: string | null }
//
//   POST {apiUrl}/api/public/agents/{agentId}/web/thread
//   x-embed-token: {embedToken}
//   { sessionId, since? }  →  { messages: [{ id, role, text, createdAt }], cursor }
//
// El segundo trae lo que el negocio escribió fuera de la respuesta al
// visitante (una persona del equipo desde el CRM, el aviso de "nadie
// disponible"): sin `since`, el historial de la sesión; con `since`, solo lo
// nuevo de eso. Ver publicWidgetThread.service.ts del backend.
//
// A PROPÓSITO NO REUSA src/lib/api.ts: ese wrapper asume sesión de usuario
// (Bearer JWT y un unauthorizedHandler que cierra sesión ante un 401). Acá
// no hay usuario, y un 401 significa "token de embed inválido o dominio no
// autorizado", no "tu sesión venció".
//
// Sin `credentials: "include"`: el endpoint no usa cookies (su CORS responde
// sin Access-Control-Allow-Credentials, ver middlewares/widgetCors.ts del
// backend) — mandar credenciales de más solo generaría fricción de CORS.
// ---------------------------------------------------------------------------

export interface SendMessageResult {
  conversationId: string;
  /** null cuando una persona de la organización ya escribió en el hilo y el agente se calla (ítem 83). */
  respuesta: string | null;
  /** R16: el aviso de privacidad de una clínica, la primera vez. Va antes de la respuesta. */
  avisoDePrivacidad?: string;
}

export type WidgetApiErrorCategory =
  | "validation" // 400: el backend rechazó el cuerpo (vacío, demasiado largo, agentId mal formado)
  | "unauthorized" // 401: token inválido/revocado, agente inactivo u Origin no autorizado (el backend no distingue)
  | "rate_limited" // 429: tope de mensajes por token en la ventana
  | "network" // fetch rechazó: sin conexión, DNS, CORS bloqueado
  | "unknown"; // cualquier otro no-ok (5xx, 413, 415...) o respuesta 2xx con un cuerpo que no es el esperado

// La UI decide el texto amigable SOLO a partir de `category` y nunca muestra
// `message`: un visitante anónimo no tiene por qué ver detalle interno
// (consistente con que el backend ya colapsa sus rechazos a mensajes
// genéricos). `message` y `status` existen para console.error y tests.
export class WidgetApiError extends Error {
  readonly category: WidgetApiErrorCategory;
  readonly status?: number;

  constructor(category: WidgetApiErrorCategory, message: string, status?: number) {
    super(message);
    this.name = "WidgetApiError";
    this.category = category;
    this.status = status;
  }
}

function categoryFromStatus(status: number): WidgetApiErrorCategory {
  switch (status) {
    case 400:
      return "validation";
    case 401:
      return "unauthorized";
    case 429:
      return "rate_limited";
    default:
      return "unknown";
  }
}

// Extrae el mensaje del backend ({ error: { message } }) solo para el
// diagnóstico en consola; si el cuerpo no tiene esa forma, cae al status.
async function readErrorMessage(res: Response): Promise<string> {
  const fallback = `HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ""}`;
  try {
    const payload: unknown = await res.json();
    const message = (payload as { error?: { message?: unknown } } | null)?.error?.message;
    return typeof message === "string" && message ? message : fallback;
  } catch {
    return fallback;
  }
}

export interface WidgetThreadMessage {
  id: string;
  role: "visitor" | "agent";
  /** De los mensajes del negocio: "person" si lo escribió alguien del equipo. */
  author?: "agent" | "person";
  text: string;
  createdAt: string;
}

export interface WidgetThread {
  messages: WidgetThreadMessage[];
  /** Lo que se manda como `since` en la próxima consulta. */
  cursor: string;
}

function isWidgetThreadMessage(value: unknown): value is WidgetThreadMessage {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    (v.role === "visitor" || v.role === "agent") &&
    typeof v.text === "string" &&
    typeof v.createdAt === "string"
  );
}

function isWidgetThread(value: unknown): value is WidgetThread {
  if (typeof value !== "object" || value === null) return false;
  const v = value as { messages?: unknown; cursor?: unknown };
  return (
    Array.isArray(v.messages) &&
    v.messages.every(isWidgetThreadMessage) &&
    typeof v.cursor === "string"
  );
}

function isSendMessageResult(value: unknown): value is SendMessageResult {
  if (typeof value !== "object" || value === null) return false;
  const v = value as { conversationId?: unknown; respuesta?: unknown; avisoDePrivacidad?: unknown };
  return (
    typeof v.conversationId === "string" &&
    (typeof v.respuesta === "string" || v.respuesta === null) &&
    (v.avisoDePrivacidad === undefined || typeof v.avisoDePrivacidad === "string")
  );
}

export function buildWidgetMessagesUrl(config: WidgetConfig): string {
  return `${config.apiUrl}/api/public/agents/${encodeURIComponent(config.agentId)}/web/messages`;
}

export function buildWidgetThreadUrl(config: WidgetConfig): string {
  return `${config.apiUrl}/api/public/agents/${encodeURIComponent(config.agentId)}/web/thread`;
}

export function sendWidgetMessage(
  config: WidgetConfig,
  sessionId: string,
  message: string,
): Promise<SendMessageResult> {
  return postWidget(
    buildWidgetMessagesUrl(config),
    config,
    { sessionId, message },
    isSendMessageResult,
    "{ conversationId, respuesta }",
  );
}

export function fetchWidgetThread(
  config: WidgetConfig,
  sessionId: string,
  since?: string,
): Promise<WidgetThread> {
  return postWidget(
    buildWidgetThreadUrl(config),
    config,
    since === undefined ? { sessionId } : { sessionId, since },
    isWidgetThread,
    "{ messages, cursor }",
  );
}

// Lo común a los dos endpoints: el POST con el token, y la traducción de cada
// fallo a una categoría.
async function postWidget<T>(
  url: string,
  config: WidgetConfig,
  body: unknown,
  isExpected: (value: unknown) => value is T,
  expectedShape: string,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-embed-token": config.embedToken,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new WidgetApiError(
      "network",
      err instanceof Error ? err.message : "fetch rechazado sin detalle",
    );
  }

  if (!res.ok) {
    throw new WidgetApiError(
      categoryFromStatus(res.status),
      await readErrorMessage(res),
      res.status,
    );
  }

  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    throw new WidgetApiError("unknown", "la respuesta 2xx no es JSON válido", res.status);
  }
  if (!isExpected(payload)) {
    throw new WidgetApiError(
      "unknown",
      `la respuesta 2xx no tiene la forma ${expectedShape}`,
      res.status,
    );
  }
  return payload;
}
