import { useQuery } from "@tanstack/react-query";
import { listOpportunityPaymentChanges, listOpportunityPayments } from "./api";

// Jerárquica por oportunidad, como quoteKeys: un pago no existe fuera de su
// oportunidad y no hay listado global.
export const paymentKeys = {
  all: ["payments"] as const,
  byOpportunity: (opportunityId: string) =>
    [...paymentKeys.all, "opportunity", opportunityId] as const,
  // Debajo de byOpportunity a propósito: las mutaciones invalidan esa clave,
  // y con ella el historial.
  changes: (opportunityId: string) =>
    [...paymentKeys.byOpportunity(opportunityId), "changes"] as const,
};

export function useOpportunityPayments(opportunityId: string) {
  return useQuery({
    queryKey: paymentKeys.byOpportunity(opportunityId),
    queryFn: ({ signal }) => listOpportunityPayments(opportunityId, signal),
  });
}

// El historial se pide recién cuando se abre (enabled): la mayoría de las
// veces nadie lo mira.
export function useOpportunityPaymentChanges(opportunityId: string, enabled: boolean) {
  return useQuery({
    queryKey: paymentKeys.changes(opportunityId),
    queryFn: ({ signal }) => listOpportunityPaymentChanges(opportunityId, signal),
    enabled,
  });
}
