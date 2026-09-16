import { getAccessToken } from "../../auth/getAccessToken";
import { request } from "../../lib/api";
import type {
  CreateQuoteInput,
  Quote,
  QuoteListResponse,
  QuoteTransition,
  UpdateQuoteContentInput,
} from "./types";

// Reutiliza request()/getAccessToken tal cual, como el resto de las features.

// El tope real del backend para pageSize (quote.controller.ts). Una
// oportunidad con más de 100 cotizaciones no es un caso de una automotora: se
// pide una sola página.
const HISTORY_PAGE_SIZE = 100;

export function listOpportunityQuotes(
  opportunityId: string,
  signal?: AbortSignal,
): Promise<QuoteListResponse> {
  const params = new URLSearchParams({ opportunityId, pageSize: String(HISTORY_PAGE_SIZE) });
  return request<QuoteListResponse>(`/quotes?${params.toString()}`, { getAccessToken, signal });
}

export function createQuote(input: CreateQuoteInput): Promise<Quote> {
  return request<Quote>("/quotes", { method: "POST", body: input, getAccessToken });
}

export function updateQuoteContent(id: string, input: UpdateQuoteContentInput): Promise<Quote> {
  return request<Quote>(`/quotes/${id}`, { method: "PATCH", body: input, getAccessToken });
}

export function transitionQuote(id: string, status: QuoteTransition): Promise<Quote> {
  return request<Quote>(`/quotes/${id}`, { method: "PATCH", body: { status }, getAccessToken });
}
