import { ApiError, request } from "../../lib/api";
import { getAccessToken } from "../../auth/getAccessToken";
import type { Agent } from "../agent/types";
import type { InternalAgent } from "../internalAgent/types";
import type { MetaPageConnection } from "../organization/types";
import type {
  AssignAgentModelInput,
  AssignFacebookPageInput,
  AssignInternalAgentModelInput,
  AssignWhatsappNumberInput,
  CreateOrganizationInput,
  CreateOrganizationResponse,
  EdicionesDisponibles,
  RubrosDisponibles,
  LlmUsageSummary,
  MetaAuthorization,
  MetaConnectionPendiente,
  PlatformOrganization,
} from "./types";

// Reutiliza request()/getAccessToken tal cual, como el resto de los módulos.
// La gate (platform admin) la decide el backend por el JWT; acá no viaja
// ningún dato de identidad.
export function createOrganization(
  input: CreateOrganizationInput,
): Promise<CreateOrganizationResponse> {
  return request<CreateOrganizationResponse>("/admin/organizations", {
    method: "POST",
    body: input,
    getAccessToken,
  });
}

// Las ediciones que se pueden elegir hoy en el alta (docs/ediciones.md §10,
// PR 4). Con una sola, la pantalla no muestra el selector.
export function listEditions(signal?: AbortSignal): Promise<EdicionesDisponibles> {
  return request<EdicionesDisponibles>("/admin/organizations/editions", { getAccessToken, signal });
}

// Los rubros que se pueden elegir hoy en el alta (docs/rubros.md §15, R3).
// Con uno solo, la pantalla no muestra el selector.
export function listIndustries(signal?: AbortSignal): Promise<RubrosDisponibles> {
  return request<RubrosDisponibles>("/admin/organizations/industries", { getAccessToken, signal });
}

// Devuelve el agente actualizado, con la misma forma que GET /api/agents/:id.
export function assignWhatsappNumber({
  agentId,
  whatsappPhoneNumberId,
}: AssignWhatsappNumberInput): Promise<Agent> {
  return request<Agent>(`/admin/agents/${encodeURIComponent(agentId)}/whatsapp-phone-number`, {
    method: "PUT",
    body: { whatsappPhoneNumberId },
    getAccessToken,
  });
}

// Mismo contrato que el número de WhatsApp: devuelve el agente actualizado.
export function assignFacebookPage({
  agentId,
  facebookPageId,
}: AssignFacebookPageInput): Promise<Agent> {
  return request<Agent>(`/admin/agents/${encodeURIComponent(agentId)}/facebook-page`, {
    method: "PUT",
    body: { facebookPageId },
    getAccessToken,
  });
}

// B-05: el modelo de un agente y el del agente interno de una organización.
// Devuelven el agente actualizado, igual que los de arriba.
export function assignAgentModel({ agentId, ...body }: AssignAgentModelInput): Promise<Agent> {
  return request<Agent>(`/admin/agents/${encodeURIComponent(agentId)}/model`, {
    method: "PUT",
    body,
    getAccessToken,
  });
}

export function assignInternalAgentModel({
  organizationId,
  ...body
}: AssignInternalAgentModelInput): Promise<InternalAgent> {
  return request<InternalAgent>(
    `/admin/organizations/${encodeURIComponent(organizationId)}/internal-agent/model`,
    { method: "PUT", body, getAccessToken },
  );
}

// Las organizaciones vigentes, para el selector de las pantallas de plataforma.
export function listOrganizations(signal?: AbortSignal): Promise<PlatformOrganization[]> {
  return request<PlatformOrganization[]>("/admin/organizations", { getAccessToken, signal });
}

// B4: el gasto en el modelo por organización de los últimos 30 días.
export function getLlmUsage(signal?: AbortSignal): Promise<LlmUsageSummary> {
  return request<LlmUsageSummary>("/admin/llm-usage", { getAccessToken, signal });
}

// ---------------------------------------------------------------------------
// La página de Facebook de una organización elegida (02/10/2026: la conecta y
// la desconecta el platform admin, no el ADMIN del negocio). Mismo contrato
// que tenía organization/api.ts, con la organización en el path.
// ---------------------------------------------------------------------------
function rutaMeta(organizationId: string): string {
  return `/admin/organizations/${encodeURIComponent(organizationId)}/integrations/meta`;
}

// null = la organización nunca se conectó (el backend responde 404).
export async function getOrganizationMetaConnection(
  organizationId: string,
  signal?: AbortSignal,
): Promise<MetaPageConnection | null> {
  try {
    return await request<MetaPageConnection>(rutaMeta(organizationId), { getAccessToken, signal });
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

// Firma el state (para esta organización y este usuario) y devuelve la URL de
// autorización de Meta. POST: el state firmado habilita a escribir.
export function startOrganizationMetaConnection(
  organizationId: string,
): Promise<MetaAuthorization> {
  return request<MetaAuthorization>(`${rutaMeta(organizationId)}/connect`, {
    method: "POST",
    getAccessToken,
  });
}

// El segundo tramo: manda el code y el state que el callback le rebotó a la
// pantalla. El backend exige el mismo usuario y la misma organización que
// firmó el state; si no, o si el code venció, responde el mensaje a mostrar.
export function completeOrganizationMetaConnection(
  organizationId: string,
  pendiente: MetaConnectionPendiente,
): Promise<MetaPageConnection> {
  return request<MetaPageConnection>(`${rutaMeta(organizationId)}/complete`, {
    method: "POST",
    body: pendiente,
    getAccessToken,
  });
}

// 204 sin body. Deja la fila en REVOKED, sin token.
export function disconnectOrganizationMetaConnection(organizationId: string): Promise<void> {
  return request<void>(rutaMeta(organizationId), { method: "DELETE", getAccessToken });
}
