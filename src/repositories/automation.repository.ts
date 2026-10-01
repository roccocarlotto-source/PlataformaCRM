import { Prisma, type AutomationExecutionStatus } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";

// ---------------------------------------------------------------------------
// Motor de automatizaciones — acceso a datos de Automation (la regla) y de
// AutomationExecution (la marca de ejecución por evento). Calca
// agent.repository.ts: organizationId siempre obligatorio, deletedAt: null en
// toda lectura de reglas, updateMany con organizationId en el WHERE (M4).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Automation — CRUD
// ---------------------------------------------------------------------------

export interface AutomationFilters {
  search?: string;
  triggerType?: string;
  isActive?: boolean;
}

export type AutomationSortBy = "name" | "createdAt";
export type SortOrder = "asc" | "desc";

// El único lugar donde se arma el filtro multi-tenant + soft delete para esta
// entidad, para que findMany/count nunca puedan divergir.
function buildWhere(
  organizationId: string,
  filters: AutomationFilters,
): Prisma.AutomationWhereInput {
  return {
    organizationId,
    deletedAt: null,
    ...(filters.search ? { name: { contains: filters.search, mode: "insensitive" } } : {}),
    ...(filters.triggerType ? { triggerType: filters.triggerType } : {}),
    ...(filters.isActive !== undefined ? { isActive: filters.isActive } : {}),
  };
}

function buildOrderBy(
  sortBy: AutomationSortBy,
  sortOrder: SortOrder,
): Prisma.AutomationOrderByWithRelationInput {
  switch (sortBy) {
    case "name":
      return { name: sortOrder };
    case "createdAt":
    default:
      return { createdAt: sortOrder };
  }
}

export function findManyAutomations(
  organizationId: string,
  filters: AutomationFilters,
  pagination: { skip: number; take: number },
  sort: { sortBy: AutomationSortBy; sortOrder: SortOrder },
  db: Db = prisma,
) {
  return db.automation.findMany({
    where: buildWhere(organizationId, filters),
    orderBy: buildOrderBy(sort.sortBy, sort.sortOrder),
    skip: pagination.skip,
    take: pagination.take,
  });
}

export function countAutomations(
  organizationId: string,
  filters: AutomationFilters,
  db: Db = prisma,
) {
  return db.automation.count({ where: buildWhere(organizationId, filters) });
}

export function findAutomationById(id: string, organizationId: string, db: Db = prisma) {
  return db.automation.findFirst({ where: { id, organizationId, deletedAt: null } });
}

export interface CreateAutomationData {
  organizationId: string;
  name: string;
  triggerType: string;
  actionType: string;
  // Ya validado por el service contra el schema de la acción.
  actionConfig: Prisma.InputJsonValue;
  // Ya validado por el service contra el schema del trigger (ítem 76).
  triggerConfig: Prisma.InputJsonValue;
  isActive?: boolean;
}

export function createAutomation(data: CreateAutomationData, db: Db = prisma) {
  return db.automation.create({ data });
}

export interface UpdateAutomationData {
  name?: string;
  triggerType?: string;
  actionType?: string;
  // Se reemplaza entero, nunca se mergea: actionConfig es NOT NULL sin default
  // en el schema, así que acá no hay DbNull que contemplar (como
  // Agent.guardrails).
  actionConfig?: Prisma.InputJsonValue;
  // Mismo criterio que actionConfig: se reemplaza entero. NOT NULL con default
  // "{}", así que tampoco hay DbNull.
  triggerConfig?: Prisma.InputJsonValue;
  isActive?: boolean;
}

// updateMany en vez de update: el WHERE efectivo tiene que exigir
// organizationId además de id (M4) — la escritura en sí es la garantía de
// aislamiento, no solo el pre-check del service. count === 0 se traduce a 404.
export function updateAutomation(
  id: string,
  organizationId: string,
  data: UpdateAutomationData,
  db: Db = prisma,
) {
  return db.automation.updateMany({ where: { id, organizationId, deletedAt: null }, data });
}

export function softDeleteAutomation(id: string, organizationId: string, db: Db = prisma) {
  return db.automation.updateMany({
    where: { id, organizationId, deletedAt: null },
    data: { deletedAt: new Date() },
  });
}

// ---------------------------------------------------------------------------
// Despacho — lo que el dispatcher necesita y el CRUD no
// ---------------------------------------------------------------------------

// Exactamente la consulta que sirve automations_organization_id_trigger_type_
// is_active_idx. Ordenadas por createdAt para que el orden de ejecución sea
// determinístico y legible (la regla más vieja primero), no el que devuelva
// el heap.
export function findActiveAutomationsByTrigger(
  organizationId: string,
  triggerType: string,
  db: Db = prisma,
) {
  return db.automation.findMany({
    where: { organizationId, triggerType, isActive: true, deletedAt: null },
    orderBy: { createdAt: "asc" },
  });
}

// Cuántas reglas activas (no borradas) tiene la organización para un trigger,
// sin contar `exceptoId` — la regla que se está editando. Para los triggers
// de regla única (TRIGGERS_DE_REGLA_UNICA, ítem 76).
export function countOtherActiveAutomationsByTrigger(
  organizationId: string,
  triggerType: string,
  exceptoId: string | undefined,
  db: Db = prisma,
) {
  return db.automation.count({
    where: {
      organizationId,
      triggerType,
      isActive: true,
      deletedAt: null,
      ...(exceptoId ? { id: { not: exceptoId } } : {}),
    },
  });
}

// Las reglas activas de un trigger en TODAS las organizaciones — o en una
// sola, si se pasa. La consulta del worker de oportunidades estancadas (ítem
// 76), el único productor que no nace de un cambio dentro de una organización
// sino de un barrido. El alcance por organización es SOLO PARA TESTS: la suite
// corre archivos en paralelo contra una base compartida, y un barrido sin
// alcance emitiría eventos en las organizaciones de otros tests (mismo motivo
// que en renovarCanalesVencidos).
export function findActiveAutomationsByTriggerForSweep(
  triggerType: string,
  scope: { organizationId?: string } = {},
  db: Db = prisma,
) {
  return db.automation.findMany({
    where: {
      triggerType,
      isActive: true,
      deletedAt: null,
      ...(scope.organizationId ? { organizationId: scope.organizationId } : {}),
    },
    orderBy: [{ organizationId: "asc" }, { createdAt: "asc" }],
  });
}

// Las marcas que ya existen para (estas reglas, este evento), en UNA consulta
// — servida por el UNIQUE (automation_id, outbox_event_id). El dispatcher las
// mira para saber cuáles saltar en un reintento.
export function findExecutionsForEvent(
  organizationId: string,
  outboxEventId: string,
  automationIds: string[],
  db: Db = prisma,
) {
  return db.automationExecution.findMany({
    where: { organizationId, outboxEventId, automationId: { in: automationIds } },
    select: { automationId: true, status: true },
  });
}

export interface UpsertAutomationExecutionData {
  organizationId: string;
  automationId: string;
  outboxEventId: string;
  status: AutomationExecutionStatus;
  error: string | null;
}

// Crea la marca la primera vez; en un reintento después de un FAILED la pisa
// (FAILED -> SUCCESS, o FAILED -> FAILED con el error nuevo y executedAt
// actualizado). Un SUCCESS nunca vuelve a FAILED por construcción: el
// dispatcher salta las reglas que ya tienen SUCCESS y no llega a escribir.
//
// SIN el upsert de Prisma, y es el arreglo del hallazgo de H-01
// (docs-privados/auditoria-2026-09-24-punta-a-punta.md, local): su WHERE solo
// admite la clave única (automation_id, outbox_event_id), sin organizationId,
// así que el UPDATE pisaba la ejecución de OTRA organización si alguien le
// pasaba su regla y su evento. Ahora la fila se busca con organizationId en el
// WHERE y se actualiza por su id; si no hay, se crea (y ahí la FK compuesta
// (organization_id, automation_id) rechaza una regla ajena). Si la clave ya
// existe en otra organización, el INSERT choca con el único y falla: nunca
// se toca la fila ajena.
//
// La carrera de dos despachos que crean la misma marca a la vez (el segundo
// choca con el único, P2002) se resuelve releyendo y actualizando, como hacía
// el upsert.
export async function upsertAutomationExecution(
  data: UpsertAutomationExecutionData,
  db: Db = prisma,
) {
  const actualizar = (id: string) =>
    db.automationExecution.update({
      where: { id },
      data: { status: data.status, error: data.error, executedAt: new Date() },
    });
  const buscar = () =>
    db.automationExecution.findFirst({
      where: {
        organizationId: data.organizationId,
        automationId: data.automationId,
        outboxEventId: data.outboxEventId,
      },
      select: { id: true },
    });

  const existente = await buscar();
  if (existente) {
    return actualizar(existente.id);
  }
  try {
    return await db.automationExecution.create({ data });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const ganadora = await buscar();
      if (ganadora) {
        return actualizar(ganadora.id);
      }
    }
    throw err;
  }
}
