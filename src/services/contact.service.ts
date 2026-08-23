import { Prisma, type LifecycleStage } from "@prisma/client";
import { findCompanyById } from "../repositories/company.repository";
import {
  countContacts,
  createContact as createContactRepo,
  findContactById,
  findManyContacts,
  softDeleteContact,
  updateContact as updateContactRepo,
  type ContactSortBy,
  type SortOrder,
} from "../repositories/contact.repository";
import { AppError } from "../utils/AppError";
import { resolveOwnerId } from "./ownership.service";

export interface ListContactsParams {
  page: number;
  pageSize: number;
  search?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  companyId?: string;
  ownerId?: string;
  lifecycleStage?: LifecycleStage;
  source?: string;
  sortBy: ContactSortBy;
  sortOrder: SortOrder;
}

export async function listContacts(
  organizationId: string,
  params: ListContactsParams,
) {
  const { page, pageSize, sortBy, sortOrder, ...filters } = params;
  const skip = (page - 1) * pageSize;

  const [data, total] = await Promise.all([
    findManyContacts(
      organizationId,
      filters,
      { skip, take: pageSize },
      { sortBy, sortOrder },
    ),
    countContacts(organizationId, filters),
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

export async function getContactById(organizationId: string, id: string) {
  const contact = await findContactById(id, organizationId);
  if (!contact) {
    throw new AppError("Contacto no encontrado", 404);
  }
  return contact;
}

// Si no se especifica companyId, el contacto queda sin empresa asociada. Si
// se especifica, tiene que existir, ser de la misma organización, y no
// estar eliminada — findCompanyById (de company.repository) ya filtra las
// tres condiciones en una sola consulta, se reutiliza tal cual.
async function resolveCompanyId(
  organizationId: string,
  requestedCompanyId: string | undefined,
): Promise<string | null> {
  if (!requestedCompanyId) {
    return null;
  }

  const company = await findCompanyById(requestedCompanyId, organizationId);

  if (!company) {
    throw new AppError(
      "El companyId indicado no existe, no pertenece a tu organización, o está eliminada",
      400,
    );
  }

  return company.id;
}

// Único índice de unicidad real que Contact tiene y Company no
// (contacts_org_email_unique, ver manual_constraints.sql): traduce la
// violación de esa constraint a un 409 legible en vez de un 500 crudo.
//
// Exportada para poder testear la traducción sin base (contact.service.test.ts).
export function rethrowAsConflict(err: unknown): never {
  if (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2002"
  ) {
    const target = Array.isArray(err.meta?.target)
      ? err.meta.target.join(",")
      : String(err.meta?.target ?? "");

    if (target.includes("email")) {
      throw new AppError(
        "Ya existe un contacto con ese email en esta organización",
        409,
      );
    }
    throw new AppError("El registro ya existe", 409);
  }

  throw err;
}

// Normaliza el email para que la constraint de unicidad de la base
// (case-sensitive tal como está definida) cumpla su propósito real: sin
// esto, "john@acme.com" y "John@Acme.com" se tratarían como distintos.
//
// Exportada para poder testearla sin base (contact.service.test.ts).
export function normalizeEmail(email: string | undefined): string | undefined {
  return email?.trim().toLowerCase();
}

export interface CreateContactInput {
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  jobTitle?: string;
  lifecycleStage?: LifecycleStage;
  source?: string;
  companyId?: string;
  ownerId?: string;
}

export async function createContact(
  organizationId: string,
  actorUserId: string,
  input: CreateContactInput,
) {
  const [ownerId, companyId] = await Promise.all([
    resolveOwnerId(organizationId, actorUserId, input.ownerId),
    resolveCompanyId(organizationId, input.companyId),
  ]);

  try {
    return await createContactRepo({
      organizationId,
      companyId,
      ownerId,
      firstName: input.firstName,
      lastName: input.lastName,
      email: normalizeEmail(input.email),
      phone: input.phone ?? null,
      jobTitle: input.jobTitle ?? null,
      lifecycleStage: input.lifecycleStage,
      source: input.source ?? null,
    });
  } catch (err) {
    rethrowAsConflict(err);
  }
}

export interface UpdateContactInput {
  firstName?: string;
  lastName?: string;
  email?: string | null;
  phone?: string | null;
  jobTitle?: string | null;
  lifecycleStage?: LifecycleStage;
  source?: string | null;
  companyId?: string;
  ownerId?: string;
}

export async function updateContact(
  organizationId: string,
  actorUserId: string,
  id: string,
  input: UpdateContactInput,
) {
  // 404 si no existe, no es de esta organización, o ya está borrado.
  await getContactById(organizationId, id);

  const data: UpdateContactInput = { ...input };

  if (input.ownerId) {
    data.ownerId = await resolveOwnerId(
      organizationId,
      actorUserId,
      input.ownerId,
    );
  }

  if (input.companyId) {
    data.companyId = (await resolveCompanyId(organizationId, input.companyId)) ?? undefined;
  }

  if (input.email !== undefined) {
    data.email = normalizeEmail(input.email ?? undefined);
  }

  try {
    const result = await updateContactRepo(id, organizationId, data);
    if (result.count === 0) {
      throw new AppError("Contacto no encontrado", 404);
    }
  } catch (err) {
    rethrowAsConflict(err);
  }

  return getContactById(organizationId, id);
}

export async function deleteContact(organizationId: string, id: string) {
  await getContactById(organizationId, id);
  const result = await softDeleteContact(id, organizationId);
  if (result.count === 0) {
    throw new AppError("Contacto no encontrado", 404);
  }
}
