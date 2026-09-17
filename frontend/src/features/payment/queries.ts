import { useQuery } from "@tanstack/react-query";
import { listOpportunityPayments } from "./api";

// Jerárquica por oportunidad, como quoteKeys: un pago no existe fuera de su
// oportunidad y no hay listado global.
export const paymentKeys = {
  all: ["payments"] as const,
  byOpportunity: (opportunityId: string) =>
    [...paymentKeys.all, "opportunity", opportunityId] as const,
};

export function useOpportunityPayments(opportunityId: string) {
  return useQuery({
    queryKey: paymentKeys.byOpportunity(opportunityId),
    queryFn: ({ signal }) => listOpportunityPayments(opportunityId, signal),
  });
}
