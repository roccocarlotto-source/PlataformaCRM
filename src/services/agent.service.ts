import type { ConversationChannel, Prisma } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";
import {
  countAgents,
  createAgent as createAgentRepo,
  findAgentById,
  findManyAgents,
  softDeleteAgent,
  updateAgent as updateAgentRepo,
  type AgentFilters,
  type AgentSortBy,
  type SortOrder,
} from "../repositories/agent.repository";
import { revokeEmbedTokensByAgent } from "../repositories/agentEmbedToken.repository";
import { findBranchById, lockBranchForUpdate } from "../repositories/branch.repository";
import { AppError } from "../utils/AppError";

// ---------------------------------------------------------------------------
// CRUD administrativo del Agent (docs/ai-agent-architecture.md §5, paso 2a de
// §9). Mismo patrón exacto que resource.service.ts: scopeado por
// organizationId en cada operación, branchId validado contra la organización,
// soft delete vía deletedAt.
//
// LO QUE NO HAY ACÁ, A PROPÓSITO: ninguna llamada al proveedor de LLM. Este
// service configura agentes; ejecutarlos es el loop del paso 2b, que consume
// esta configuración pero vive en otro archivo.
// ---------------------------------------------------------------------------

export interface ListAgentsParams {
  page: number;
  pageSize: number;
  search?: string;
  branchId?: string;
  isActive?: boolean;
  sortBy: AgentSortBy;
  sortOrder: SortOrder;
}

export async function listAgents(organizationId: string, params: ListAgentsParams) {
  const { page, pageSize, sortBy, sortOrder, ...filters } = params;
  const skip = (page - 1) * pageSize;

  const [data, total] = await Promise.all([
    findManyAgents(
      organizationId,
      filters as AgentFilters,
      { skip, take: pageSize },
      { sortBy, sortOrder },
    ),
    countAgents(organizationId, filters as AgentFilters),
  ]);

  return {
    data,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
    },
  };
}

export async function getAgentById(organizationId: string, id: string) {
  const agent = await findAgentById(id, organizationId);
  if (!agent) {
    throw new AppError("Agente no encontrado", 404);
  }
  return agent;
}

// `db` explícito para poder revalidar DENTRO de la transacción de createAgent
// con el lock de la sucursal ya sostenido; el default es el pre-check rápido de
// afuera, que es UX y no la defensa. Mismo patrón que validateBranchId en
// resource.service.ts.
async function validateBranchId(organizationId: string, branchId: string, db: Db = prisma) {
  const branch = await findBranchById(branchId, organizationId, db);
  if (!branch) {
    throw new AppError("La sucursal indicada no existe o no pertenece a tu organización", 400);
  }
  return branch;
}

export interface CreateAgentInput {
  branchId: string;
  name: string;
  goal?: string | null;
  instructions: string;
  tone?: string | null;
  modelProvider: string;
  modelName: string;
  enabledTools: string[];
  channels: ConversationChannel[];
  guardrails: Record<string, unknown>;
  allowedOrigins: string[];
  isActive?: boolean;
}

export async function createAgent(organizationId: string, input: CreateAgentInput) {
  // 400 rápido en el caso común, sin abrir transacción.
  await validateBranchId(organizationId, input.branchId);

  return prisma.$transaction(async (tx) => {
    // Mismo lock que createResource: serializa contra deleteBranch para que
    // el agente no quede colgando de una sucursal borrada entre el pre-check y
    // el INSERT. La OTRA mitad —que deleteBranch cuente agentes activos y
    // rechace, como hace con los recursos— NO está en este PR: hoy deleteBranch
    // no sabe que los agentes existen. Es una decisión pendiente anotada en el
    // PR de 2a, no un olvido; el lock queda puesto para que el día que se
    // agregue el RESTRICT el lado create ya esté correcto.
    await lockBranchForUpdate(input.branchId, organizationId, tx);

    // Revalida con el lock sostenido: entre el pre-check y este punto,
    // deleteBranch pudo haber borrado la sucursal.
    await validateBranchId(organizationId, input.branchId, tx);

    return createAgentRepo(
      {
        organizationId,
        branchId: input.branchId,
        name: input.name,
        goal: input.goal ?? null,
        instructions: input.instructions,
        tone: input.tone ?? null,
        modelProvider: input.modelProvider,
        modelName: input.modelName,
        enabledTools: input.enabledTools,
        channels: input.channels,
        allowedOrigins: input.allowedOrigins,
        // El cast es el mismo precio que paga source.service.ts con
        // fieldMapping: InputJsonValue exige una firma de índice que
        // Record<string, unknown> no declara, aunque cualquier objeto JSON la
        // cumple. Zod ya garantizó que es un objeto plano.
        guardrails: input.guardrails as Prisma.InputJsonValue,
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
      tx,
    );
  });
}

// SIN branchId: un Agent NO cambia de sucursal, y es una decisión, no un
// olvido — misma regla que Resource.
//
// Cada Conversation lleva su propio branchId denormalizado desde el agente
// (comentario del schema). Mover el agente dejaría a todas sus conversaciones
// históricas apuntando a una sucursal distinta de la del agente que las
// atendió, y la bandeja por sucursal de §5 las mostraría en el lugar
// equivocado. El camino honesto es crear el agente en la sucursal nueva y
// desactivar o borrar el viejo.
export interface UpdateAgentInput {
  name?: string;
  goal?: string | null;
  instructions?: string;
  tone?: string | null;
  modelProvider?: string;
  modelName?: string;
  enabledTools?: string[];
  channels?: ConversationChannel[];
  guardrails?: Record<string, unknown>;
  allowedOrigins?: string[];
  isActive?: boolean;
}

export async function updateAgent(organizationId: string, id: string, input: UpdateAgentInput) {
  await getAgentById(organizationId, id);

  const { guardrails, ...resto } = input;
  const result = await updateAgentRepo(id, organizationId, {
    ...resto,
    ...(guardrails !== undefined ? { guardrails: guardrails as Prisma.InputJsonValue } : {}),
  });
  if (result.count === 0) {
    throw new AppError("Agente no encontrado", 404);
  }

  return getAgentById(organizationId, id);
}

// Soft delete a secas: sin RESTRICT por conversaciones, y es una decisión.
// Conversation no tiene deletedAt (es historial, no configuración) y en 2a
// todavía no existe ningún camino que cree conversaciones. Cuando el loop de
// 2b las cree, la pregunta de qué pasa con las ACTIVAS de un agente borrado
// (cerrarlas, derivarlas a humano, bloquear el borrado) se decide ahí, con
// conversaciones reales enfrente — no acá, sobre hipótesis.
export async function deleteAgent(organizationId: string, id: string) {
  await getAgentById(organizationId, id);

  // En transacción con la revocación de sus tokens de embed (paso 5a), mismo
  // criterio que deleteSource con sus api_keys: dar de baja un agente tiene
  // que matar sus credenciales, no dejarlas vivas esperando a que el endpoint
  // público se acuerde de chequear deletedAt. La invariante vive en los datos.
  await prisma.$transaction(async (tx) => {
    const result = await softDeleteAgent(id, organizationId, tx);
    if (result.count === 0) {
      throw new AppError("Agente no encontrado", 404);
    }
    await revokeEmbedTokensByAgent(id, organizationId, tx);
  });
}
