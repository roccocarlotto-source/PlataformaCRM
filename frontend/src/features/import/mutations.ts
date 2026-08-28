import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ingestionEventKeys } from "../ingestionEvent/queries";
import { importFile } from "./api";

// INVALIDA EL LISTADO DE EVENTOS, no el suyo propio.
//
// Es la dependencia cruzada que este archivo anticipaba y no podía tener
// todavía: una importación exitosa crea IngestionEvent, así que quien navegue de
// acá a la pantalla de Eventos en la misma sesión tiene que ver las filas nuevas
// sin recargar la página.
//
// No se invalida `importKeys`: el batchId del lote recién creado no estaba en
// cache antes de existir, así que no hay nada viejo que tirar.
export function useImportFile(sourceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => importFile(sourceId, file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ingestionEventKeys.lists() });
    },
  });
}
