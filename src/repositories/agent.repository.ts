import type { ConversationChannel, Prisma } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";

export interface AgentFilters {
  search?: string;
  branchId?: string;
  isActive?: boolean;
}

export type AgentSortBy = "name" | "createdAt";
export type SortOrder = "asc" | "desc";

// organizationId siempre obligatorio y deletedAt: null siempre presente en
// lecturas — el único lugar donde se arma el filtro multi-tenant + soft delete
// para esta entidad, para que findMany/count nunca puedan divergir. Mismo
// patrón que resource.repository.ts.
function buildWhere(organizationId: string, filters: AgentFilters): Prisma.AgentWhereInput {
  return {
    organizationId,
    deletedAt: null,
    ...(filters.search ? { name: { contains: filters.search, mode: "insensitive" } } : {}),
    ...(filters.branchId ? { branchId: filters.branchId } : {}),
    ...(filters.isActive !== undefined ? { isActive: filters.isActive } : {}),
  };
}

function buildOrderBy(
  sortBy: AgentSortBy,
  sortOrder: SortOrder,
): Prisma.AgentOrderByWithRelationInput {
  switch (sortBy) {
    case "name":
      return { name: sortOrder };
    case "createdAt":
    default:
      return { createdAt: sortOrder };
  }
}

export function findManyAgents(
  organizationId: string,
  filters: AgentFilters,
  pagination: { skip: number; take: number },
  sort: { sortBy: AgentSortBy; sortOrder: SortOrder },
  db: Db = prisma,
) {
  return db.agent.findMany({
    where: buildWhere(organizationId, filters),
    orderBy: buildOrderBy(sort.sortBy, sort.sortOrder),
    skip: pagination.skip,
    take: pagination.take,
  });
}

export function countAgents(organizationId: string, filters: AgentFilters, db: Db = prisma) {
  return db.agent.count({ where: buildWhere(organizationId, filters) });
}

export function findAgentById(id: string, organizationId: string, db: Db = prisma) {
  return db.agent.findFirst({ where: { id, organizationId, deletedAt: null } });
}

export interface CreateAgentData {
  organizationId: string;
  branchId: string;
  name: string;
  goal?: string | null;
  instructions: string;
  tone?: string | null;
  modelProvider: string;
  modelName: string;
  enabledTools: string[];
  channels: ConversationChannel[];
  guardrails: Prisma.InputJsonValue;
  isActive?: boolean;
}

export function createAgent(data: CreateAgentData, db: Db = prisma) {
  return db.agent.create({ data });
}

// Sin branchId: un Agent NO cambia de sucursal. Ver la nota en
// agent.service.ts sobre por qué es inmutable.
export interface UpdateAgentData {
  name?: string;
  goal?: string | null;
  instructions?: string;
  tone?: string | null;
  modelProvider?: string;
  modelName?: string;
  enabledTools?: string[];
  channels?: ConversationChannel[];
  // Se reemplaza entero, nunca se mergea: guardrails es NOT NULL sin default
  // en el schema, así que acá no hay DbNull que contemplar.
  guardrails?: Prisma.InputJsonValue;
  isActive?: boolean;
}

// updateMany en vez de update: el WHERE efectivo tiene que exigir
// organizationId además de id (M4) — la escritura en sí es la garantía de
// aislamiento, no solo el pre-check del service. count === 0 se traduce a 404.
export function updateAgent(
  id: string,
  organizationId: string,
  data: UpdateAgentData,
  db: Db = prisma,
) {
  return db.agent.updateMany({ where: { id, organizationId, deletedAt: null }, data });
}

export function softDeleteAgent(id: string, organizationId: string, db: Db = prisma) {
  return db.agent.updateMany({
    where: { id, organizationId, deletedAt: null },
    data: { deletedAt: new Date() },
  });
}
