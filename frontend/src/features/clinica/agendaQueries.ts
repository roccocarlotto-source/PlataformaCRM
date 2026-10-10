import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { bookingKeys } from "../booking/queries";
import { resourceKeys } from "../resource/queries";
import {
  borrarBloqueo,
  configurarSobreturnos,
  crearBloqueo,
  crearSobreturno,
  horariosConSobreturnos,
  listarBloqueos,
} from "./agendaApi";
import { clinicaKeys } from "./queries";

// Bloqueos y sobreturnos (docs/rubros.md §4.4, §4.5, R6).

const bloqueosKeys = {
  all: [...clinicaKeys.all, "bloqueos"] as const,
  list: (resourceId: string, from: string, to: string) =>
    [...bloqueosKeys.all, resourceId, from, to] as const,
};

export function useBloqueos(resourceId: string | undefined, rango: { from: string; to: string }) {
  return useQuery({
    queryKey: bloqueosKeys.list(resourceId ?? "", rango.from, rango.to),
    queryFn: ({ signal }) => listarBloqueos(resourceId!, rango, signal),
    enabled: resourceId !== undefined,
  });
}

export function useCrearBloqueo(resourceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { startsAt: string; endsAt: string; reason?: string }) =>
      crearBloqueo(resourceId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: bloqueosKeys.all });
    },
  });
}

export function useBorrarBloqueo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => borrarBloqueo(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: bloqueosKeys.all });
    },
  });
}

export function useConfigurarSobreturnos(resourceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { allowsOverbooking: boolean; maxOverbookingsPerDay: number }) =>
      configurarSobreturnos(resourceId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: resourceKeys.lists() });
    },
  });
}

export function useHorariosConSobreturnos(
  query: { serviceTypeId: string; resourceId: string; from: string; to: string } | null,
) {
  return useQuery({
    queryKey: [...clinicaKeys.all, "sobreturnos", query] as const,
    queryFn: ({ signal }) => horariosConSobreturnos(query!, signal),
    enabled: query !== null,
  });
}

export function useCrearSobreturno() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: crearSobreturno,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...clinicaKeys.all, "sobreturnos"] });
      queryClient.invalidateQueries({ queryKey: bookingKeys.lists() });
    },
  });
}
