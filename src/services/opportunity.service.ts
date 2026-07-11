import type { OpportunityStatus } from "@prisma/client";
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
import { findStageById } from "../repositories/stage.repository";
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

export async function listOpportunities(
  organizationId: string,
  params: ListOpportunitiesParams,
) {
  const { page, pageSize, sortBy, sortOrder, ...filters } = params;
  const skip = (page - 1) * pageSize;

  const [data, total] = await Promise.all([
    findManyOpportunities(
      organizationId,
      filters,
      { skip, take: pageSize },
      { sortBy, sortOrder },
    ),
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
    throw new AppError(
      "El pipelineId indicado no existe o no pertenece a tu organización",
      400,
    );
  }
  return pipeline;
}

// El stage tiene que existir en la organización Y pertenecer al pipeline
// indicado — evita la inconsistencia "pipeline A + stage de pipeline B".
async function validateStageId(
  organizationId: string,
  stageId: string,
  pipelineId: string,
) {
  const stage = await findStageById(stageId, organizationId);
  if (!stage) {
    throw new AppError(
      "El stageId indicado no existe o no pertenece a tu organización",
      400,
    );
  }
  if (stage.pipelineId !== pipelineId) {
    throw new AppError(
      "El stageId indicado no pertenece al pipeline especificado",
      400,
    );
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

  await validatePipelineId(organizationId, input.pipelineId);
  await validateStageId(organizationId, input.stageId, input.pipelineId);

  return createOpportunityRepo({
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
    data.ownerId = await resolveOwnerId(
      organizationId,
      actorUserId,
      input.ownerId,
    );
  }

  if (input.companyId) {
    data.companyId =
      (await validateCompanyId(organizationId, input.companyId)) ?? undefined;
  }

  if (input.contactId) {
    data.contactId =
      (await validateContactId(organizationId, input.contactId)) ?? undefined;
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

  if (input.stageId) {
    const effectivePipelineId = input.pipelineId ?? opportunity.pipelineId;
    await validateStageId(organizationId, input.stageId, effectivePipelineId);
  }

  return updateOpportunityRepo(id, data);
}

export async function deleteOpportunity(organizationId: string, id: string) {
  await getOpportunityById(organizationId, id);
  await softDeleteOpportunity(id);
}
