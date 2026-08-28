import { useMutation, useQueryClient } from "@tanstack/react-query";
import { retryIngestionEvent } from "./api";
import { ingestionEventKeys } from "./queries";

// Invalidación mínima, mismo patrón que el resto: solo `lists()`, que es lo
// único que existe (no hay `detail` porque no hay GET por id).
//
// SIN OPTIMISTIC UPDATE, y es una decisión, no una omisión. Pintar la fila como
// PENDING antes de que el backend confirme sería mentir en el caso que más
// importa: dos ADMIN reintentando el mismo evento: el segundo recibe un 409
// porque el primero ya lo sacó de FAILED. Con optimistic update habría que
// revertir la fila y explicar por qué volvió atrás; con la invalidación, la
// lista se recarga y muestra el estado real, que ya es el correcto.
export function useRetryIngestionEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => retryIngestionEvent(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ingestionEventKeys.lists() });
    },
  });
}
