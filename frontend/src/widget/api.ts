import type { WidgetConfig } from "./config";

// ---------------------------------------------------------------------------
// Cliente del endpoint público del canal Web (paso 5b):
//
//   POST {apiUrl}/api/public/agents/{agentId}/web/messages
//   x-embed-token: {embedToken}
//   { sessionId, message }  →  { conversationId, respuesta: string | null }
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

function isSendMessageResult(value: unknown): value is SendMessageResult {
  if (typeof value !== "object" || value === null) return false;
  const v = value as { conversationId?: unknown; respuesta?: unknown };
  return (
    typeof v.conversationId === "string" &&
    (typeof v.respuesta === "string" || v.respuesta === null)
  );
}

export function buildWidgetMessagesUrl(config: WidgetConfig): string {
  return `${config.apiUrl}/api/public/agents/${encodeURIComponent(config.agentId)}/web/messages`;
}

export async function sendWidgetMessage(
  config: WidgetConfig,
  sessionId: string,
  message: string,
): Promise<SendMessageResult> {
  let res: Response;
  try {
    res = await fetch(buildWidgetMessagesUrl(config), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-embed-token": config.embedToken,
      },
      body: JSON.stringify({ sessionId, message }),
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
  if (!isSendMessageResult(payload)) {
    throw new WidgetApiError(
      "unknown",
      "la respuesta 2xx no tiene la forma { conversationId, respuesta }",
      res.status,
    );
  }
  return payload;
}
