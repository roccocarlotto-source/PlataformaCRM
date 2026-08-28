import type { OpportunityStatus } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";
import { findCompanyById } from "../repositories/company.repository";
import { findContactById } from "../repositories/contact.repository";
import {
  countOpportunities,
  createOpportunity as createOpportunityRepo,
  findManyOpportunities,
  findOpportunityById,
  softDeleteOpportunity,
  updateOpportunity as updateOpportunityRepo,
  type OpportunitySortBy,
  type SortOrder,
} from "../repositories/opportunity.repository";
import { findPipelineById } from "../repositories/pipeline.repository";
import { findStageById, lockStageForUpdate } from "../repositories/stage.repository";
import { AppError } from "../utils/AppError";
import { resolveOwnerId } from "./ownership.service";

export interface ListOpportunitiesParams {
  page: number;
  pageSize: number;
  search?: string;
  companyId?: string;
  contactId?: string;
  ownerId?: string;
  pipelineId?: string;
  stageId?: string;
  status?: OpportunityStatus;
  currency?: string;
  minAmount?: number;
  maxAmount?: number;
  sortBy: OpportunitySortBy;
  sortOrder: SortOrder;
}

export async function listOpportunities(organizationId: string, params: ListOpportunitiesParams) {
  const { page, pageSize, sortBy, sortOrder, ...filters } = params;
  const skip = (page - 1) * pageSize;

  const [data, total] = await Promise.all([
    findManyOpportunities(organizationId, filters, { skip, take: pageSize }, { sortBy, sortOrder }),
    countOpportunities(organizationId, filters),
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

export async function getOpportunityById(organizationId: string, id: string) {
  const opportunity = await findOpportunityById(id, organizationId);
  if (!opportunity) {
    throw new AppError("Oportunidad no encontrada", 404);
  }
  return opportunity;
}

async function validateCompanyId(
  organizationId: string,
  companyId: string | undefined,
): Promise<string | null> {
  if (!companyId) {
    return null;
  }
  const company = await findCompanyById(companyId, organizationId);
  if (!company) {
    throw new AppError(
      "El companyId indicado no existe, no pertenece a tu organización, o está eliminada",
      400,
    );
  }
  return company.id;
}

async function validateContactId(
  organizationId: string,
  contactId: string | undefined,
): Promise<string | null> {
  if (!contactId) {
    return null;
  }
  const contact = await findContactById(contactId, organizationId);
  if (!contact) {
    throw new AppError(
      "El contactId indicado no existe, no pertenece a tu organización, o está eliminado",
      400,
    );
  }
  return contact.id;
}

async function validatePipelineId(organizationId: string, pipelineId: string) {
  const pipeline = await findPipelineById(pipelineId, organizationId);
  if (!pipeline) {
    throw new AppError("El pipelineId indicado no existe o no pertenece a tu organización", 400);
  }
  return pipeline;
}

// El stage tiene que existir en la organización Y pertenecer al pipeline
// indicado — evita la inconsistencia "pipeline A + stage de pipeline B".
//
// `db` explícito para poder revalidar DENTRO de la transacción, con el lock de
// la fila del Stage ya sostenido (ALTO-8). El default es el pre-check rápido.
async function validateStageId(
  organizationId: string,
  stageId: string,
  pipelineId: string,
  db: Db = prisma,
) {
  const stage = await findStageById(stageId, organizationId, db);
  if (!stage) {
    throw new AppError("El stageId indicado no existe o no pertenece a tu organización", 400);
  }
  if (stage.pipelineId !== pipelineId) {
    throw new AppError("El stageId indicado no pertenece al pipeline especificado", 400);
  }
  return stage;
}

export interface CreateOpportunityInput {
  title: string;
  amount?: number;
  currency?: string;
  expectedCloseDate?: Date;
  actualCloseDate?: Date;
  status?: OpportunityStatus;
  lostReason?: string;
  companyId?: string;
  contactId?: string;
  pipelineId: string;
  stageId: string;
  ownerId?: string;
}

export async function createOpportunity(
  organizationId: string,
  actorUserId: string,
  input: CreateOpportunityInput,
) {
  const [ownerId, companyId, contactId] = await Promise.all([
    resolveOwnerId(organizationId, actorUserId, input.ownerId),
    validateCompanyId(organizationId, input.companyId),
    validateContactId(organizationId, input.contactId),
  ]);

  // Pre-checks rápidos, fuera de la transacción — 400 inmediato en el caso
  // común sin abrir una. No son la defensa: la lectura que decide es la de
  // adentro, con el lock ya tomado.
  await validatePipelineId(organizationId, input.pipelineId);
  await validateStageId(organizationId, input.stageId, input.pipelineId);

  return prisma.$transaction(async (tx) => {
    // ALTO-8 — la otra mitad del RESTRICT de deleteStage. Ese borrado decide
    // sobre un conteo de oportunidades activas; sin este lock, dos requests
    // concurrentes —uno creando la oportunidad, otro borrando el stage— pasan
    // los dos su chequeo y la oportunidad queda en un stage borrado, invisible
    // en el tablero pero contada en los totales.
    await lockStageForUpdate(input.stageId, organizationId, tx);

    // Revalida con el lock sostenido. Alcanza con el stage: no hace falta
    // revalidar el pipeline porque deletePipeline exige cero stages activos, y
    // este stage está vivo y lockeado — el pipeline no puede haberse borrado
    // debajo mientras eso sea cierto.
    await validateStageId(organizationId, input.stageId, input.pipelineId, tx);

    return createOpportunityRepo(
      {
        organizationId,
        companyId,
        contactId,
        ownerId,
        pipelineId: input.pipelineId,
        stageId: input.stageId,
        title: input.title,
        amount: input.amount,
        currency: input.currency,
        expectedCloseDate: input.expectedCloseDate,
        actualCloseDate: input.actualCloseDate,
        status: input.status,
        lostReason: input.lostReason,
      },
      tx,
    );
  });
}

export interface UpdateOpportunityInput {
  title?: string;
  amount?: number;
  currency?: string;
  expectedCloseDate?: Date | null;
  actualCloseDate?: Date | null;
  status?: OpportunityStatus;
  lostReason?: string | null;
  companyId?: string;
  contactId?: string;
  pipelineId?: string;
  stageId?: string;
  ownerId?: string;
}

export async function updateOpportunity(
  organizationId: string,
  actorUserId: string,
  id: string,
  input: UpdateOpportunityInput,
) {
  // 404 si no existe, no es de esta organización, o ya está borrada.
  const opportunity = await getOpportunityById(organizationId, id);

  const data: UpdateOpportunityInput = { ...input };

  if (input.ownerId) {
    data.ownerId = await resolveOwnerId(organizationId, actorUserId, input.ownerId);
  }

  if (input.companyId) {
    data.companyId = (await validateCompanyId(organizationId, input.companyId)) ?? undefined;
  }

  if (input.contactId) {
    data.contactId = (await validateContactId(organizationId, input.contactId)) ?? undefined;
  }

  // Mover de stage: el nuevo stage tiene que pertenecer al pipeline actual
  // de la oportunidad, salvo que el pipeline también se esté cambiando en
  // esta misma operación — nunca se cambia el pipeline "solo" implícito por
  // mover el stage.
  if (input.pipelineId && !input.stageId) {
    throw new AppError(
      "Si cambiás el pipeline, indicá también el nuevo stageId en la misma operación",
      400,
    );
  }

  if (input.pipelineId) {
    await validatePipelineId(organizationId, input.pipelineId);
  }

  const effectivePipelineId = input.pipelineId ?? opportunity.pipelineId;
  const nuevoStageId = input.stageId;

  if (nuevoStageId) {
    await validateStageId(organizationId, nuevoStageId, effectivePipelineId);
  }

  // La escritura va en transacción SOLO cuando cambia el stage, y es
  // deliberado: es el único caso con un invariante que defender —el RESTRICT de
  // deleteStage— y por lo tanto el único que necesita el lock. Un UPDATE que no
  // toca stageId no compite con nadie, y envolverlo igual costaría un BEGIN y
  // un COMMIT de más en el camino más frecuente.
  const result = nuevoStageId
    ? await prisma.$transaction(async (tx) => {
        await lockStageForUpdate(nuevoStageId, organizationId, tx);
        // Revalida con el lock sostenido: entre el pre-check de arriba y este
        // punto, deleteStage pudo haber borrado el stage de destino. Sin esto,
        // su RESTRICT sería evitable simplemente por llegar primero.
        await validateStageId(organizationId, nuevoStageId, effectivePipelineId, tx);
        return updateOpportunityRepo(id, organizationId, data, tx);
      })
    : await updateOpportunityRepo(id, organizationId, data);

  if (result.count === 0) {
    throw new AppError("Oportunidad no encontrada", 404);
  }

  return getOpportunityById(organizationId, id);
}

export async function deleteOpportunity(organizationId: string, id: string) {
  await getOpportunityById(organizationId, id);
  const result = await softDeleteOpportunity(id, organizationId);
  if (result.count === 0) {
    throw new AppError("Oportunidad no encontrada", 404);
  }
}
