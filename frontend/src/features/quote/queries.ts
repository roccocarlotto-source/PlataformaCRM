import { useQuery } from "@tanstack/react-query";
import { listOpportunityQuotes } from "./api";

// Jerárquica por oportunidad, como stageKeys por pipeline: una cotización no
// existe fuera de su oportunidad y no hay listado global.
export const quoteKeys = {
  all: ["quotes"] as const,
  byOpportunity: (opportunityId: string) =>
    [...quoteKeys.all, "opportunity", opportunityId] as const,
};

export function useOpportunityQuotes(opportunityId: string) {
  return useQuery({
    queryKey: quoteKeys.byOpportunity(opportunityId),
    queryFn: ({ signal }) => listOpportunityQuotes(opportunityId, signal),
  });
}
