import type { Prisma } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";

// Estado derivado, no una columna: ApiKey no tiene un enum de status, tiene
// revokedAt nullable. El filtro se traduce acá y en ningún otro lado.
export type ApiKeyStatus = "ACTIVE" | "REVOKED";

export interface ApiKeyFilters {
  sourceId?: string;
  status?: ApiKeyStatus;
}

export type ApiKeySortBy = "createdAt" | "lastUsedAt";
export type SortOrder = "asc" | "desc";

// LA PROYECCIÓN QUE IMPIDE QUE keyHash SALGA POR LA API.
//
// Todas las lecturas de este repositorio la usan, sin excepción, y ninguna
// función devuelve la fila cruda. No es una preferencia de estilo: un
// `findMany` sin `select` sobre esta tabla devuelve keyHash, y de ahí a un
// res.json() hay un solo paso que nadie revisa. Con la lista de columnas en un
// único lugar, exponer material criptográfico requiere editar esta constante a
// propósito.
//
// DIVERGENCIA DELIBERADA con los 8 módulos existentes, que devuelven la fila
// cruda de Prisma (hallazgo BAJO de la auditoría). Lo nuevo no hereda el
// defecto de lo viejo — mismo criterio con el que los índices de estas tablas
// nacieron bien. No armonizar hacia atrás.
//
// El ítem 4 va a necesitar UNA función que sí lea keyHash (buscar por hash
// para resolver la clave presentada). Esa función debe seleccionar keyHash
// explícitamente y no devolverlo nunca al caller HTTP.
const API_KEY_PUBLIC_SELECT = {
  id: true,
  organizationId: true,
  sourceId: true,
  keyPrefix: true,
  lastUsedAt: true,
  revokedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ApiKeySelect;

export type PublicApiKey = Prisma.ApiKeyGetPayload<{
  select: typeof API_KEY_PUBLIC_SELECT;
}>;

// ApiKey no tiene deletedAt (revokedAt ya es su estado terminal — ver la
// decisión de soft delete del ítem 2), así que el filtro base es solo
// organizationId. Una clave revocada SIGUE listándose por default: es
// información de auditoría que el ADMIN quiere ver.
function buildWhere(organizationId: string, filters: ApiKeyFilters): Prisma.ApiKeyWhereInput {
  return {
    organizationId,
    ...(filters.sourceId ? { sourceId: filters.sourceId } : {}),
    ...(filters.status === "ACTIVE" ? { revokedAt: null } : {}),
    ...(filters.status === "REVOKED" ? { revokedAt: { not: null } } : {}),
  };
}

function buildOrderBy(
  sortBy: ApiKeySortBy,
  sortOrder: SortOrder,
): Prisma.ApiKeyOrderByWithRelationInput {
  switch (sortBy) {
    case "lastUsedAt":
      return { lastUsedAt: sortOrder };
    case "createdAt":
    default:
      return { createdAt: sortOrder };
  }
}

export function findManyApiKeys(
  organizationId: string,
  filters: ApiKeyFilters,
  pagination: { skip: number; take: number },
  sort: { sortBy: ApiKeySortBy; sortOrder: SortOrder },
  db: Db = prisma,
) {
  return db.apiKey.findMany({
    where: buildWhere(organizationId, filters),
    select: API_KEY_PUBLIC_SELECT,
    orderBy: buildOrderBy(sort.sortBy, sort.sortOrder),
    skip: pagination.skip,
    take: pagination.take,
  });
}

export function countApiKeys(organizationId: string, filters: ApiKeyFilters, db: Db = prisma) {
  return db.apiKey.count({ where: buildWhere(organizationId, filters) });
}

export function findApiKeyById(id: string, organizationId: string, db: Db = prisma) {
  return db.apiKey.findFirst({
    where: { id, organizationId },
    select: API_KEY_PUBLIC_SELECT,
  });
}

export interface CreateApiKeyData {
  organizationId: string;
  sourceId: string;
  keyHash: string;
  keyPrefix: string;
}

// Devuelve la proyección pública: la clave en claro NO sale de acá, la agrega
// el service al objeto de respuesta y muere ahí. Este repositorio nunca ve la
// clave, solo su hash.
export function createApiKey(data: CreateApiKeyData, db: Db = prisma) {
  return db.apiKey.create({ data, select: API_KEY_PUBLIC_SELECT });
}

// Compare-and-swap, calcado de revokeInvitationConditional: la transición solo
// se aplica si la clave sigue sin revocar en el momento exacto de la
// escritura. Postgres serializa los UPDATE concurrentes sobre la misma fila,
// así que de dos revocaciones simultáneas a lo sumo una afecta la fila.
// `count === 0` significa que otra ya ganó la carrera (o que la fila no es de
// esta organización); el caller SIEMPRE debe verificar count, nunca asumir
// éxito por la ausencia de excepción.
//
// No usar `update`: no admite una condición adicional en el where más allá de
// la clave única, por eso hace falta updateMany pese a afectar una sola fila.
// organizationId en el WHERE por el mismo motivo que en el resto de las
// entidades (M4): la escritura misma es la garantía de aislamiento, no el
// pre-check del service.
export function revokeApiKeyConditional(id: string, organizationId: string, db: Db = prisma) {
  return db.apiKey.updateMany({
    where: { id, organizationId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

// Revoca de una todas las claves activas de una Source. La usa deleteSource
// (source.service.ts) dentro de una transacción: retirar una integración tiene
// que matar sus credenciales, no dejarlas vivas esperando a que el ítem 4 se
// acuerde de chequear source.deletedAt. La invariante vive en los datos, no en
// la memoria de un middleware futuro.
//
// organizationId en el WHERE por el mismo motivo de siempre, aunque sourceId
// ya la determine vía la FK compuesta: la escritura misma es la garantía.
export function revokeApiKeysBySource(sourceId: string, organizationId: string, db: Db = prisma) {
  return db.apiKey.updateMany({
    where: { sourceId, organizationId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

// ---------------------------------------------------------------------------
// Ítem 4 — el camino de autenticación de ingesta. Estas dos funciones son las
// únicas del repositorio que no sirven a la administración de claves.
// ---------------------------------------------------------------------------

// La proyección de autenticación. NO INCLUYE keyHash, a propósito y aunque la
// búsqueda sea POR keyHash: quien llama ya lo tiene (lo acaba de calcular), así
// que traerlo de vuelta solo agregaría una copia del material en memoria y un
// campo más que podría filtrarse a una respuesta. La nota que dejó el ítem 3
// pedía "seleccionar keyHash explícitamente"; resultó innecesario.
//
// Trae de la Source lo que authenticateApiKey necesita decidir —isActive y
// deletedAt— en el mismo round-trip, vía la relación por FK compuesta. Sin
// campos de negocio: el nombre de la fuente no interviene en ninguna decisión
// de autenticación y no tiene por qué estar disponible para colarse a un log.
const API_KEY_AUTH_SELECT = {
  id: true,
  organizationId: true,
  sourceId: true,
  revokedAt: true,
  source: { select: { isActive: true, deletedAt: true } },
} satisfies Prisma.ApiKeySelect;

export type ApiKeyForAuth = Prisma.ApiKeyGetPayload<{
  select: typeof API_KEY_AUTH_SELECT;
}>;

// Búsqueda por igualdad sobre key_hash, que es UNIQUE global — y tiene que ser
// global porque en este punto todavía no se conoce la organización: es
// justamente lo que esta consulta resuelve. Ver el @unique de ApiKey.keyHash en
// schema.prisma.
//
// Sin comparación en tiempo constante y sin que haga falta: el índice resuelve
// por igualdad de un hash de un secreto de 256 bits. Una diferencia de timing
// no le dice a nadie nada aprovechable sobre una preimagen que no puede
// construir. La defensa está en la entropía de la clave (ver utils/apiKey.ts),
// no acá.
export function findApiKeyByHash(keyHash: string, db: Db = prisma) {
  return db.apiKey.findUnique({
    where: { keyHash },
    select: API_KEY_AUTH_SELECT,
  });
}

// Registra el uso de la clave. `noUsadaDesde` es el corte de granularidad: la
// fila se escribe SOLO si lastUsedAt es null o anterior a ese instante, así que
// una clave que recibe mil requests por minuto produce una escritura por
// ventana, no mil sobre la misma fila.
//
// Es un updateMany y no un update por dos razones que se suman: `update` no
// admite condiciones extra en el where más allá de la clave única (mismo motivo
// que revokeApiKeyConditional), y organizationId va en el WHERE por el
// invariante de M4 — la escritura misma es la garantía de aislamiento, nunca un
// pre-chequeo. revokedAt: null además evita revivir la actividad de una clave
// que fue revocada entre el SELECT de autenticación y esta escritura.
//
// El caller SIEMPRE debe tolerar count === 0: significa "no hacía falta
// escribir" (caso normal), no un error.
export function touchApiKeyLastUsed(
  id: string,
  organizationId: string,
  noUsadaDesde: Date,
  db: Db = prisma,
) {
  return db.apiKey.updateMany({
    where: {
      id,
      organizationId,
      revokedAt: null,
      OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: noUsadaDesde } }],
    },
    data: { lastUsedAt: new Date() },
  });
}
