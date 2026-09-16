import type { Quote, QuoteListResponse } from "../features/quote/types";

// Fixture compartida de los tests de features/quote/. Importes como string
// con dos decimales y validUntil como ISO a medianoche UTC, fiel a cómo
// serializa el backend (Prisma.Decimal y una columna DATE).
export function makeQuote(overrides: Partial<Quote> = {}): Quote {
  return {
    id: "q1",
    organizationId: "org-1",
    opportunityId: "op1",
    vehicleId: null,
    createdById: "u1",
    amount: "25000.00",
    currency: "USD",
    lines: [],
    validUntil: null,
    status: "DRAFT",
    createdAt: "2026-09-10T15:00:00.000Z",
    updatedAt: "2026-09-10T15:00:00.000Z",
    createdBy: { id: "u1", fullName: "Ana Pérez" },
    vehicle: null,
    ...overrides,
  };
}

// La respuesta de GET /quotes?opportunityId=: más nueva primero y la activa
// señalada aparte, como la arma el backend.
export function makeQuoteList(quotes: Quote[], activeQuoteId: string | null): QuoteListResponse {
  return {
    data: quotes,
    activeQuoteId,
    pagination: { page: 1, pageSize: 100, total: quotes.length, totalPages: quotes.length ? 1 : 0 },
  };
}
