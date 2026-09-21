import { useMutation, useQueryClient } from "@tanstack/react-query";
import { cancelBooking } from "./api";
import { bookingKeys } from "./queries";

// Cancelar cambia el estado de una fila del listado: se invalidan las listas y
// nada más. Nunca queryClient.clear() global acá.
export function useCancelBooking() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => cancelBooking(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: bookingKeys.lists() });
    },
  });
}
