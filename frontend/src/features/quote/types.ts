// Contrato de /api/quotes (§39 de docs/frontend-cambios-pendientes.md), tal
// como lo serializa el backend (quote.controller.ts / quote.repository.ts).

// DRAFT -> SENT -> ACCEPTED | REJECTED. EXPIRED (una SENT vencida) y
// SUPERSEDED (reemplazada por una más nueva) los pone el backend solo.
export type QuoteStatus = "DRAFT" | "SENT" | "ACCEPTED" | "REJECTED" | "EXPIRED" | "SUPERSEDED";

// Las transiciones que se piden a mano con PATCH { status }.
export type QuoteTransition = "SENT" | "ACCEPTED" | "REJECTED";

// Una línea adicional: accesorio (importe positivo) o descuento (negativo).
// amount llega como string con dos decimales, igual que un Decimal.
export interface QuoteLine {
  description: string;
  amount: string;
}

export interface Quote {
  id: string;
  organizationId: string;
  opportunityId: string;
  // FOTO de la unidad de la oportunidad al momento de cotizar: no sigue a la
  // oportunidad si después le cambian la unidad.
  vehicleId: string | null;
  createdById: string;
  // Prisma.Decimal → string, como Opportunity.amount.
  amount: string;
  currency: string;
  lines: QuoteLine[];
  // Fecha sola serializada como ISO a medianoche UTC ("2026-09-30T00:00:00.000Z").
  validUntil: string | null;
  status: QuoteStatus;
  createdAt: string;
  updatedAt: string;
  createdBy: { id: string; fullName: string };
  vehicle: {
    id: string;
    internalCode: string;
    make: string;
    model: string;
    trim: string | null;
    year: number;
  } | null;
}

export interface QuoteListResponse {
  // Más nueva primero.
  data: Quote[];
  // La activa según la regla del backend (la más reciente no SUPERSEDED). El
  // frontend no la recalcula.
  activeQuoteId: string | null;
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

// En la escritura los importes viajan como number (z.number() en el
// backend); vuelven como string.
export interface QuoteLineInput {
  description: string;
  amount: number;
}

export interface CreateQuoteInput {
  opportunityId: string;
  amount: number;
  currency: string;
  lines: QuoteLineInput[];
  // "YYYY-MM-DD"; null o ausente = sin fecha de validez.
  validUntil?: string | null;
}

// Solo para una DRAFT. Nunca junto con status: son dos formas distintas del
// PATCH y el backend rechaza la mezcla.
export interface UpdateQuoteContentInput {
  amount?: number;
  currency?: string;
  lines?: QuoteLineInput[];
  validUntil?: string | null;
}
