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
  // El MISMO límite, en las palabras del ADMIN (ítem 56). Es lo que el
  // formulario muestra y vuelve a editar; el enforcement sigue siendo 100%
  // sobre `guardrails`. NOT NULL con default '' en la base, así que siempre
  // viene — "" es la contraparte exacta de `{}`.
  guardrailsText: string;
  // Orígenes habilitados para el widget embebible (§10). Viene en la
  // respuesta y lo EDITA AgentEmbedPage (ítem 63), no el formulario del
  // agente — ver el comentario de CreateAgentInput. Vacío = widget
  // deshabilitado (fail-closed), que es el default del backend.
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
// SIN allowedOrigins, y sigue siendo una decisión: es el campo que habilita el
// widget embebible del canal Web (docs/ai-agent-architecture.md §10) y se
// administra en la pantalla que lo acompaña —AgentEmbedPage, ítem 63, con los
// tokens de embed y el snippet al lado—, no al crear el agente. Un token de
// embed cuelga del id del agente, así que no puede existir antes de que el
// agente exista: dar de alta con dominios ya cargados habilitaría un widget
// que todavía no tiene con qué autenticarse. El backend lo default-ea a []
// (widget deshabilitado, fail-closed) cuando no se manda, así que omitirlo al
// crear es el estado correcto.
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
  // Requerido igual que `guardrails`, y el backend exige los dos (en el PATCH,
  // además, exige que vayan juntos): el texto que se muestra y el objeto que
  // rige no pueden quedar diciendo cosas distintas.
  guardrailsText: string;
  isActive?: boolean;
}

// updateAgentSchema: los mismos campos, parciales, al menos uno — SALVO
// branchId, que no existe en ese schema. Un agente NO cambia de sucursal (ver
// la nota de UpdateAgentInput en src/services/agent.service.ts): mover el
// agente dejaría sus conversaciones históricas, que llevan el branchId
// denormalizado, apuntando a una sucursal distinta de la que las atendió.
// Mandarlo sería un 400, así que el tipo no lo deja ni intentarlo.
export type UpdateAgentInput = Partial<Omit<CreateAgentInput, "branchId">> & {
  // SÍ está en el PATCH aunque no esté en el POST: updateAgentSchema es el
  // schema completo .partial(), y allowedOrigins es uno de sus campos.
  // AgentEmbedPage manda un PATCH con SOLO este campo (ítem 63), que es lo
  // que hace que esa pantalla no pueda pisar nada de lo que configura
  // AgentFormPage.
  allowedOrigins?: string[];
};

// La respuesta de POST /api/agents/guardrails/translate (ítem 56). NO guarda
// nada: es lo que el formulario muestra en el panel de confirmación antes de
// crear o editar el agente.
//
// `guardrails` tiene la misma forma que el del Agent —Record y no una interfaz
// con las seis claves de §6, por el mismo motivo— y es EXACTAMENTE el objeto
// que después viaja en el POST/PATCH: el backend no vuelve a traducir, así que
// lo que se guarda es lo que el ADMIN confirmó.
//
// `descartado` es lo que el sistema entendió pero NO puede hacer cumplir (una
// acción que no existe, un campo que ninguna acción toca, una frase demasiado
// larga). Se muestra como advertencia: nada se descarta en silencio.
export interface GuardrailsDiscard {
  clave: string;
  valor: string;
  motivo: string;
}

export interface GuardrailsTranslation {
  guardrails: Record<string, unknown>;
  descartado: GuardrailsDiscard[];
}
