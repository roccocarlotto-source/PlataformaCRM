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
    isActive: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}
