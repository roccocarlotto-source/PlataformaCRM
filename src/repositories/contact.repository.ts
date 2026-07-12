import type { LifecycleStage, Prisma } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";

export interface ContactFilters {
  search?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  companyId?: string;
  ownerId?: string;
  lifecycleStage?: LifecycleStage;
  source?: string;
}

export type ContactSortBy = "firstName" | "lastName" | "createdAt" | "lifecycleStage";
export type SortOrder = "asc" | "desc";

// organizationId siempre obligatorio y deletedAt: null siempre presente en
// lecturas — el único lugar donde se arma el filtro multi-tenant + soft
// delete para esta entidad, para que findMany/count nunca puedan divergir.
//
// `search` (OR entre firstName/lastName/email) y los filtros específicos
// conviven en el mismo objeto: Prisma combina con AND implícito los campos
// de un mismo nivel, así que "search AND filtros adicionales" sale gratis
// sin necesitar un `AND: [...]` explícito.
function buildWhere(
  organizationId: string,
  filters: ContactFilters,
): Prisma.ContactWhereInput {
  return {
    organizationId,
    deletedAt: null,
    ...(filters.search
      ? {
          OR: [
            { firstName: { contains: filters.search, mode: "insensitive" } },
            { lastName: { contains: filters.search, mode: "insensitive" } },
            { email: { contains: filters.search, mode: "insensitive" } },
          ],
        }
      : {}),
    ...(filters.firstName
      ? { firstName: { contains: filters.firstName, mode: "insensitive" } }
      : {}),
    ...(filters.lastName
      ? { lastName: { contains: filters.lastName, mode: "insensitive" } }
      : {}),
    ...(filters.email
      ? { email: { contains: filters.email, mode: "insensitive" } }
      : {}),
    ...(filters.companyId ? { companyId: filters.companyId } : {}),
    ...(filters.ownerId ? { ownerId: filters.ownerId } : {}),
    ...(filters.lifecycleStage
      ? { lifecycleStage: filters.lifecycleStage }
      : {}),
    ...(filters.source ? { source: filters.source } : {}),
  };
}

function buildOrderBy(
  sortBy: ContactSortBy,
  sortOrder: SortOrder,
): Prisma.ContactOrderByWithRelationInput {
  switch (sortBy) {
    case "firstName":
      return { firstName: sortOrder };
    case "lastName":
      return { lastName: sortOrder };
    case "lifecycleStage":
      return { lifecycleStage: sortOrder };
    case "createdAt":
    default:
      return { createdAt: sortOrder };
  }
}

export function findManyContacts(
  organizationId: string,
  filters: ContactFilters,
  pagination: { skip: number; take: number },
  sort: { sortBy: ContactSortBy; sortOrder: SortOrder },
  db: Db = prisma,
) {
  return db.contact.findMany({
    where: buildWhere(organizationId, filters),
    orderBy: buildOrderBy(sort.sortBy, sort.sortOrder),
    skip: pagination.skip,
    take: pagination.take,
  });
}

export function countContacts(
  organizationId: string,
  filters: ContactFilters,
  db: Db = prisma,
) {
  return db.contact.count({ where: buildWhere(organizationId, filters) });
}

export function findContactById(
  id: string,
  organizationId: string,
  db: Db = prisma,
) {
  return db.contact.findFirst({
    where: { id, organizationId, deletedAt: null },
  });
}

export interface CreateContactData {
  organizationId: string;
  companyId: string | null;
  ownerId: string | null;
  firstName: string;
  lastName: string;
  email?: string | null;
  phone?: string | null;
  jobTitle?: string | null;
  lifecycleStage?: LifecycleStage;
  source?: string | null;
}

export function createContact(data: CreateContactData, db: Db = prisma) {
  return db.contact.create({ data });
}

export interface UpdateContactData {
  companyId?: string | null;
  ownerId?: string;
  firstName?: string;
  lastName?: string;
  email?: string | null;
  phone?: string | null;
  jobTitle?: string | null;
  lifecycleStage?: LifecycleStage;
  source?: string | null;
}

// updateMany en vez de update: el WHERE efectivo tiene que exigir
// organizationId además de id (M4) — la escritura en sí es la garantía de
// aislamiento, no solo el pre-check del service. count === 0 se traduce a
// 404 en el service.
export function updateContact(
  id: string,
  organizationId: string,
  data: UpdateContactData,
  db: Db = prisma,
) {
  return db.contact.updateMany({ where: { id, organizationId }, data });
}

export function softDeleteContact(
  id: string,
  organizationId: string,
  db: Db = prisma,
) {
  return db.contact.updateMany({
    where: { id, organizationId },
    data: { deletedAt: new Date() },
  });
}
