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
function buildWhere(organizationId: string, filters: ContactFilters): Prisma.ContactWhereInput {
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
    ...(filters.lastName ? { lastName: { contains: filters.lastName, mode: "insensitive" } } : {}),
    ...(filters.email ? { email: { contains: filters.email, mode: "insensitive" } } : {}),
    ...(filters.companyId ? { companyId: filters.companyId } : {}),
    ...(filters.ownerId ? { ownerId: filters.ownerId } : {}),
    ...(filters.lifecycleStage ? { lifecycleStage: filters.lifecycleStage } : {}),
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

export function countContacts(organizationId: string, filters: ContactFilters, db: Db = prisma) {
  return db.contact.count({ where: buildWhere(organizationId, filters) });
}

export function findContactById(id: string, organizationId: string, db: Db = prisma) {
  return db.contact.findFirst({
    where: { id, organizationId, deletedAt: null },
  });
}

// Mismo shape que findContactById, SIN el filtro de deletedAt — M-18 de
// docs/auditoria-2026-08-29.md. Existe para UN solo consumidor: el pre-chequeo
// de erasePersonalData. El borrado de datos personales (D2-4) y el soft delete
// son dos conceptos distintos —existencia del dato contra visibilidad del
// registro, ver erasePersonalDataFromContact más abajo— y el caso más común en
// la práctica es justamente que se pidan los dos: alguien pide que su ficha se
// oculte y DESPUÉS que sus datos se destruyan, o al revés. Con el filtro de
// deletedAt, el segundo pedido respondía 404 y los datos seguían ahí.
//
// list/get/update/delete siguen usando findContactById y tienen que seguir
// tratando un contacto soft-deleteado como "no encontrado": eso no cambia. El
// aislamiento sigue siendo organizationId en el WHERE, igual que arriba.
export function findContactByIdIncludingDeleted(
  id: string,
  organizationId: string,
  db: Db = prisma,
) {
  return db.contact.findFirst({
    where: { id, organizationId },
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

export function softDeleteContact(id: string, organizationId: string, db: Db = prisma) {
  return db.contact.updateMany({
    where: { id, organizationId },
    data: { deletedAt: new Date() },
  });
}

// ---------------------------------------------------------------------------
// PROMOCIÓN DESDE STAGING (ítem 4 de docs/ingestion-architecture.md).
//
// Es la única escritura de `contacts` que no viene de un usuario autenticado, y
// la única que usa SQL crudo. Las dos cosas están relacionadas.
//
// POR QUÉ NO PUEDE SER prisma.contact.upsert(). La nota 9.5 lo anticipó y es
// literal: `upsert` exige que el criterio de conflicto sea un único DECLARADO
// EN EL DSL, y `contacts_org_email_unique` es un índice PARCIAL (vive en la
// migración, invisible para Prisma) y desde M-13 además SOBRE EXPRESIÓN
// (lower(email)). Ninguna de las dos formas es expresable en schema.prisma, así
// que para Prisma ese índice no existe.
//
// Y §4 es tajante en que tiene que ser upsert y no insert: "un insert ciego
// revienta contra esa restricción en cuanto llegue el segundo formulario del
// mismo lead, que es el caso normal, no el borde".
//
// LA VENTAJA QUE 9.5 SEÑALA Y QUE ACÁ SE COBRA: la búsqueda ocurre DENTRO de la
// misma sentencia, así que no hay un `lower()` que alguien pueda olvidar en un
// camino de lectura separado, y no hay ventana entre "busqué" y "escribí" en la
// que otra promoción del mismo email pueda colarse.
//
// LA POLÍTICA DE MERGE DE §4 ESTÁ EN EL `DO UPDATE SET`, NO EN TYPESCRIPT:
//
//   - "Un campo entrante nulo o vacío NUNCA pisa un valor existente en el CRM"
//     y "un campo entrante con valor sí actualiza si el existente es nulo" son
//     LA MISMA REGLA vista desde los dos lados, y las dos las expresa
//     exactamente COALESCE(contacts.campo, excluded.campo): si el CRM tiene
//     algo, gana; si no, entra lo que llegó. El vacío ya se convirtió en
//     ausente en ingestContact.schema.ts, antes de llegar acá.
//   - "Si ambos tienen valor y difieren, se conserva el del CRM" es el mismo
//     COALESCE. El "y se deja registro" no puede vivir en SQL: lo arma el
//     service comparando la fila devuelta contra el candidato (ver abajo).
//   - lifecycleStage NO APARECE en el SET, ni en la lista de columnas del
//     INSERT: la ingesta no lo escribe nunca. Al crear queda el default LEAD de
//     la columna.
//
// `email` TAMPOCO SE ACTUALIZA, y es deliberado: el conflicto se resolvió por
// lower(email), así que el entrante puede diferir solo en mayúsculas. §9.6 dice
// que se guarda lo que la persona escribió, así que la fila del CRM conserva su
// grafía.
// ---------------------------------------------------------------------------

export interface PromoteContactData {
  organizationId: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  jobTitle?: string;
  // Qué se escribe en Contact.source — ver la decisión en promotion.service.ts.
  source: string;
}

export interface PromotedContact {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  jobTitle: string | null;
  source: string | null;
  // true = la fila ya existía y se actualizó; false = se creó.
  actualizado: boolean;
}

// `xmax <> 0` es la forma estándar de distinguir INSERT de UPDATE en un
// ON CONFLICT: en una fila recién insertada xmax es 0, y en una actualizada
// lleva el id de la transacción que la tocó. Es información del sistema, no una
// columna nuestra, y solo se usa para reportar e informar las notas — ninguna
// decisión de datos depende de ella, así que el caso raro (una fila bloqueada
// por una transacción abortada) no puede corromper nada.
interface FilaPromovida {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  job_title: string | null;
  source: string | null;
  actualizado: boolean;
}

function aPromotedContact(fila: FilaPromovida): PromotedContact {
  return {
    id: fila.id,
    firstName: fila.first_name,
    lastName: fila.last_name,
    email: fila.email,
    phone: fila.phone,
    jobTitle: fila.job_title,
    source: fila.source,
    actualizado: fila.actualizado,
  };
}

export async function promoteContact(
  data: PromoteContactData,
  db: Db = prisma,
): Promise<PromotedContact> {
  // SIN EMAIL NO HAY DEDUPLICACIÓN POSIBLE, y §4 lo decide explícitamente:
  // "Contactos sin email no se deduplican automáticamente. Se promueven como
  // nuevos y se marcan para revisión manual."
  //
  // El índice es parcial —WHERE email IS NOT NULL— así que un ON CONFLICT acá
  // no tendría contra qué arbitrar: Postgres rechazaría la sentencia. Es un
  // INSERT liso, a propósito y por construcción. La marca de revisión manual la
  // agrega el service.
  if (data.email === undefined) {
    const filas = await db.$queryRaw<FilaPromovida[]>`
      INSERT INTO contacts (
        organization_id, first_name, last_name, phone, job_title, source,
        created_at, updated_at
      )
      VALUES (
        ${data.organizationId}::uuid,
        ${data.firstName},
        ${data.lastName},
        ${data.phone ?? null},
        ${data.jobTitle ?? null},
        ${data.source},
        now(), now()
      )
      RETURNING
        id, first_name, last_name, email, phone, job_title, source,
        (xmax <> 0) AS actualizado
    `;
    return aPromotedContact(filas[0]);
  }

  // El predicado del ON CONFLICT repite el del índice palabra por palabra
  // porque Postgres infiere el índice a partir de él. Si dejara de coincidir
  // —por ejemplo si alguien cambiara el índice y no esto— Postgres respondería
  // "no unique or exclusion constraint matching the ON CONFLICT specification"
  // en vez de elegir otro índice en silencio. Falla ruidoso, que es lo que se
  // quiere.
  //
  // `deleted_at IS NULL` en el predicado tiene una consecuencia real: un
  // contacto con ese email pero borrado (soft delete) NO entra en conflicto, así
  // que la promoción crea uno nuevo en vez de resucitar el borrado. Es el
  // comportamiento que el índice ya definía para el camino HTTP; la promoción
  // no lo cambia.
  const filas = await db.$queryRaw<FilaPromovida[]>`
    INSERT INTO contacts (
      organization_id, first_name, last_name, email, phone, job_title, source,
      created_at, updated_at
    )
    VALUES (
      ${data.organizationId}::uuid,
      ${data.firstName},
      ${data.lastName},
      ${data.email},
      ${data.phone ?? null},
      ${data.jobTitle ?? null},
      ${data.source},
      now(), now()
    )
    ON CONFLICT (organization_id, lower(email))
      WHERE email IS NOT NULL AND deleted_at IS NULL
    DO UPDATE SET
      first_name = COALESCE(contacts.first_name, excluded.first_name),
      last_name  = COALESCE(contacts.last_name,  excluded.last_name),
      phone      = COALESCE(contacts.phone,      excluded.phone),
      job_title  = COALESCE(contacts.job_title,  excluded.job_title),
      source     = COALESCE(contacts.source,     excluded.source),
      updated_at = now()
    RETURNING
      id, first_name, last_name, email, phone, job_title, source,
      (xmax <> 0) AS actualizado
  `;

  return aPromotedContact(filas[0]);
}

// ---------------------------------------------------------------------------
// BORRADO DE DATOS PERSONALES A PEDIDO — hallazgo D2-4 de
// docs/review-fase2-2026-08-28.md.
//
// NO ES EL SOFT DELETE, y la diferencia es el punto entero:
//
//   softDeleteContact   -> escribe deletedAt. Saca la fila de la vista. Los
//                          datos siguen ahí. REVERSIBLE.
//   erasePersonalData   -> destruye los datos personales. La fila queda.
//                          IRREVERSIBLE.
//
// Son dos conceptos distintos —visibilidad del registro contra existencia del
// dato— y esta función deliberadamente NO toca deletedAt: un contacto puede
// pedir el borrado de sus datos sin que la organización pierda el registro de
// que la oportunidad existió.
//
// POR QUÉ ANONIMIZA Y NO BORRA LA FILA: `Opportunity` y `Activity` referencian
// `contacts` por FK. Borrar la fila rompería historial de negocio de la
// organización, que no es dato de la persona.
//
// POR QUÉ email VA A NULL Y NO A UN MARCADOR, que es la decisión con filo acá:
// existe el único parcial `contacts_org_email_unique` sobre
// (organization_id, lower(email)) WHERE email IS NOT NULL. Con un marcador
// fijo, el SEGUNDO borrado de la misma organización chocaría contra ese índice
// y fallaría. NULL queda fuera del índice parcial por definición, así que la
// operación es repetible. phone y jobTitle van a NULL simplemente porque son
// nullable y no hay nada que preservar.
//
// firstName y lastName SÍ llevan marcador: son NOT NULL en el esquema, así que
// no hay opción de vaciarlos. El marcador es el MISMO para todos a propósito —
// STD-LEG-002 es explícito en que "la seudonimización no es anonimización": un
// valor único por contacto sería un identificador nuevo, no un borrado.
export const MARCADOR_DE_DATO_BORRADO = "[dato borrado]";

// Idempotente: correrla dos veces deja el mismo resultado y no falla. Un
// borrado a pedido que revienta cuando se repite obliga a quien lo opera a
// llevar la cuenta de qué ya pidió, y no gana nada a cambio.
export function erasePersonalDataFromContact(id: string, organizationId: string, db: Db = prisma) {
  return db.contact.updateMany({
    where: { id, organizationId },
    data: {
      firstName: MARCADOR_DE_DATO_BORRADO,
      lastName: MARCADOR_DE_DATO_BORRADO,
      email: null,
      phone: null,
      jobTitle: null,
    },
  });
}
