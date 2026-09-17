// Reconstruido desde el contrato real del backend
// (src/controllers/opportunity.controller.ts, src/services/opportunity.service.ts,
// src/repositories/opportunity.repository.ts, prisma/schema.prisma modelo
// Opportunity). No se agrega ningún campo que el backend no devuelva o no acepte.

export type OpportunityStatus = "OPEN" | "WON" | "LOST";

// Módulo de stock de vehículos (Fase 2c): enums de prisma/schema.prisma
// (OpportunityFinancingType / OpportunityLeadSource), los rótulos están en
// labels.ts.
export type OpportunityFinancingType =
  "NONE" | "INSTALLMENT_24M" | "INSTALLMENT_36M" | "OWN_FINANCING";
export type OpportunityLeadSource =
  "PORTAL_MERCADOLIBRE" | "WEBSITE" | "SHOWROOM" | "REFERRAL" | "WHATSAPP";

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
  // Unidad de stock vinculada (Fase 2c). Al vincular una, el backend le copia
  // el precio a amount/currency SOLO si el body no los manda (ver
  // OpportunityFormPage), y sincroniza el estado de la unidad con el de la
  // oportunidad (RESERVED mientras está abierta, SOLD al ganarla). DELIVERED
  // no sale de la oportunidad: lo pone "Confirmar entrega" (§40).
  vehicleId: string | null;
  financingType: OpportunityFinancingType | null;
  leadSource: OpportunityLeadSource | null;
  // Detalle del plan de financiación (§42). Complementa a financingType, sin
  // validación cruzada: puede venir cargado con cualquier valor del enum. Los
  // dos importes son Decimal(14,2) → string en lectura (mismo caso que
  // amount), en la moneda de la oportunidad; la cantidad de cuotas es Int.
  financingLender: string | null;
  financingDownPayment: string | null;
  financingInstallmentCount: number | null;
  financingInstallmentAmount: string | null;
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
  // Solo una unidad AVAILABLE se puede vincular (409 si no lo está).
  vehicleId?: string;
  financingType?: OpportunityFinancingType;
  leadSource?: OpportunityLeadSource;
  financingLender?: string;
  financingDownPayment?: number;
  financingInstallmentCount?: number;
  financingInstallmentAmount?: number;
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
  // vehicleId: null desvincula la unidad (vuelve a AVAILABLE si seguía
  // RESERVED por este vínculo); un id distinto la reemplaza. Cambiar de
  // unidad SIN mandar amount/currency hace que la oportunidad tome el precio
  // de la nueva; mandarlos gana sobre ese default.
  vehicleId?: string | null;
  financingType?: OpportunityFinancingType | null;
  leadSource?: OpportunityLeadSource | null;
  // null vacía el campo; el backend no dispara nada con ninguno de los cuatro.
  financingLender?: string | null;
  financingDownPayment?: number | null;
  financingInstallmentCount?: number | null;
  financingInstallmentAmount?: number | null;
}

// La granularidad del selector de período del Dashboard. Desde el §35 gobierna
// las DOS respuestas agregadas —el resumen comercial y la serie de ingresos—,
// así que se declara antes que las dos.
export type OpportunityRevenueGranularity = "month" | "week" | "day";

// Resumen comercial del Dashboard (§30 de docs/frontend-cambios-pendientes.md,
// rediseñado en el §35), GET /api/opportunities/dashboard-summary?granularity=…
// Reconstruido desde src/services/opportunity.service.ts (DashboardSummary).
// Todos los montos (`value`, `openValue`) son string por el mismo motivo que
// `amount` (Prisma.Decimal), ya en la moneda de la organización que dice
// `currency`; las variaciones NO vienen calculadas: las arma el frontend
// (dashboard/kpi.ts).
export interface OpportunityDashboardFigures {
  count: number;
  value: string;
}

export interface OpportunityDashboardSummary {
  currency: string;
  // Eco de lo pedido: kpi.ts rotula las cards con ESTA granularidad, no con la
  // del estado de la página, así el rótulo nunca describe otra ventana que la
  // de los números que está mostrando.
  granularity: OpportunityRevenueGranularity;
  // Sin consumidor en el frontend desde el §36 (ver el service: se mantienen
  // por los tests de aislamiento y porque son baratos).
  openCount: number;
  openValue: string;
  // Las cuatro ventanas del resumen: el mes, la semana o el día según
  // `granularity`, una por cada una de las tres cards.
  createdThisPeriod: OpportunityDashboardFigures;
  createdLastPeriod: OpportunityDashboardFigures;
  wonThisPeriod: OpportunityDashboardFigures;
  wonLastPeriod: OpportunityDashboardFigures;
  lostCountThisPeriod: number;
  lostCountLastPeriod: number;
}

// Serie de ingresos por período (§33), GET /api/opportunities/revenue-series
// ?granularity=... Reconstruida desde src/services/opportunity.service.ts
// (RevenueSeries). Sigue siendo un endpoint aparte del resumen después del
// §35: la misma granularidad, pero una respuesta de N buckets contra un puñado
// de agregados, cacheada por separado.
export interface OpportunityRevenueSeries {
  currency: string;
  granularity: OpportunityRevenueGranularity;
  // Orden cronológico, el período en curso al final. `label` es la clave
  // cruda del backend: "YYYY-MM" para meses, "YYYY-MM-DD" (fecha de inicio de
  // la ventana) para semanas y días. El formato para mostrar lo decide el
  // frontend (dashboard/revenueChart.ts).
  points: Array<{ label: string; value: string }>;
}
