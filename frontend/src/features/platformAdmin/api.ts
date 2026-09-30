import { request } from "../../lib/api";
import { getAccessToken } from "../../auth/getAccessToken";
import type { Agent } from "../agent/types";
import type { InternalAgent } from "../internalAgent/types";
import type {
  AssignAgentModelInput,
  AssignFacebookPageInput,
  AssignInternalAgentModelInput,
  AssignWhatsappNumberInput,
  CreateOrganizationInput,
  CreateOrganizationResponse,
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
