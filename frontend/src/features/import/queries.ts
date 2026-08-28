import { useQuery } from "@tanstack/react-query";
import { getImportBatch } from "./api";

// Misma forma jerárquica que el resto de los slices, con lo que este módulo
// realmente tiene: solo el detalle de un lote. No hay `lists()` porque no existe
// GET /api/imports (sin :batchId) en el backend — declarar una key para una
// query imposible sería una invitación a escribirla.
export const importKeys = {
  all: ["imports"] as const,
  details: () => [...importKeys.all, "detail"] as const,
  detail: (batchId: string) => [...importKeys.details(), batchId] as const,
};

// EL ESTADO DEL LOTE SE PIDE A MANO, con un botón. Ni polling, ni una primera
// consulta automática.
//
// La promoción es asíncrona: los eventos entran PENDING y el worker los procesa
// en su propia pasada, así que el resumen cambia con el tiempo. La tentación es
// un refetchInterval, y deliberadamente no está: un polling que nadie apagó
// consume una request por intervalo por cada pestaña abierta contra un endpoint
// que hace un GROUP BY sobre la tabla de mayor volumen del esquema.
//
// `enabled: false` FIJO, y no `batchId !== undefined`, que es lo que parecía
// natural: habilitar una query hace que TanStack Query dispare su fetch inicial
// sola, así que atar `enabled` a la existencia del batchId habría consultado el
// lote apenas termina la subida, sin que nadie lo pidiera. Con `enabled: false`
// la única forma de que salga una request es `refetch()`, que es exactamente lo
// que hace el botón — es el patrón documentado para una query manual.
export function useImportBatch(batchId: string | undefined) {
  return useQuery({
    queryKey: importKeys.detail(batchId ?? ""),
    queryFn: ({ signal }) => getImportBatch(batchId ?? "", signal),
    enabled: false,
  });
}
