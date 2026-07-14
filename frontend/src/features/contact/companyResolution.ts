import { useQueries } from "@tanstack/react-query";
import { getCompany } from "../company/api";
import { companyKeys } from "../company/queries";
import type { Company } from "../company/types";

// Resuelve únicamente los companyId realmente visibles (los de los
// Contacts de la página actual) — nunca precarga ni pagina todas las
// Companies, nunca asume un máximo total. Deduplicado por id distinto:
// varios Contacts con la misma empresa disparan una sola resolución.
//
// companyKeys.detail(id) es la MISMA queryKey que usa Company
// (useCompany/CompanySelect) — si esa Company ya se resolvió antes en la
// sesión (por CompanySelect al buscar, o por una edición previa), esta
// llamada la reutiliza gratis del cache de TanStack Query: es el
// comportamiento estándar de useQuery/useQueries ante una key ya fresca,
// no una lógica adicional que este hook implemente.
//
// Un fallo de resolución individual (ej. la Company fue borrada después de
// vincularse) no rompe nada más: useQueries no falla en bloque, cada
// entrada tiene su propio estado — simplemente esa Company no aparece en
// `byId`, y el caller decide el fallback (ver ContactListPage).
export function useCompaniesByIds(ids: readonly string[]) {
  const uniqueIds = Array.from(new Set(ids));

  const results = useQueries({
    queries: uniqueIds.map((id) => ({
      queryKey: companyKeys.detail(id),
      queryFn: () => getCompany(id),
    })),
  });

  const byId = new Map<string, Company>();
  uniqueIds.forEach((id, index) => {
    const data = results[index]?.data;
    if (data) {
      byId.set(id, data);
    }
  });

  return {
    byId,
    isLoading: results.some((result) => result.isLoading),
  };
}
