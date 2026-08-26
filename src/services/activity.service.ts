import { Prisma, type ActivityType } from "@prisma/client";
import { findCompanyById } from "../repositories/company.repository";
import { findContactById } from "../repositories/contact.repository";
import {
  countActivities,
  createActivity as createActivityRepo,
  findActivityById,
  findManyActivities,
  softDeleteActivity,
  updateActivity as updateActivityRepo,
  type ActivitySortBy,
  type SortOrder,
} from "../repositories/activity.repository";
import { findOpportunityById } from "../repositories/opportunity.repository";
import { findUserByIdInOrganization } from "../repositories/user.repository";
import { AppError } from "../utils/AppError";

export interface ListActivitiesParams {
  page: number;
  pageSize: number;
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
  sortBy: ActivitySortBy;
  sortOrder: SortOrder;
}

export async function listActivities(organizationId: string, params: ListActivitiesParams) {
  const { page, pageSize, sortBy, sortOrder, ...filters } = params;
  const skip = (page - 1) * pageSize;

  const [data, total] = await Promise.all([
    findManyActivities(organizationId, filters, { skip, take: pageSize }, { sortBy, sortOrder }),
    countActivities(organizationId, filters),
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

export async function getActivityById(organizationId: string, id: string) {
  const activity = await findActivityById(id, organizationId);
  if (!activity) {
    throw new AppError("Actividad no encontrada", 404);
  }
  return activity;
}

// assigneeId NO reutiliza resolveOwnerId de ownership.service.ts: ese
// helper, si no se especifica un id, asigna por default a quien crea el
// registro — semántica correcta para "owner", incorrecta para "assignee"
// (una actividad sin asignar debe quedar assigneeId: null, nunca
// autoasignada al autor). Se reutiliza en cambio la misma consulta que
// resolveOwnerId usa internamente (findUserByIdInOrganization: existe,
// misma organización, activo), con un validador local sin comportamiento
// de default.
async function validateAssigneeId(
  organizationId: string,
  assigneeId: string | undefined,
): Promise<string | null> {
  if (!assigneeId) {
    return null;
  }

  const user = await findUserByIdInOrganization(assigneeId, organizationId);

  if (!user) {
    throw new AppError(
      "El assigneeId indicado no existe, no pertenece a tu organización, o está desactivado",
      400,
    );
  }

  return user.id;
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

async function validateOpportunityId(
  organizationId: string,
  opportunityId: string | undefined,
): Promise<string | null> {
  if (!opportunityId) {
    return null;
  }
  const opportunity = await findOpportunityById(opportunityId, organizationId);
  if (!opportunity) {
    throw new AppError(
      "El opportunityId indicado no existe, no pertenece a tu organización, o está eliminada",
      400,
    );
  }
  return opportunity.id;
}

export interface CreateActivityInput {
  type: ActivityType;
  subject: string;
  body?: string;
  dueDate?: Date;
  completedAt?: Date;
  assigneeId?: string;
  companyId?: string;
  contactId?: string;
  opportunityId?: string;
}

// authorId nunca viene de acá: lo resuelve authenticate.ts (req.auth.userId)
// y lo pasa el controller como actorUserId — no existe en CreateActivityInput
// a propósito, para que sea imposible que un valor del cliente llegue a
// pisarlo, ni por error de tipeo futuro.
export async function createActivity(
  organizationId: string,
  actorUserId: string,
  input: CreateActivityInput,
) {
  const [assigneeId, companyId, contactId, opportunityId] = await Promise.all([
    validateAssigneeId(organizationId, input.assigneeId),
    validateCompanyId(organizationId, input.companyId),
    validateContactId(organizationId, input.contactId),
    validateOpportunityId(organizationId, input.opportunityId),
  ]);

  return createActivityRepo({
    organizationId,
    authorId: actorUserId,
    type: input.type,
    assigneeId,
    companyId,
    contactId,
    opportunityId,
    subject: input.subject,
    body: input.body,
    dueDate: input.dueDate,
    completedAt: input.completedAt,
  });
}

export interface UpdateActivityInput {
  type?: ActivityType;
  subject?: string;
  body?: string | null;
  dueDate?: Date | null;
  completedAt?: Date | null;
  assigneeId?: string | null;
  companyId?: string | null;
  contactId?: string | null;
  opportunityId?: string | null;
}

// authorId no es un parámetro de esta función a propósito: no existe forma
// de modificarlo vía PATCH (ver createActivity).
export async function updateActivity(
  organizationId: string,
  id: string,
  input: UpdateActivityInput,
) {
  // 404 si no existe, no es de esta organización, o ya está eliminada.
  const activity = await getActivityById(organizationId, id);

  const data: UpdateActivityInput = { ...input };

  if ("assigneeId" in input) {
    data.assigneeId = input.assigneeId
      ? await validateAssigneeId(organizationId, input.assigneeId)
      : null;
  }

  if ("companyId" in input && input.companyId) {
    data.companyId = await validateCompanyId(organizationId, input.companyId);
  }

  if ("contactId" in input && input.contactId) {
    data.contactId = await validateContactId(organizationId, input.contactId);
  }

  if ("opportunityId" in input && input.opportunityId) {
    data.opportunityId = await validateOpportunityId(organizationId, input.opportunityId);
  }

  // Estado final de las tres relaciones: combina lo que la Activity ya
  // tenía con lo que realmente vino en el payload — una clave ausente no
  // se toca, un `null` explícito limpia. "companyId" in input distingue
  // ambos casos (a diferencia de input.companyId !== undefined, que no
  // podría distinguir un `null` explícito de una clave ausente). Nunca
  // puede quedar sin ninguna de las tres, sin importar cómo se combinen
  // create/update a lo largo del tiempo.
  const finalCompanyId = "companyId" in input ? input.companyId : activity.companyId;
  const finalContactId = "contactId" in input ? input.contactId : activity.contactId;
  const finalOpportunityId =
    "opportunityId" in input ? input.opportunityId : activity.opportunityId;

  if (!finalCompanyId && !finalContactId && !finalOpportunityId) {
    throw new AppError(
      "La actividad debe estar relacionada a una Company, un Contact, o una Opportunity",
      400,
    );
  }

  // T-1 (auditoría nueva): el chequeo de arriba lee un snapshot (activity)
  // tomado antes de esta escritura, sin lock ni transacción que lo abarque
  // junto con el UPDATE — dos updateActivity concurrentes, cada uno
  // limpiando una relación distinta, pueden pasar los dos ese chequeo
  // contra un estado que el otro todavía no comiteó. La defensa real que
  // nunca falla es activities_related_entity_check (CHECK de Postgres,
  // manual_constraints.sql) — evita que el dato persistido termine sin
  // ninguna relación. Lo único que faltaba era traducir esa violación
  // concreta a un AppError en vez de dejarla subir cruda: un CHECK no
  // expone `meta.target` como P2002, así que se reconoce por el nombre
  // exacto de la constraint dentro de `err.message` (única superficie
  // estable disponible para un PrismaClientUnknownRequestError en
  // @prisma/client 5.22.0, verificado empíricamente — nunca por el texto
  // humano completo del mensaje, para no absorber ningún otro error por
  // accidente). El motor de queries de Prisma expone el mensaje crudo de
  // Postgres re-serializado dentro del Debug de Rust de todo el error de
  // conector — las comillas que Postgres pone alrededor del nombre de la
  // constraint quedan escapadas con una barra invertida literal en el
  // string resultante (`\"activities_related_entity_check\"`, no
  // `"activities_related_entity_check"` a secas) — de ahí el patrón exacto
  // de abajo.
  try {
    const result = await updateActivityRepo(id, organizationId, data);
    if (result.count === 0) {
      throw new AppError("Actividad no encontrada", 404);
    }
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientUnknownRequestError &&
      err.message.includes('\\"activities_related_entity_check\\"')
    ) {
      throw new AppError(
        "La actividad debe estar relacionada a una Company, un Contact, o una Opportunity",
        400,
      );
    }
    throw err;
  }

  return getActivityById(organizationId, id);
}

export async function deleteActivity(organizationId: string, id: string) {
  await getActivityById(organizationId, id);
  const result = await softDeleteActivity(id, organizationId);
  if (result.count === 0) {
    throw new AppError("Actividad no encontrada", 404);
  }
}
