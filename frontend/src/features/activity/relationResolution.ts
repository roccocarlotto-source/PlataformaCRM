import { useQueries } from "@tanstack/react-query";
import { getOpportunity } from "../opportunity/api";
import { opportunityKeys } from "../opportunity/queries";

// Este archivo existe para UNA sola pieza de lógica real: resolver
// opportunityId -> title para ActivityListPage. Company/Contact/Author/
// Assignee NO se reimplementan ni se re-exportan acá — ActivityListPage
// los importa directamente de su fuente real (useCompaniesByIds de
// ../contact/companyResolution, useContactNames y useOwnerNames de
// ../opportunity/relationResolution), porque ya son reutilizables tal
// cual y una capa de re-export acá no agregaría nada. No existe hoy ningún
// resolvedor de Opportunity por id en el proyecto (Opportunity nunca
// necesitó resolverse a sí misma), así que esta es la única lógica
// genuinamente nueva — mismo patrón estructural que usePipelineNames/
// useContactNames en opportunity/relationResolution.ts, aplicado a
// Opportunity.
export function useOpportunityNames(ids: readonly string[]) {
  const uniqueIds = Array.from(new Set(ids));

  const results = useQueries({
    queries: uniqueIds.map((id) => ({
      queryKey: opportunityKeys.detail(id),
      queryFn: () => getOpportunity(id),
    })),
  });

  const byId = new Map<string, string>();
  uniqueIds.forEach((id, index) => {
    const opportunity = results[index]?.data;
    if (opportunity) {
      byId.set(id, opportunity.title);
    }
  });

  return { byId, isLoading: results.some((result) => result.isLoading) };
}
