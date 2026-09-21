import type {
  OpportunityFinancingType,
  OpportunityLeadSource,
  OpportunityStatus,
  Prisma,
} from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";

export interface OpportunityFilters {
  search?: string;
  companyId?: string;
  contactId?: string;
  ownerId?: string;
  pipelineId?: string;
  stageId?: string;
  status?: OpportunityStatus;
  currency?: string;
  minAmount?: number;
  maxAmount?: number;
}

export type OpportunitySortBy = "createdAt" | "updatedAt" | "amount" | "title";
export type SortOrder = "asc" | "desc";

function buildWhere(
  organizationId: string,
  filters: OpportunityFilters,
): Prisma.OpportunityWhereInput {
  return {
    organizationId,
    deletedAt: null,
    ...(filters.search ? { title: { contains: filters.search, mode: "insensitive" } } : {}),
    ...(filters.companyId ? { companyId: filters.companyId } : {}),
    ...(filters.contactId ? { contactId: filters.contactId } : {}),
    ...(filters.ownerId ? { ownerId: filters.ownerId } : {}),
    ...(filters.pipelineId ? { pipelineId: filters.pipelineId } : {}),
    ...(filters.stageId ? { stageId: filters.stageId } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.currency ? { currency: filters.currency } : {}),
    ...(filters.minAmount !== undefined || filters.maxAmount !== undefined
      ? {
          amount: {
            ...(filters.minAmount !== undefined ? { gte: filters.minAmount } : {}),
            ...(filters.maxAmount !== undefined ? { lte: filters.maxAmount } : {}),
          },
        }
      : {}),
  };
}

function buildOrderBy(
  sortBy: OpportunitySortBy,
  sortOrder: SortOrder,
): Prisma.OpportunityOrderByWithRelationInput {
  switch (sortBy) {
    case "updatedAt":
      return { updatedAt: sortOrder };
    case "amount":
      return { amount: sortOrder };
    case "title":
      return { title: sortOrder };
    case "createdAt":
    default:
      return { createdAt: sortOrder };
  }
}

export function findManyOpportunities(
  organizationId: string,
  filters: OpportunityFilters,
  pagination: { skip: number; take: number },
  sort: { sortBy: OpportunitySortBy; sortOrder: SortOrder },
  db: Db = prisma,
) {
  return db.opportunity.findMany({
    where: buildWhere(organizationId, filters),
    orderBy: buildOrderBy(sort.sortBy, sort.sortOrder),
    skip: pagination.skip,
    take: pagination.take,
  });
}

export function countOpportunities(
  organizationId: string,
  filters: OpportunityFilters,
  db: Db = prisma,
) {
  return db.opportunity.count({ where: buildWhere(organizationId, filters) });
}

export function findOpportunityById(id: string, organizationId: string, db: Db = prisma) {
  return db.opportunity.findFirst({
    where: { id, organizationId, deletedAt: null },
  });
}

export interface CreateOpportunityData {
  organizationId: string;
  companyId: string | null;
  contactId: string | null;
  ownerId: string;
  pipelineId: string;
  stageId: string;
  title: string;
  amount?: number;
  currency?: string;
  expectedCloseDate?: Date;
  actualCloseDate?: Date;
  status?: OpportunityStatus;
  lostReason?: string;
  // Módulo de stock de vehículos (Fase 2c). Los tres nullables en el schema;
  // el service ya validó la unidad y tomó el lock cuando vehicleId viene.
  vehicleId?: string;
  financingType?: OpportunityFinancingType;
  leadSource?: OpportunityLeadSource;
  // Detalle de financiación (§42): datos descriptivos, sin validación previa.
  financingLender?: string;
  financingDownPayment?: number;
  financingInstallmentCount?: number;
  financingInstallmentAmount?: number;
}

export function createOpportunity(data: CreateOpportunityData, db: Db = prisma) {
  return db.opportunity.create({ data });
}

export interface UpdateOpportunityData {
  companyId?: string;
  contactId?: string;
  ownerId?: string;
  pipelineId?: string;
  stageId?: string;
  title?: string;
  amount?: number;
  currency?: string;
  expectedCloseDate?: Date | null;
  actualCloseDate?: Date | null;
  status?: OpportunityStatus;
  lostReason?: string | null;
  // null = desvincular / limpiar; undefined = no tocar la columna.
  vehicleId?: string | null;
  financingType?: OpportunityFinancingType | null;
  leadSource?: OpportunityLeadSource | null;
  financingLender?: string | null;
  financingDownPayment?: number | null;
  financingInstallmentCount?: number | null;
  financingInstallmentAmount?: number | null;
}

// updateMany en vez de update: el WHERE efectivo tiene que exigir
// organizationId además de id (M4) — la escritura en sí es la garantía de
// aislamiento, no solo el pre-check del service. count === 0 se traduce a
// 404 en el service.
export function updateOpportunity(
  id: string,
  organizationId: string,
  data: UpdateOpportunityData,
  db: Db = prisma,
) {
  return db.opportunity.updateMany({ where: { id, organizationId }, data });
}

export function softDeleteOpportunity(id: string, organizationId: string, db: Db = prisma) {
  return db.opportunity.updateMany({
    where: { id, organizationId },
    data: { deletedAt: new Date() },
  });
}

// Lockea la fila de la Opportunity con SELECT ... FOR UPDATE y devuelve su
// status TAL COMO ESTÁ bajo el lock. Mismo molde que lockStageForUpdate.
//
// Existe por el trigger opportunity.won (docs/automations-architecture.md
// §7): la detección "no era WON y ahora sí" se decide sobre el status leído
// ANTES de la transacción, y dos PATCH concurrentes a WON sobre la misma
// oportunidad podrían leer OPEN los dos y emitir dos eventos — dos
// seguimientos. Releer bajo el lock hace que el segundo vea WON y no emita.
//
// Sin default para `db`: fuera de una transacción el lock se libera al
// instante. Cero filas = no se bloqueó nada (B-17): la oportunidad
// desapareció entre el pre-check y acá, y el UPDATE de después daría count 0.
export async function lockOpportunityForUpdate(
  id: string,
  organizationId: string,
  db: Db,
): Promise<{ status: OpportunityStatus } | null> {
  const filas = await db.$queryRaw<
    { status: OpportunityStatus }[]
  >`SELECT status FROM opportunities WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid AND deleted_at IS NULL FOR UPDATE`;
  return filas[0] ?? null;
}

// ---------------------------------------------------------------------------
// Agregados del resumen del Dashboard (§30 de docs/frontend-cambios-pendientes
// .md). Reciben SOLO el recorte que cambia entre consultas (status, moneda y
// una ventana sobre createdAt o actualCloseDate): organizationId y
// deletedAt: null los pone siempre esta capa, igual que buildWhere, así que
// ninguna llamada puede olvidarse del aislamiento ni contar borradas.
// ---------------------------------------------------------------------------
export type OpportunityAggregateWhere = Pick<
  Prisma.OpportunityWhereInput,
  "status" | "currency" | "createdAt" | "actualCloseDate"
>;

export function countOpportunitiesWhere(
  organizationId: string,
  where: OpportunityAggregateWhere,
  db: Db = prisma,
) {
  return db.opportunity.count({ where: { organizationId, deletedAt: null, ...where } });
}

// SUM(amount). `null` cuando no hay ninguna fila que sumar (así lo devuelve
// Prisma); el service lo traduce a "0".
export async function sumOpportunityAmount(
  organizationId: string,
  where: OpportunityAggregateWhere,
  db: Db = prisma,
): Promise<Prisma.Decimal | null> {
  const result = await db.opportunity.aggregate({
    where: { organizationId, deletedAt: null, ...where },
    _sum: { amount: true },
  });
  return result._sum.amount;
}

// Oportunidades activas de un stage — el conteo sobre el que decide el RESTRICT
// de deleteStage (ALTO-8). organizationId en el WHERE por el mismo motivo que
// en countActiveStagesByPipeline: decide si una escritura procede.
export function countActiveOpportunitiesByStage(
  stageId: string,
  organizationId: string,
  db: Db = prisma,
) {
  return db.opportunity.count({ where: { stageId, organizationId, deletedAt: null } });
}

// ---------------------------------------------------------------------------
// Oportunidades estancadas (ítem 76 de docs/frontend-cambios-pendientes.md):
// el barrido diario del trigger opportunity.stale y la marca anti-redraft.
// ---------------------------------------------------------------------------

// Las oportunidades de UNA organización que califican para un borrador de
// seguimiento: abiertas, no borradas, sin movimiento desde `limite`, y —la
// parte que no puede fallar— sin un borrador posterior a su último movimiento.
// `lastStaleFollowUpDraftedAt < updatedAt` compara dos columnas de la misma
// fila (field reference de Prisma): la oportunidad tuvo un cambio real DESPUÉS
// del último borrador y volvió a quedar quieta. Una que no se movió desde su
// último borrador no vuelve a aparecer acá, por más días que pasen.
//
// Solo id y ownerId: es exactamente el payload del evento, y el handler relee
// la fila entera de todos modos.
export function findStaleOpportunities(organizationId: string, limite: Date, db: Db = prisma) {
  return db.opportunity.findMany({
    where: {
      organizationId,
      deletedAt: null,
      status: "OPEN",
      updatedAt: { lt: limite },
      OR: [
        { lastStaleFollowUpDraftedAt: null },
        { lastStaleFollowUpDraftedAt: { lt: db.opportunity.fields.updatedAt } },
      ],
    },
    select: { id: true, ownerId: true },
    // Orden estable: el mismo barrido sobre los mismos datos emite los eventos
    // en el mismo orden, que es lo que un log legible necesita.
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
  });
}

// Lo que el borrador de seguimiento le cuenta al modelo sobre la oportunidad:
// la fila más el nombre de su etapa. Mismo filtro que findOpportunityById.
export function findOpportunityForFollowUpDraft(
  id: string,
  organizationId: string,
  db: Db = prisma,
) {
  return db.opportunity.findFirst({
    where: { id, organizationId, deletedAt: null },
    include: { stage: { select: { name: true } } },
  });
}

// La marca anti-redraft. SQL CRUDO Y NO db.opportunity.update, a propósito:
// updatedAt es @updatedAt, y Prisma lo pisaría con "ahora" en cualquier
// update de la fila. Eso rompería justamente la comparación que esta columna
// existe para sostener: la marca quedaría un instante ANTES del updatedAt que
// ella misma causó, la oportunidad "habría tenido movimiento después del
// último borrador" y el worker redactaría otro al día siguiente — y así para
// siempre. Un UPDATE que no toca updated_at deja el último movimiento real
// donde estaba.
//
// La fecha viaja como ISO y se convierte a UTC en SQL: la columna es
// TIMESTAMP(3) sin zona, y Prisma guarda todo DateTime en UTC. Así el valor
// no depende de la zona horaria de la sesión de Postgres.
export function markStaleFollowUpDrafted(
  id: string,
  organizationId: string,
  cuando: Date,
  db: Db = prisma,
) {
  return db.$executeRaw`UPDATE opportunities SET last_stale_follow_up_drafted_at = (${cuando.toISOString()}::timestamptz AT TIME ZONE 'UTC') WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid`;
}
