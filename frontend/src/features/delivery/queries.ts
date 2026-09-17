import { useQuery } from "@tanstack/react-query";
import { listOpportunityDeliveries } from "./api";

// Jerárquica por oportunidad, como quoteKeys: una entrega no existe fuera de
// su oportunidad y no hay listado global.
export const deliveryKeys = {
  all: ["deliveries"] as const,
  byOpportunity: (opportunityId: string) =>
    [...deliveryKeys.all, "opportunity", opportunityId] as const,
};

// `enabled` porque solo una oportunidad ganada puede tener entrega: para una
// abierta o perdida no hace falta ni pedirla.
export function useOpportunityDelivery(opportunityId: string, options: { enabled: boolean }) {
  return useQuery({
    queryKey: deliveryKeys.byOpportunity(opportunityId),
    queryFn: ({ signal }) => listOpportunityDeliveries(opportunityId, signal),
    enabled: options.enabled,
  });
}
