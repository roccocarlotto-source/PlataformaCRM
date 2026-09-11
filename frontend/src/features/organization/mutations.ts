import { useMutation, useQueryClient } from "@tanstack/react-query";
import { updateOrganizationCurrency } from "./api";
import { organizationKeys } from "./queries";
import type { UpdateOrganizationCurrencyInput } from "./types";

// Invalidación mínima, mismo patrón que Source/Company: la única query que
// esta mutación puede afectar es la de configuración (incluye las
// cotizaciones, que cambian con las monedas configuradas). Nunca
// queryClient.clear() global acá.
export function useUpdateOrganizationCurrency() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateOrganizationCurrencyInput) => updateOrganizationCurrency(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.settings() });
    },
  });
}
