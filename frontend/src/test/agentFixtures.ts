import type { EmbedToken } from "../features/agent/embedToken.types";
import type { Agent } from "../features/agent/types";

// Fixture compartida entre los tests de features/agent/ (listado y
// formulario). Los valores por defecto son los de un agente recién creado por
// la pantalla: un solo canal, una sola tool y guardrails vacíos.
export function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "ag1",
    organizationId: "org-1",
    branchId: "b1",
    name: "Asistente de ventas",
    goal: "Atender consultas de la web y calificar el lead",
    instructions: "Sos el asistente de una concesionaria. Contestá corto y ofrecé un turno.",
    tone: "cercano",
    modelProvider: "openrouter",
    modelName: "openai/gpt-4o-mini",
    enabledTools: ["create_lead"],
    channels: ["WEB"],
    guardrails: {},
    guardrailsText: "",
    allowedOrigins: [],
    whatsappPhoneNumberId: null,
    isActive: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

// Un token de embed tal como lo devuelve el LISTADO
// (EMBED_TOKEN_PUBLIC_SELECT del backend): con `tokenPrefix` y sin el token
// en claro, que no existe en este objeto ni puede existir. El del 201 de
// creación (CreatedEmbedToken) se arma en el test que lo necesita, que es
// donde el token en claro tiene sentido.
export function makeEmbedToken(overrides: Partial<EmbedToken> = {}): EmbedToken {
  return {
    id: "tok1",
    organizationId: "org-1",
    agentId: "ag1",
    tokenPrefix: "embed_abc123",
    lastUsedAt: null,
    revokedAt: null,
    createdAt: "2026-02-01T00:00:00.000Z",
    ...overrides,
  };
}
