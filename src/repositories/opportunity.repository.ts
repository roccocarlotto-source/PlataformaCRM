import type { OpportunityStatus, Prisma } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";

export interface OpportunityFilters {
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
}

export type OpportunitySortBy = "createdAt" | "updatedAt" | "amount" | "title";
export type SortOrder = "asc" | "desc";

function buildWhere(
  organizationId: string,
  filters: OpportunityFilters,
): Prisma.OpportunityWhereInput {
  return {
    organizationId,
    deletedAt: null,
    ...(filters.search ? { title: { contains: filters.search, mode: "insensitive" } } : {}),
    ...(filters.companyId ? { companyId: filters.companyId } : {}),
    ...(filters.contactId ? { contactId: filters.contactId } : {}),
    ...(filters.ownerId ? { ownerId: filters.ownerId } : {}),
    ...(filters.pipelineId ? { pipelineId: filters.pipelineId } : {}),
    ...(filters.stageId ? { stageId: filters.stageId } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.currency ? { currency: filters.currency } : {}),
    ...(filters.minAmount !== undefined || filters.maxAmount !== undefined
      ? {
          amount: {
            ...(filters.minAmount !== undefined ? { gte: filters.minAmount } : {}),
            ...(filters.maxAmount !== undefined ? { lte: filters.maxAmount } : {}),
          },
        }
      : {}),
  };
}

function buildOrderBy(
  sortBy: OpportunitySortBy,
  sortOrder: SortOrder,
): Prisma.OpportunityOrderByWithRelationInput {
  switch (sortBy) {
    case "updatedAt":
      return { updatedAt: sortOrder };
    case "amount":
      return { amount: sortOrder };
    case "title":
      return { title: sortOrder };
    case "createdAt":
    default:
      return { createdAt: sortOrder };
  }
}

export function findManyOpportunities(
  organizationId: string,
  filters: OpportunityFilters,
  pagination: { skip: number; take: number },
  sort: { sortBy: OpportunitySortBy; sortOrder: SortOrder },
  db: Db = prisma,
) {
  return db.opportunity.findMany({
    where: buildWhere(organizationId, filters),
    orderBy: buildOrderBy(sort.sortBy, sort.sortOrder),
    skip: pagination.skip,
    take: pagination.take,
  });
}

export function countOpportunities(
  organizationId: string,
  filters: OpportunityFilters,
  db: Db = prisma,
) {
  return db.opportunity.count({ where: buildWhere(organizationId, filters) });
}

export function findOpportunityById(id: string, organizationId: string, db: Db = prisma) {
  return db.opportunity.findFirst({
    where: { id, organizationId, deletedAt: null },
  });
}

export interface CreateOpportunityData {
  organizationId: string;
  companyId: string | null;
  contactId: string | null;
  ownerId: string;
  pipelineId: string;
  stageId: string;
  title: string;
  amount?: number;
  currency?: string;
  expectedCloseDate?: Date;
  actualCloseDate?: Date;
  status?: OpportunityStatus;
  lostReason?: string;
}

export function createOpportunity(data: CreateOpportunityData, db: Db = prisma) {
  return db.opportunity.create({ data });
}

export interface UpdateOpportunityData {
  companyId?: string;
  contactId?: string;
  ownerId?: string;
  pipelineId?: string;
  stageId?: string;
  title?: string;
  amount?: number;
  currency?: string;
  expectedCloseDate?: Date | null;
  actualCloseDate?: Date | null;
  status?: OpportunityStatus;
  lostReason?: string | null;
}

// updateMany en vez de update: el WHERE efectivo tiene que exigir
// organizationId además de id (M4) — la escritura en sí es la garantía de
// aislamiento, no solo el pre-check del service. count === 0 se traduce a
// 404 en el service.
export function updateOpportunity(
  id: string,
  organizationId: string,
  data: UpdateOpportunityData,
  db: Db = prisma,
) {
  return db.opportunity.updateMany({ where: { id, organizationId }, data });
}

export function softDeleteOpportunity(id: string, organizationId: string, db: Db = prisma) {
  return db.opportunity.updateMany({
    where: { id, organizationId },
    data: { deletedAt: new Date() },
  });
}
