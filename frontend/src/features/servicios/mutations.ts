import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  actualizarOrden,
  actualizarTipo,
  actualizarVehiculo,
  borrarTipo,
  borrarVehiculo,
  cambiarDueno,
  cambiarEstado,
  crearOrden,
  crearTipo,
  crearVehiculo,
  guardarConfiguracion,
  registrarAprobacion,
  registrarAviso,
  registrarAvisosDeRecambio,
} from "./api";
import { avisosKey, ordenKeys, recambiosKey, tallerKeys, vehiculoKeys } from "./queries";
import type {
  AccionDelRecambio,
  MedioDeAviso,
  ActualizarOrdenInput,
  AprobacionInput,
  CambiarDuenoInput,
  CambiarEstadoInput,
  CamposDelVehiculoInput,
  ConfiguracionDelTaller,
  CrearOrdenInput,
  CrearVehiculoInput,
  FichaDeOrden,
  OrdenesResponse,
  TipoDeService,
} from "./types";

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

// --- Órdenes (S4a) ----------------------------------------------------------
// Toda escritura de una orden devuelve la ficha: se guarda en la caché y se
// invalidan los listados y los vehículos (el historial, la orden abierta y el
// próximo service salen de ahí).

function alGuardarLaOrden(queryClient: ReturnType<typeof useQueryClient>) {
  return (ficha: FichaDeOrden) => {
    queryClient.setQueryData(ordenKeys.detail(ficha.id), ficha);
    queryClient.invalidateQueries({ queryKey: ordenKeys.lists() });
    queryClient.invalidateQueries({ queryKey: vehiculoKeys.all });
  };
}

export function useCrearOrden() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CrearOrdenInput) => crearOrden(input),
    onSuccess: alGuardarLaOrden(queryClient),
  });
}

export function useActualizarOrden(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ActualizarOrdenInput) => actualizarOrden(id, input),
    onSuccess: alGuardarLaOrden(queryClient),
  });
}

/** Cambiar de estado mueve la tarjeta en el momento (actualización optimista
 *  de las listas): sin esto, durante el guardado la tarjeta volvía a su columna
 *  de origen y parecía que el arrastre no había funcionado (prueba de S4a). Si
 *  el servidor la rechaza, vuelve a donde estaba. */
export function useCambiarEstado(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CambiarEstadoInput) => cambiarEstado(id, input),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: ordenKeys.lists() });
      const antes = queryClient.getQueriesData<OrdenesResponse>({ queryKey: ordenKeys.lists() });
      queryClient.setQueriesData<OrdenesResponse>({ queryKey: ordenKeys.lists() }, (lista) =>
        lista
          ? {
              ...lista,
              data: lista.data.map((o) => (o.id === id ? { ...o, status: input.hacia } : o)),
            }
          : lista,
      );
      return { antes };
    },
    onError: (_error, _input, contexto) => {
      for (const [clave, datos] of contexto?.antes ?? []) queryClient.setQueryData(clave, datos);
    },
    onSuccess: alGuardarLaOrden(queryClient),
  });
}

export function useRegistrarAprobacion(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AprobacionInput) => registrarAprobacion(id, input),
    onSuccess: alGuardarLaOrden(queryClient),
  });
}

// --- Configuración y tipos (S4a) -------------------------------------------

type CamposDelTipo = Partial<Pick<TipoDeService, "name" | "nextServiceAfterMonths" | "isActive">>;

export function useGuardarConfiguracion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<ConfiguracionDelTaller>) => guardarConfiguracion(input),
    onSuccess: (configuracion) => {
      queryClient.setQueryData(tallerKeys.configuracion, configuracion);
    },
  });
}

export function useCrearTipo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; nextServiceAfterMonths: number | null }) =>
      crearTipo(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: tallerKeys.todosLosTipos }),
  });
}

export function useActualizarTipo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: { id: string } & CamposDelTipo) => actualizarTipo(id, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: tallerKeys.todosLosTipos }),
  });
}

export function useBorrarTipo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => borrarTipo(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: tallerKeys.todosLosTipos }),
  });
}

// S12: "Marcar como avisado". La lista vuelve en la respuesta.
export function useRegistrarAviso(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (medio: MedioDeAviso) => registrarAviso(id, medio),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: avisosKey(id) }),
  });
}

// S13: "Crear tarea al vendedor" o "Marcar como contactado", de una o varias
// filas. Invalida la lista de vencidos y el resumen (sus tarjetas).
export function useRegistrarAvisosDeRecambio() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { vehiculoIds: string[]; accion: AccionDelRecambio }) =>
      registrarAvisosDeRecambio(input.vehiculoIds, input.accion),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: recambiosKey });
      void queryClient.invalidateQueries({ queryKey: ["servicios", "resumen"] });
    },
  });
}
