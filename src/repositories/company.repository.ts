import type { Prisma } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";

export interface CompanyFilters {
  search?: string;
  industry?: string;
  ownerId?: string;
}

export type CompanySortBy = "name" | "createdAt" | "industry";
export type SortOrder = "asc" | "desc";

// organizationId siempre obligatorio y deletedAt: null siempre presente en
// lecturas — el único lugar donde se arma el filtro multi-tenant + soft
// delete para esta entidad, para que findMany/count nunca puedan divergir.
function buildWhere(
  organizationId: string,
  filters: CompanyFilters,
): Prisma.CompanyWhereInput {
  return {
    organizationId,
    deletedAt: null,
    ...(filters.search
      ? { name: { contains: filters.search, mode: "insensitive" } }
      : {}),
    ...(filters.industry ? { industry: filters.industry } : {}),
    ...(filters.ownerId ? { ownerId: filters.ownerId } : {}),
  };
}

function buildOrderBy(
  sortBy: CompanySortBy,
  sortOrder: SortOrder,
): Prisma.CompanyOrderByWithRelationInput {
  switch (sortBy) {
    case "name":
      return { name: sortOrder };
    case "industry":
      return { industry: sortOrder };
    case "createdAt":
    default:
      return { createdAt: sortOrder };
  }
}

export function findManyCompanies(
  organizationId: string,
  filters: CompanyFilters,
  pagination: { skip: number; take: number },
  sort: { sortBy: CompanySortBy; sortOrder: SortOrder },
  db: Db = prisma,
) {
  return db.company.findMany({
    where: buildWhere(organizationId, filters),
    orderBy: buildOrderBy(sort.sortBy, sort.sortOrder),
    skip: pagination.skip,
    take: pagination.take,
  });
}

export function countCompanies(
  organizationId: string,
  filters: CompanyFilters,
  db: Db = prisma,
) {
  return db.company.count({ where: buildWhere(organizationId, filters) });
}

export function findCompanyById(
  id: string,
  organizationId: string,
  db: Db = prisma,
) {
  return db.company.findFirst({
    where: { id, organizationId, deletedAt: null },
  });
}

export interface CreateCompanyData {
  organizationId: string;
  ownerId: string | null;
  name: string;
  domain?: string | null;
  industry?: string | null;
  phone?: string | null;
  city?: string | null;
  country?: string | null;
}

export function createCompany(data: CreateCompanyData, db: Db = prisma) {
  return db.company.create({ data });
}

export interface UpdateCompanyData {
  ownerId?: string;
  name?: string;
  domain?: string | null;
  industry?: string | null;
  phone?: string | null;
  city?: string | null;
  country?: string | null;
}

export function updateCompany(
  id: string,
  data: UpdateCompanyData,
  db: Db = prisma,
) {
  return db.company.update({ where: { id }, data });
}

export function softDeleteCompany(id: string, db: Db = prisma) {
  return db.company.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
}
