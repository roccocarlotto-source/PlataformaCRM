import { prisma, type Db } from "../lib/prisma";
import { findBranchById, lockBranchForUpdate } from "../repositories/branch.repository";
import {
  countKnowledgeBaseEntries,
  createKnowledgeBaseEntry as createKnowledgeBaseEntryRepo,
  findKnowledgeBaseEntryById,
  findManyKnowledgeBaseEntries,
  softDeleteKnowledgeBaseEntry,
  updateKnowledgeBaseEntry as updateKnowledgeBaseEntryRepo,
  type KnowledgeBaseEntryFilters,
  type KnowledgeBaseEntrySortBy,
  type SortOrder,
} from "../repositories/knowledgeBaseEntry.repository";
import { AppError } from "../utils/AppError";

// ---------------------------------------------------------------------------
// CRUD de la base de conocimiento por sucursal (ítem 59 de
// docs/frontend-cambios-pendientes.md; cierra el pendiente "Contexto de
// negocio por cliente" de docs/ai-agent-architecture.md §10). Mismo patrón
// exacto que agent.service.ts: scopeado por organizationId en cada operación,
// branchId validado contra la organización, soft delete vía deletedAt.
//
// LO QUE NO HAY ACÁ, A PROPÓSITO: ninguna noción de agente ni de prompt. Este
// service administra texto; quién lo lee y cómo se compone en el system prompt
// vive en agentOrchestration.service.ts, que consume la lectura dedicada del
// repositorio (findActiveKnowledgeBaseEntriesByBranch) y nada de este archivo.
// ---------------------------------------------------------------------------

export interface ListKnowledgeBaseEntriesParams {
  page: number;
  pageSize: number;
  search?: string;
  branchId?: string;
  isActive?: boolean;
  sortBy: KnowledgeBaseEntrySortBy;
  sortOrder: SortOrder;
}

export async function listKnowledgeBaseEntries(
  organizationId: string,
  params: ListKnowledgeBaseEntriesParams,
) {
  const { page, pageSize, sortBy, sortOrder, ...filters } = params;
  const skip = (page - 1) * pageSize;

  const [data, total] = await Promise.all([
    findManyKnowledgeBaseEntries(
      organizationId,
      filters as KnowledgeBaseEntryFilters,
      { skip, take: pageSize },
      { sortBy, sortOrder },
    ),
    countKnowledgeBaseEntries(organizationId, filters as KnowledgeBaseEntryFilters),
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

export async function getKnowledgeBaseEntryById(organizationId: string, id: string) {
  const entry = await findKnowledgeBaseEntryById(id, organizationId);
  if (!entry) {
    throw new AppError("Entrada de la base de conocimiento no encontrada", 404);
  }
  return entry;
}

// `db` explícito para poder revalidar DENTRO de la transacción con el lock de
// la sucursal ya sostenido; el default es el pre-check rápido de afuera, que es
// UX y no la defensa. Mismo patrón que validateBranchId en agent.service.ts.
//
// EXPORTADA desde §70: la sincronización de stock
// (vehicleKnowledgeBaseSync.service.ts) valida la sucursal UNA vez al empezar,
// y tiene que hacerlo con este mismo criterio y este mismo mensaje — un
// branchId de otra organización devuelve el mismo 400 que en el POST de una
// entrada, sin confirmar que esa sucursal exista en algún lado.
export async function validateBranchId(organizationId: string, branchId: string, db: Db = prisma) {
  const branch = await findBranchById(branchId, organizationId, db);
  if (!branch) {
    throw new AppError("La sucursal indicada no existe o no pertenece a tu organización", 400);
  }
  return branch;
}

export interface CreateKnowledgeBaseEntryInput {
  branchId: string;
  title: string;
  content: string;
  isActive?: boolean;
}

export async function createKnowledgeBaseEntry(
  organizationId: string,
  input: CreateKnowledgeBaseEntryInput,
) {
  // 400 rápido en el caso común, sin abrir transacción.
  await validateBranchId(organizationId, input.branchId);

  return prisma.$transaction(async (tx) => {
    // Mismo lock que createAgent: serializa contra deleteBranch para que la
    // entrada no quede colgando de una sucursal borrada entre el pre-check y
    // el INSERT.
    await lockBranchForUpdate(input.branchId, organizationId, tx);

    // Revalida con el lock sostenido: entre el pre-check y este punto,
    // deleteBranch pudo haber borrado la sucursal.
    await validateBranchId(organizationId, input.branchId, tx);

    return createKnowledgeBaseEntryRepo(
      {
        organizationId,
        branchId: input.branchId,
        title: input.title,
        content: input.content,
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
      tx,
    );
  });
}

// CON branchId, y es una decisión tomada EN CONTRA del precedente de Agent y
// Resource, no un descuido de copiado.
//
// Un Agent no cambia de sucursal porque cada Conversation lleva su branchId
// denormalizado desde él: moverlo dejaría conversaciones históricas apuntando a
// una sucursal que no las atendió. Una entrada de KB no tiene ningún dato
// histórico denormalizado que dependa de su sucursal — nada la referencia, y el
// prompt se arma leyendo el estado actual en cada turno. Sin esa razón de
// integridad, prohibir el cambio sería inventar una restricción: mover una FAQ
// de sucursal es exactamente lo que alguien quiere hacer cuando la cargó en la
// equivocada, y obligarlo a borrar y reescribir 10.000 caracteres no protege
// nada.
export interface UpdateKnowledgeBaseEntryInput {
  branchId?: string;
  title?: string;
  content?: string;
  isActive?: boolean;
}

export async function updateKnowledgeBaseEntry(
  organizationId: string,
  id: string,
  input: UpdateKnowledgeBaseEntryInput,
) {
  await getKnowledgeBaseEntryById(organizationId, id);

  // La sucursal NUEVA se valida con el mismo criterio que en el create: tiene
  // que existir, estar viva y ser de esta organización. Sin esto, un PATCH
  // podría mover una entrada a la sucursal de otro tenant — la FK compuesta lo
  // rechazaría con un 500 en vez de con el 400 que corresponde.
  if (input.branchId !== undefined) {
    await validateBranchId(organizationId, input.branchId);
  }

  const result = await updateKnowledgeBaseEntryRepo(id, organizationId, input);
  if (result.count === 0) {
    throw new AppError("Entrada de la base de conocimiento no encontrada", 404);
  }

  return getKnowledgeBaseEntryById(organizationId, id);
}

// Soft delete a secas, SIN ninguna cascada ni RESTRICT: nada cuelga de una
// entrada de la base de conocimiento. El único efecto es que deja de entrar al
// prompt en el siguiente turno de cualquier agente de esa sucursal, porque
// findActiveKnowledgeBaseEntriesByBranch exige deletedAt: null.
export async function deleteKnowledgeBaseEntry(organizationId: string, id: string) {
  await getKnowledgeBaseEntryById(organizationId, id);

  const result = await softDeleteKnowledgeBaseEntry(id, organizationId);
  if (result.count === 0) {
    throw new AppError("Entrada de la base de conocimiento no encontrada", 404);
  }
}
