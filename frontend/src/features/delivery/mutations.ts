import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { vehicleKeys } from "../vehicle/queries";
import { confirmDelivery, updateDelivery } from "./api";
import { deliveryKeys } from "./queries";
import type { Delivery, DeliveryListResponse, UpdateDeliveryInput } from "./types";

// El PATCH devuelve la entrega completa, así que en el éxito se escribe
// directo en la cache en vez de solo invalidar: cada tilde del checklist es un
// PATCH, y esperar al refetch haría que la casilla vuelva un instante a su
// estado anterior. En el error sí se invalida: un 409 (alguien la confirmó
// mientras la pantalla estaba abierta) deja la vista vieja, y refrescar
// muestra el estado real junto al mensaje — mismo criterio que
// useTransitionQuote.

function writeBack(queryClient: QueryClient, opportunityId: string, delivery: Delivery) {
  queryClient.setQueryData<DeliveryListResponse>(deliveryKeys.byOpportunity(opportunityId), {
    data: [delivery],
  });
}

function refresh(queryClient: QueryClient, opportunityId: string) {
  return queryClient.invalidateQueries({ queryKey: deliveryKeys.byOpportunity(opportunityId) });
}

export function useUpdateDelivery(opportunityId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateDeliveryInput }) =>
      updateDelivery(id, input),
    onSuccess: (delivery) => writeBack(queryClient, opportunityId, delivery),
    onError: () => refresh(queryClient, opportunityId),
  });
}

// Confirmar además mueve la unidad a DELIVERED: se invalidan las queries de
// vehículos (listado de stock, ficha, selector de la oportunidad) para que
// ninguna siga mostrando "Vendido".
export function useConfirmDelivery(opportunityId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => confirmDelivery(id),
    onSuccess: (delivery) => {
      writeBack(queryClient, opportunityId, delivery);
      queryClient.invalidateQueries({ queryKey: vehicleKeys.all });
    },
    onError: () => refresh(queryClient, opportunityId),
  });
}
