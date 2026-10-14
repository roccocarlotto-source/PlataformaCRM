import { useMutation, useQueryClient } from "@tanstack/react-query";
import { actualizarVehiculo, borrarVehiculo, cambiarDueno, crearVehiculo } from "./api";
import { vehiculoKeys } from "./queries";
import type { CambiarDuenoInput, CamposDelVehiculoInput, CrearVehiculoInput } from "./types";

// Invalidación mínima: cada escritura invalida los listados (el de la pantalla
// y el de la tarjeta del contacto) y, si corresponde, la ficha.

export function useCrearVehiculo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CrearVehiculoInput) => crearVehiculo(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: vehiculoKeys.lists() });
    },
  });
}

export function useActualizarVehiculo(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CamposDelVehiculoInput) => actualizarVehiculo(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: vehiculoKeys.lists() });
      queryClient.invalidateQueries({ queryKey: vehiculoKeys.detail(id) });
    },
  });
}

export function useBorrarVehiculo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => borrarVehiculo(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: vehiculoKeys.lists() });
    },
  });
}

export function useCambiarDueno(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CambiarDuenoInput) => cambiarDueno(id, input),
    onSuccess: (ficha) => {
      queryClient.setQueryData(vehiculoKeys.detail(id), ficha);
      queryClient.invalidateQueries({ queryKey: vehiculoKeys.lists() });
    },
  });
}
