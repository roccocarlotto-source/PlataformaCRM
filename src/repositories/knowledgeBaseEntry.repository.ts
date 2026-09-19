import type { Prisma } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";

export interface KnowledgeBaseEntryFilters {
  search?: string;
  branchId?: string;
  isActive?: boolean;
}

export type KnowledgeBaseEntrySortBy = "title" | "createdAt";
export type SortOrder = "asc" | "desc";

// organizationId siempre obligatorio y deletedAt: null siempre presente en
// lecturas — el único lugar donde se arma el filtro multi-tenant + soft delete
// para esta entidad, para que findMany/count nunca puedan divergir. Mismo
// patrón que agent.repository.ts.
//
// El search es por TÍTULO y no por contenido, y es una decisión: el título es
// lo que identifica la entrada en el listado, y un ILIKE '%x%' sobre un Text
// de hasta 10.000 caracteres sin índice trigrama es un seq scan que además
// devolvería filas cuyo motivo de coincidencia no se ve en la tabla. Si algún
// día hace falta buscar dentro del contenido, eso es búsqueda de verdad
// (§10 de docs/ai-agent-architecture.md, Knowledge Base / RAG), no un
// `contains` más.
function buildWhere(
  organizationId: string,
  filters: KnowledgeBaseEntryFilters,
): Prisma.KnowledgeBaseEntryWhereInput {
  return {
    organizationId,
    deletedAt: null,
    ...(filters.search ? { title: { contains: filters.search, mode: "insensitive" } } : {}),
    ...(filters.branchId ? { branchId: filters.branchId } : {}),
    ...(filters.isActive !== undefined ? { isActive: filters.isActive } : {}),
  };
}

function buildOrderBy(
  sortBy: KnowledgeBaseEntrySortBy,
  sortOrder: SortOrder,
): Prisma.KnowledgeBaseEntryOrderByWithRelationInput {
  switch (sortBy) {
    case "title":
      return { title: sortOrder };
    case "createdAt":
    default:
      return { createdAt: sortOrder };
  }
}

export function findManyKnowledgeBaseEntries(
  organizationId: string,
  filters: KnowledgeBaseEntryFilters,
  pagination: { skip: number; take: number },
  sort: { sortBy: KnowledgeBaseEntrySortBy; sortOrder: SortOrder },
  db: Db = prisma,
) {
  return db.knowledgeBaseEntry.findMany({
    where: buildWhere(organizationId, filters),
    orderBy: buildOrderBy(sort.sortBy, sort.sortOrder),
    skip: pagination.skip,
    take: pagination.take,
  });
}

export function countKnowledgeBaseEntries(
  organizationId: string,
  filters: KnowledgeBaseEntryFilters,
  db: Db = prisma,
) {
  return db.knowledgeBaseEntry.count({ where: buildWhere(organizationId, filters) });
}

export function findKnowledgeBaseEntryById(id: string, organizationId: string, db: Db = prisma) {
  return db.knowledgeBaseEntry.findFirst({ where: { id, organizationId, deletedAt: null } });
}

// ---------------------------------------------------------------------------
// La lectura que consume el loop del agente (armarSystemPrompt, paso 2 de §4).
// Es la única de este archivo que NO pasa por el CRUD: devuelve solo lo que el
// prompt necesita —título y contenido— y solo de las entradas que el negocio
// dejó activas.
//
// isActive: true Y deletedAt: null son DOS filtros distintos que significan
// cosas distintas: desactivar es "hoy no quiero que el agente diga esto"
// (reversible desde la pantalla), borrar es una baja. Los dos sacan la entrada
// del prompt, y por eso el test unitario de armarSystemPrompt no tiene lógica
// de filtrado: ese trabajo termina acá.
//
// Orden estable por createdAt asc, y nada más sofisticado: el bloque del
// prompt tiene que ser reproducible entre turnos —un orden que cambie solo
// invalida el prompt caching de cualquier proveedor que lo use— y el volumen
// esperado son unas pocas entradas por sucursal. Sin `take`: un tope silencioso
// dejaría fuera entradas que el ADMIN cargó y ve activas en la pantalla, que es
// peor que un prompt largo; el tope real lo pone el de 10.000 caracteres por
// entrada del borde HTTP.
// ---------------------------------------------------------------------------
export function findActiveKnowledgeBaseEntriesByBranch(
  branchId: string,
  organizationId: string,
  db: Db = prisma,
) {
  return db.knowledgeBaseEntry.findMany({
    where: { organizationId, branchId, deletedAt: null, isActive: true },
    orderBy: { createdAt: "asc" },
    select: { title: true, content: true },
  });
}

export interface CreateKnowledgeBaseEntryData {
  organizationId: string;
  branchId: string;
  title: string;
  content: string;
  isActive?: boolean;
}

export function createKnowledgeBaseEntry(data: CreateKnowledgeBaseEntryData, db: Db = prisma) {
  return db.knowledgeBaseEntry.create({ data });
}

// CON branchId, a diferencia de UpdateAgentData: una entrada de KB SÍ cambia
// de sucursal. Ver la nota en knowledgeBaseEntry.service.ts.
export interface UpdateKnowledgeBaseEntryData {
  branchId?: string;
  title?: string;
  content?: string;
  isActive?: boolean;
}

// updateMany en vez de update: el WHERE efectivo tiene que exigir
// organizationId además de id (M4) — la escritura en sí es la garantía de
// aislamiento, no solo el pre-check del service. count === 0 se traduce a 404.
export function updateKnowledgeBaseEntry(
  id: string,
  organizationId: string,
  data: UpdateKnowledgeBaseEntryData,
  db: Db = prisma,
) {
  return db.knowledgeBaseEntry.updateMany({
    where: { id, organizationId, deletedAt: null },
    data,
  });
}

export function softDeleteKnowledgeBaseEntry(id: string, organizationId: string, db: Db = prisma) {
  return db.knowledgeBaseEntry.updateMany({
    where: { id, organizationId, deletedAt: null },
    data: { deletedAt: new Date() },
  });
}
