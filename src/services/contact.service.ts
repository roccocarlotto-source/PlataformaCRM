import { Prisma, type LeadUrgency, type LifecycleStage } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { findCompanyById } from "../repositories/company.repository";
import {
  countContacts,
  createContact as createContactRepo,
  erasePersonalDataFromContact,
  findContactById,
  findContactByIdIncludingDeleted,
  findManyContacts,
  softDeleteContact,
  updateContact as updateContactRepo,
  updateLeadQualification,
  type ContactSortBy,
  type SortOrder,
  type UpdateLeadQualificationData,
} from "../repositories/contact.repository";
import { anonymizeIngestionEventsOfContact } from "../repositories/ingestionEvent.repository";
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

export async function listContacts(organizationId: string, params: ListContactsParams) {
  const { page, pageSize, sortBy, sortOrder, ...filters } = params;
  const skip = (page - 1) * pageSize;

  const [data, total] = await Promise.all([
    findManyContacts(organizationId, filters, { skip, take: pageSize }, { sortBy, sortOrder }),
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
// DEPENDE DEL NOMBRE DEL ÍNDICE, y por eso M-13 lo conservó al redefinirlo.
// El índice es parcial y sobre expresión, dos formas que el DSL de Prisma no
// expresa, así que Prisma no puede mapearlo a nombres de campo y reporta el
// nombre crudo en err.meta.target. Mientras contenga "email", la traducción al
// 409 específico funciona con cualquiera de las dos formas que Prisma pueda
// devolver (array de columnas o nombre del índice). Si alguien renombrara el
// índice a algo sin "email" adentro, esto degradaría en silencio al 409
// genérico y ningún test unitario lo vería — los unitarios le pasan el target
// a mano. Por eso hay un test de integración que captura el error real de
// Postgres y lo pasa por acá.
//
// Exportada para poder testear la traducción sin base (contact.service.test.ts).
export function rethrowAsConflict(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    const target = Array.isArray(err.meta?.target)
      ? err.meta.target.join(",")
      : String(err.meta?.target ?? "");

    if (target.includes("email")) {
      throw new AppError("Ya existe un contacto con ese email en esta organización", 409);
    }
    throw new AppError("El registro ya existe", 409);
  }

  throw err;
}

// Recorta los espacios al borde del email antes de escribir. YA NO BAJA A
// MINÚSCULAS, y la ausencia es deliberada (M-13):
//
// El case lo garantiza la base. contacts_org_email_unique es un índice sobre
// lower(email), así que "John@Acme.com" y "john@acme.com" no pueden coexistir
// sin que ningún código tenga que acordarse de nada. Bajar a minúsculas acá
// sería conservar una línea cuya razón de existir se borró — y peor: la
// promoción desde staging (ítem 4 de docs/ingestion-architecture.md) no la va a
// ejecutar, así que el mismo contacto quedaría escrito distinto según por qué
// puerta entró, que es exactamente el problema que M-13 vino a cerrar. Se
// guarda lo que la persona escribió.
//
// El .trim() SÍ sigue siendo load-bearing, y no es simétrico con el case:
// lower(' x ') no es igual a lower('x'), así que un espacio al borde sí crearía
// un duplicado falso. El CHECK contacts_email_trimmed_check es el RESPALDO que
// hace imposible saltearlo, no el mecanismo — la promoción tiene que normalizar
// los espacios igual (ver §9.6 del documento de ingesta).
//
// Exportada para poder testearla sin base (contact.service.test.ts).
export function normalizeEmail(email: string | undefined): string | undefined {
  return email?.trim();
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
  // `null` desvincula al contacto de su empresa (M-10).
  companyId?: string | null;
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
    data.ownerId = await resolveOwnerId(organizationId, actorUserId, input.ownerId);
  }

  // M-10 (auditoría 2026-08-29): `"companyId" in input`, no `if (input.companyId)`
  // — un truthy check trata `null` igual que "no vino", y `null` acá significa
  // "desvinculá al contacto de su empresa". resolveCompanyId ya devuelve
  // `null` cuando no recibe id (es lo que usa createContact para "sin
  // empresa"); lo que faltaba era no pisar ese resultado con `?? undefined`,
  // que Prisma ignora en un update. Misma idiom que activity.service.ts.
  if ("companyId" in input) {
    data.companyId = await resolveCompanyId(organizationId, input.companyId ?? undefined);
  }

  // M-29 del 21/08 (mitad backend), reabierto como M-10: `input.email ??
  // undefined` convertía un `null` explícito en `undefined` antes de que
  // normalizeEmail lo viera, y Prisma ignora `undefined` en un update — la
  // operación respondía 200 sin cambiar nada. El `null` se preserva; el
  // contrato de normalizeEmail (string | undefined, trim y nada más) no cambia.
  if (input.email !== undefined) {
    data.email = input.email === null ? null : normalizeEmail(input.email);
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

// ---------------------------------------------------------------------------
// Borrado de datos personales a pedido — D2-4 de
// docs/review-fase2-2026-08-28.md. La política está en
// docs/data-classification.md §5.2.
//
// NO ES deleteContact. Ese sigue existiendo, sigue siendo soft delete y sigue
// siendo reversible. Esto destruye datos y no se deshace.
//
// EN UNA TRANSACCIÓN, y no por prolijidad: si el contacto quedara anonimizado
// y la limpieza de los eventos fallara, el sistema afirmaría haber borrado
// datos personales que siguen enteros en `raw_payload`. Un borrado a medias es
// peor que uno que falló, porque nadie lo vuelve a pedir.
//
// El pre-chequeo con getContactById existe por el 404 (mismo criterio que el
// resto del módulo: no se confirma la existencia de recursos ajenos), pero la
// garantía de aislamiento es el `organizationId` dentro de cada WHERE, nunca
// este SELECT.
// ---------------------------------------------------------------------------

export interface ResultadoDeBorrado {
  contactId: string;
  // Cuántos eventos de ingesta perdieron su rawPayload. Se devuelve porque el
  // estándar pide que el borrado sea verificable, y porque quien lo pide tiene
  // que poder decir cuánto se borró sin ir a mirar la base.
  ingestionEventsAnonimizados: number;
}

export async function erasePersonalData(
  organizationId: string,
  id: string,
): Promise<ResultadoDeBorrado> {
  // M-18 (auditoría 2026-08-29): INCLUYENDO los soft-deleteados, y no
  // getContactById. Ese helper filtra deletedAt: null —correcto para
  // list/get/update/delete— y acá estaba reutilizado sin querer para lo
  // contrario: un contacto que ya recibió DELETE /api/contacts/:id (soft
  // delete) respondía 404 al pedir el borrado de sus datos, que seguían en la
  // fila y en ingestion_events.raw_payload, sin ningún camino para destruirlos.
  // El repositorio ya estaba preparado (erasePersonalDataFromContact ignora
  // deletedAt a propósito); lo que faltaba era que el service lo dejara llegar.
  // El aislamiento no cambia: organizationId sigue en el WHERE.
  const contacto = await findContactByIdIncludingDeleted(id, organizationId);
  if (!contacto) {
    throw new AppError("Contacto no encontrado", 404);
  }

  return prisma.$transaction(async (tx) => {
    const contacto = await erasePersonalDataFromContact(id, organizationId, tx);

    if (contacto.count === 0) {
      // Se borró entre el pre-chequeo y la escritura. Mismo 404.
      throw new AppError("Contacto no encontrado", 404);
    }

    const eventos = await anonymizeIngestionEventsOfContact(id, organizationId, tx);

    return { contactId: id, ingestionEventsAnonimizados: eventos.count };
  });
}

// ---------------------------------------------------------------------------
// Calificación del lead — qualifyLead (paso 3 de docs/ai-agent-architecture.md
// §9; decisiones en la nota fechada del paso 3 bajo §6).
//
// UNA función detrás de las dos tools create_lead / update_lead: no hay
// entidad Lead, son columnas de Contact, y un "create" que falle si ya hay
// datos sería un modelo pisándose contra un estado que no puede observar.
// Idempotente: cada campo que viene se escribe; `notes` SIEMPRE se agrega y
// `aiData` SIEMPRE se mergea — nunca pisan lo acumulado en conversaciones
// anteriores (comentario de leadNotes en el schema).
//
// LO QUE NO TOCA, y es la mitad del contrato: lifecycleStage (decisión humana,
// mismo precedente que la ingesta — CAMPOS_IGNORADOS de ingestContact.schema.ts),
// customFields (sin catálogo de definiciones todavía) y cualquier otro campo
// de Contact. El repositorio (updateLeadQualification) no los acepta.
// ---------------------------------------------------------------------------

export interface QualifyLeadInput {
  // 0..100 — el CHECK contacts_lead_score_range_check es el respaldo; el borde
  // (la tool) valida antes para fallar con un mensaje y no con un error de
  // Postgres.
  score?: number;
  intent?: string;
  serviceOfInterest?: string;
  urgency?: LeadUrgency;
  budgetAmount?: number;
  // ISO 4217; la tool exige que venga junto con budgetAmount.
  budgetCurrency?: string;
  location?: string;
  // SE AGREGA, nunca reemplaza.
  notes?: string;
  // Merge superficial, nunca reemplaza.
  aiData?: Record<string, unknown>;
}

// Marcador al frente de cada nota agregada, para poder distinguir de dónde
// vino cada una cuando el texto ya acumuló varias conversaciones. Solo la
// fecha (no hora): es lo que un vendedor lee de un vistazo, y dos notas del
// mismo día quedan en líneas distintas de todos modos.
function marcarNota(nota: string, hoy: Date): string {
  return `[${hoy.toISOString().slice(0, 10)}] ${nota.trim()}`;
}

export function appendLeadNotes(actual: string | null, nueva: string, hoy = new Date()): string {
  const marcada = marcarNota(nueva, hoy);
  return actual && actual.trim().length > 0 ? `${actual}\n${marcada}` : marcada;
}

// Superficial a propósito: claves nuevas pisan claves viejas del mismo nombre,
// el resto se conserva. Si lo guardado no es un objeto (null, o un valor
// suelto escrito por otra vía), el nuevo va tal cual — no hay nada con qué
// mergear.
export function mergeLeadAiData(
  actual: Prisma.JsonValue | null,
  nuevo: Record<string, unknown>,
): Record<string, unknown> {
  const esObjeto = actual !== null && typeof actual === "object" && !Array.isArray(actual);
  return esObjeto ? { ...(actual as Record<string, unknown>), ...nuevo } : { ...nuevo };
}

export async function qualifyLead(
  organizationId: string,
  contactId: string,
  input: QualifyLeadInput,
) {
  // 404 si no existe, no es de esta organización, o está borrado.
  const contacto = await getContactById(organizationId, contactId);

  const data: UpdateLeadQualificationData = {
    ...(input.score !== undefined ? { leadScore: input.score } : {}),
    ...(input.intent !== undefined ? { leadIntent: input.intent } : {}),
    ...(input.serviceOfInterest !== undefined
      ? { leadServiceOfInterest: input.serviceOfInterest }
      : {}),
    ...(input.urgency !== undefined ? { leadUrgency: input.urgency } : {}),
    ...(input.budgetAmount !== undefined ? { leadBudgetAmount: input.budgetAmount } : {}),
    ...(input.budgetCurrency !== undefined ? { leadBudgetCurrency: input.budgetCurrency } : {}),
    ...(input.location !== undefined ? { leadLocation: input.location } : {}),
    ...(input.notes !== undefined && input.notes.trim().length > 0
      ? { leadNotes: appendLeadNotes(contacto.leadNotes, input.notes) }
      : {}),
    ...(input.aiData !== undefined
      ? {
          leadAiData: mergeLeadAiData(contacto.leadAiData, input.aiData) as Prisma.InputJsonValue,
        }
      : {}),
  };

  if (Object.keys(data).length === 0) {
    // Nada que escribir. No es un error: la tool ya exige al menos un campo,
    // y llegar acá con todo undefined solo pasa desde código.
    return contacto;
  }

  const result = await updateLeadQualification(contactId, organizationId, data);
  if (result.count === 0) {
    // Se borró entre el pre-chequeo y la escritura. Mismo 404.
    throw new AppError("Contacto no encontrado", 404);
  }

  return getContactById(organizationId, contactId);
}
