// Reconstruido desde el contrato real del backend (src/controllers/agent.controller.ts,
// src/services/agent.service.ts, prisma/schema.prisma modelo Agent). Diseño
// completo del módulo en docs/ai-agent-architecture.md; esta es la primera
// pantalla del panel de administración de agentes (ítem 55 de
// docs/frontend-cambios-pendientes.md).
//
// No se declara ningún campo que el backend no devuelva o no acepte: cada uno
// de los de abajo está verificado contra el modelo `Agent` del schema y contra
// createAgentSchema/updateAgentSchema del controller.

// Espejo del enum ConversationChannel de Prisma. Dos valores y nada más.
export type ConversationChannel = "WHATSAPP" | "WEB";

export interface Agent {
  id: string;
  organizationId: string;
  branchId: string;
  name: string;
  goal: string | null;
  instructions: string;
  tone: string | null;
  modelProvider: string;
  modelName: string;
  // snake_case, subconjunto del catálogo real de tools. El backend valida la
  // FORMA del nombre, no su pertenencia al catálogo (ver el comentario de
  // toolNameSchema en agent.controller.ts), así que un agente puede traer un
  // nombre que no esté en tools.ts — ver ahí cómo se muestra.
  enabledTools: string[];
  channels: ConversationChannel[];
  // Objeto JSON plano (z.record en el backend). La FORMA de adentro está
  // documentada en docs/ai-agent-architecture.md §6 pero no impuesta por
  // Postgres ni por Zod — mismo criterio que Contact.customFields. Por eso acá
  // es Record<string, unknown> y no una interfaz con las seis claves de §6:
  // tipar una forma que nadie valida sería prometer algo que no es cierto.
  guardrails: Record<string, unknown>;
  // Orígenes habilitados para el widget embebible (§10). Viene en la
  // respuesta, pero NINGUNA pantalla lo edita todavía — ver el comentario de
  // CreateAgentInput.
  allowedOrigins: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface AgentListPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface AgentListResponse {
  data: Agent[];
  pagination: AgentListPagination;
}

export type AgentSortBy = "name" | "createdAt";
export type SortOrder = "asc" | "desc";

// listQuerySchema de agent.controller.ts.
export interface AgentListQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  branchId?: string;
  isActive?: boolean;
  sortBy?: AgentSortBy;
  sortOrder?: SortOrder;
}

// createAgentSchema de agent.controller.ts. Requeridos de verdad: branchId,
// name, instructions y guardrails; el resto tiene default en el schema.
//
// SIN allowedOrigins, y es una decisión, no un olvido: es el campo que
// habilita el widget embebible del canal Web (docs/ai-agent-architecture.md
// §10) y la pantalla que lo acompaña —tokens de embed y snippet para copiar—
// no existe todavía. Un campo de orígenes permitidos sin esa pantalla al lado
// sería una configuración huérfana: se puede llenar, no sirve para nada hasta
// que haya un token. El backend lo default-ea a [] (widget deshabilitado,
// fail-closed) cuando no se manda, así que omitirlo es el estado correcto.
export interface CreateAgentInput {
  branchId: string;
  name: string;
  goal?: string | null;
  instructions: string;
  tone?: string | null;
  modelProvider: string;
  // Opcional: omitirlo hace que el backend use el default de OPENROUTER_MODEL.
  modelName?: string;
  enabledTools: string[];
  channels: ConversationChannel[];
  guardrails: Record<string, unknown>;
  isActive?: boolean;
}

// updateAgentSchema: los mismos campos, parciales, al menos uno — SALVO
// branchId, que no existe en ese schema. Un agente NO cambia de sucursal (ver
// la nota de UpdateAgentInput en src/services/agent.service.ts): mover el
// agente dejaría sus conversaciones históricas, que llevan el branchId
// denormalizado, apuntando a una sucursal distinta de la que las atendió.
// Mandarlo sería un 400, así que el tipo no lo deja ni intentarlo.
export type UpdateAgentInput = Partial<Omit<CreateAgentInput, "branchId">>;
