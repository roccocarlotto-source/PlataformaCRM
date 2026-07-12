import type { ActivityType, Prisma } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";

export interface ActivityFilters {
  search?: string;
  type?: ActivityType;
  authorId?: string;
  assigneeId?: string;
  companyId?: string;
  contactId?: string;
  opportunityId?: string;
  dueDateFrom?: Date;
  dueDateTo?: Date;
  completedAtFrom?: Date;
  completedAtTo?: Date;
}

export type ActivitySortBy =
  | "createdAt"
  | "updatedAt"
  | "dueDate"
  | "completedAt"
  | "subject";
export type SortOrder = "asc" | "desc";

// organizationId siempre obligatorio y deletedAt: null siempre presente en
// lecturas — mismo criterio que el resto de las entidades. `search` (OR
// entre subject/body) convive con los filtros específicos en el mismo
// `where` — Prisma los combina con AND implícito, igual que en Contact.
function buildWhere(
  organizationId: string,
  filters: ActivityFilters,
): Prisma.ActivityWhereInput {
  return {
    organizationId,
    deletedAt: null,
    ...(filters.search
      ? {
          OR: [
            { subject: { contains: filters.search, mode: "insensitive" } },
            { body: { contains: filters.search, mode: "insensitive" } },
          ],
        }
      : {}),
    ...(filters.type ? { type: filters.type } : {}),
    ...(filters.authorId ? { authorId: filters.authorId } : {}),
    ...(filters.assigneeId ? { assigneeId: filters.assigneeId } : {}),
    ...(filters.companyId ? { companyId: filters.companyId } : {}),
    ...(filters.contactId ? { contactId: filters.contactId } : {}),
    ...(filters.opportunityId ? { opportunityId: filters.opportunityId } : {}),
    ...(filters.dueDateFrom !== undefined || filters.dueDateTo !== undefined
      ? {
          dueDate: {
            ...(filters.dueDateFrom !== undefined
              ? { gte: filters.dueDateFrom }
              : {}),
            ...(filters.dueDateTo !== undefined
              ? { lte: filters.dueDateTo }
              : {}),
          },
        }
      : {}),
    ...(filters.completedAtFrom !== undefined ||
    filters.completedAtTo !== undefined
      ? {
          completedAt: {
            ...(filters.completedAtFrom !== undefined
              ? { gte: filters.completedAtFrom }
              : {}),
            ...(filters.completedAtTo !== undefined
              ? { lte: filters.completedAtTo }
              : {}),
          },
        }
      : {}),
  };
}

function buildOrderBy(
  sortBy: ActivitySortBy,
  sortOrder: SortOrder,
): Prisma.ActivityOrderByWithRelationInput {
  switch (sortBy) {
    case "updatedAt":
      return { updatedAt: sortOrder };
    case "dueDate":
      return { dueDate: sortOrder };
    case "completedAt":
      return { completedAt: sortOrder };
    case "subject":
      return { subject: sortOrder };
    case "createdAt":
    default:
      return { createdAt: sortOrder };
  }
}

export function findManyActivities(
  organizationId: string,
  filters: ActivityFilters,
  pagination: { skip: number; take: number },
  sort: { sortBy: ActivitySortBy; sortOrder: SortOrder },
  db: Db = prisma,
) {
  return db.activity.findMany({
    where: buildWhere(organizationId, filters),
    orderBy: buildOrderBy(sort.sortBy, sort.sortOrder),
    skip: pagination.skip,
    take: pagination.take,
  });
}

export function countActivities(
  organizationId: string,
  filters: ActivityFilters,
  db: Db = prisma,
) {
  return db.activity.count({ where: buildWhere(organizationId, filters) });
}

export function findActivityById(
  id: string,
  organizationId: string,
  db: Db = prisma,
) {
  return db.activity.findFirst({
    where: { id, organizationId, deletedAt: null },
  });
}

export interface CreateActivityData {
  organizationId: string;
  authorId: string;
  type: ActivityType;
  assigneeId: string | null;
  companyId: string | null;
  contactId: string | null;
  opportunityId: string | null;
  subject: string;
  body?: string;
  dueDate?: Date;
  completedAt?: Date;
}

export function createActivity(data: CreateActivityData, db: Db = prisma) {
  return db.activity.create({ data });
}

export interface UpdateActivityData {
  type?: ActivityType;
  assigneeId?: string | null;
  companyId?: string | null;
  contactId?: string | null;
  opportunityId?: string | null;
  subject?: string;
  body?: string | null;
  dueDate?: Date | null;
  completedAt?: Date | null;
}

// updateMany en vez de update: el WHERE efectivo tiene que exigir
// organizationId además de id (M4) — la escritura en sí es la garantía de
// aislamiento, no solo el pre-check del service. count === 0 se traduce a
// 404 en el service.
export function updateActivity(
  id: string,
  organizationId: string,
  data: UpdateActivityData,
  db: Db = prisma,
) {
  return db.activity.updateMany({ where: { id, organizationId }, data });
}

export function softDeleteActivity(
  id: string,
  organizationId: string,
  db: Db = prisma,
) {
  return db.activity.updateMany({
    where: { id, organizationId },
    data: { deletedAt: new Date() },
  });
}
