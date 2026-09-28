import { ApiError, request } from "../../lib/api";
import { getAccessToken } from "../../auth/getAccessToken";
import type {
  InternalAgent,
  InternalAgentMessage,
  InternalAgentMessageListResponse,
  PutInternalAgentInput,
} from "./types";

// Reutiliza request()/getAccessToken tal cual, como el resto de los features.
// Sin organizationId ni userId en ninguna: los dos se resuelven server-side
// desde el JWT (internalAgent.routes.ts).

// La configuración de la organización, o null si todavía no hay. El backend
// responde 404, pero para la pantalla de configuración "no hay" es un estado
// normal —el primer PUT la crea—, no un error. Cualquier otro error sube.
export async function getInternalAgent(signal?: AbortSignal): Promise<InternalAgent | null> {
  try {
    return await request<InternalAgent>("/internal-agent", { getAccessToken, signal });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

// Upsert: crea la primera vez, reemplaza después.
export function putInternalAgent(input: PutInternalAgentInput): Promise<InternalAgent> {
  return request<InternalAgent>("/internal-agent", { method: "PUT", body: input, getAccessToken });
}

// Acá el 404 SÍ sube como error: el chat lo distingue (ApiError.status) para
// mostrar el estado "no configurado", igual que el 403 de sin acceso.
export function listInternalAgentMessages(
  query: { page: number; pageSize: number },
  signal?: AbortSignal,
): Promise<InternalAgentMessageListResponse> {
  const params = new URLSearchParams({
    page: String(query.page),
    pageSize: String(query.pageSize),
  });
  return request<InternalAgentMessageListResponse>(`/internal-agent/messages?${params}`, {
    getAccessToken,
    signal,
  });
}

// Un turno del agente: devuelve el mensaje del AGENTE ya persistido. Sin
// `signal`, mismo criterio que sendTestMessage: abortar el fetch no cancela lo
// que ya pasó del otro lado (el mensaje guardado, una tarea creada).
export function sendInternalAgentMessage(content: string): Promise<InternalAgentMessage> {
  return request<InternalAgentMessage>("/internal-agent/messages", {
    method: "POST",
    body: { content },
    getAccessToken,
  });
}
