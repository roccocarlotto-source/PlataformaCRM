import { useMutation, useQueryClient } from "@tanstack/react-query";
import { cancelBooking, createBooking } from "./api";
import { bookingKeys } from "./queries";
import type { CreateBookingInput } from "./types";

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

// Crear (ítem 77) suma una fila a las listas —el calendario pide una por
// recurso— y nada más: mismo alcance que cancelar.
export function useCreateBooking() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateBookingInput) => createBooking(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: bookingKeys.lists() });
    },
  });
}
