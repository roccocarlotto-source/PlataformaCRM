import {
  countCompanies,
  createCompany as createCompanyRepo,
  findCompanyById,
  findManyCompanies,
  softDeleteCompany,
  updateCompany as updateCompanyRepo,
  type CompanySortBy,
  type SortOrder,
} from "../repositories/company.repository";
import { AppError } from "../utils/AppError";
import { resolveOwnerId } from "./ownership.service";

export interface ListCompaniesParams {
  page: number;
  pageSize: number;
  search?: string;
  industry?: string;
  ownerId?: string;
  sortBy: CompanySortBy;
  sortOrder: SortOrder;
}

export async function listCompanies(
  organizationId: string,
  params: ListCompaniesParams,
) {
  const { page, pageSize, sortBy, sortOrder, ...filters } = params;
  const skip = (page - 1) * pageSize;

  const [data, total] = await Promise.all([
    findManyCompanies(
      organizationId,
      filters,
      { skip, take: pageSize },
      { sortBy, sortOrder },
    ),
    countCompanies(organizationId, filters),
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

export async function getCompanyById(organizationId: string, id: string) {
  const company = await findCompanyById(id, organizationId);
  if (!company) {
    throw new AppError("Empresa no encontrada", 404);
  }
  return company;
}

export interface CreateCompanyInput {
  name: string;
  domain?: string;
  industry?: string;
  phone?: string;
  city?: string;
  country?: string;
  ownerId?: string;
}

export async function createCompany(
  organizationId: string,
  actorUserId: string,
  input: CreateCompanyInput,
) {
  const ownerId = await resolveOwnerId(
    organizationId,
    actorUserId,
    input.ownerId,
  );

  return createCompanyRepo({
    organizationId,
    ownerId,
    name: input.name,
    domain: input.domain ?? null,
    industry: input.industry ?? null,
    phone: input.phone ?? null,
    city: input.city ?? null,
    country: input.country ?? null,
  });
}

export interface UpdateCompanyInput {
  name?: string;
  domain?: string | null;
  industry?: string | null;
  phone?: string | null;
  city?: string | null;
  country?: string | null;
  ownerId?: string;
}

export async function updateCompany(
  organizationId: string,
  actorUserId: string,
  id: string,
  input: UpdateCompanyInput,
) {
  // 404 si no existe, no es de esta organización, o ya está borrada.
  await getCompanyById(organizationId, id);

  const data: UpdateCompanyInput = { ...input };

  if (input.ownerId) {
    data.ownerId = await resolveOwnerId(
      organizationId,
      actorUserId,
      input.ownerId,
    );
  }

  return updateCompanyRepo(id, data);
}

export async function deleteCompany(organizationId: string, id: string) {
  await getCompanyById(organizationId, id);
  await softDeleteCompany(id);
}
