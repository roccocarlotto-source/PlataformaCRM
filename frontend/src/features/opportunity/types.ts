// Reconstruido desde el contrato real del backend
// (src/controllers/opportunity.controller.ts, src/services/opportunity.service.ts,
// src/repositories/opportunity.repository.ts, prisma/schema.prisma modelo
// Opportunity). No se agrega ningún campo que el backend no devuelva o no acepte.

export type OpportunityStatus = "OPEN" | "WON" | "LOST";

// ⚠️ amount es Decimal(14,2) en Prisma — mismo caso verificado empíricamente
// que Stage.probability (M4): Prisma.Decimal.toJSON() devuelve STRING. La
// API siempre devuelve amount como string en lectura, aunque la escritura
// (create/update) acepte un number real (z.coerce.number() del backend).
// Nunca tipar esto como number en lectura ni usar .toFixed() directo sobre
// el valor crudo.
export interface Opportunity {
  id: string;
  organizationId: string;
  companyId: string | null;
  contactId: string | null;
  ownerId: string;
  pipelineId: string;
  stageId: string;
  title: string;
  amount: string;
  currency: string;
  expectedCloseDate: string | null;
  actualCloseDate: string | null;
  status: OpportunityStatus;
  lostReason: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface OpportunityListPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface OpportunityListResponse {
  data: Opportunity[];
  pagination: OpportunityListPagination;
}

export type OpportunitySortBy = "createdAt" | "updatedAt" | "amount" | "title";
export type SortOrder = "asc" | "desc";

// Sin filtro de rango de fechas sobre expectedCloseDate (a diferencia de
// Activity, que sí tiene dueDateFrom/dueDateTo) — el backend no lo expone
// (opportunity.controller.ts listQuerySchema), no se inventa acá.
export interface OpportunityListQuery {
  page?: number;
  pageSize?: number;
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
  sortBy?: OpportunitySortBy;
  sortOrder?: SortOrder;
}

// companyId/contactId: al menos uno de los dos es obligatorio en create
// (refine de Zod + CHECK opportunities_company_or_contact_check) — no se
// expresa ese "al menos uno" en el sistema de tipos; se valida en el
// submit de OpportunityFormPage, mostrando el mensaje real del backend si
// falla igual.
//
// expectedCloseDate/actualCloseDate/lostReason: opcionales pero NO
// nullable en create (solo se omiten, nunca se envía null) — a diferencia
// de update. Los tres viajan como string ("YYYY-MM-DD" para las fechas):
// la conversión a Date queda del lado del backend (z.coerce.date()).
export interface CreateOpportunityInput {
  title: string;
  amount?: number;
  currency?: string;
  status?: OpportunityStatus;
  companyId?: string;
  contactId?: string;
  pipelineId: string;
  stageId: string;
  ownerId?: string;
  expectedCloseDate?: string;
  actualCloseDate?: string;
  lostReason?: string;
}

// A diferencia de create: expectedCloseDate/actualCloseDate/lostReason
// admiten `null` explícito acá (limpiar el campo — pensado para reabrir una
// oportunidad WON/LOST de vuelta a OPEN sin arrastrar datos de un cierre
// anterior). companyId/contactId/ownerId/pipelineId/stageId permanecen
// `string` (nunca `string | null`): el service los trata con chequeo
// truthy (`if (input.companyId)` en opportunity.service.ts) — no se pueden
// limpiar a null vía PATCH, a diferencia de los tres campos de arriba.
export interface UpdateOpportunityInput {
  title?: string;
  amount?: number;
  currency?: string;
  status?: OpportunityStatus;
  companyId?: string;
  contactId?: string;
  pipelineId?: string;
  stageId?: string;
  ownerId?: string;
  expectedCloseDate?: string | null;
  actualCloseDate?: string | null;
  lostReason?: string | null;
}
