import { useQuery } from "@tanstack/react-query";
import { listBookings } from "./api";
import type { BookingListQuery } from "./types";

// Misma forma jerárquica que el resto de los módulos. Sin detail: hoy nada
// pide una reserva suelta (GET /bookings/:id existe, pero ninguna pantalla lo
// consume todavía).
export const bookingKeys = {
  all: ["bookings"] as const,
  lists: () => [...bookingKeys.all, "list"] as const,
  list: (query: BookingListQuery) => [...bookingKeys.lists(), query] as const,
};

export function useBookings(query: BookingListQuery) {
  return useQuery({
    queryKey: bookingKeys.list(query),
    queryFn: ({ signal }) => listBookings(query, signal),
  });
}
