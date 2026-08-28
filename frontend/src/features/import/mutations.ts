import { useMutation } from "@tanstack/react-query";
import { importFile } from "./api";

// SIN invalidateQueries, y no es un olvido.
//
// Todas las demás mutaciones del proyecto invalidan el listado que acaban de
// afectar. Acá no hay ninguno: la importación crea IngestionEvent, y el frontend
// todavía no tiene ninguna pantalla que los liste (es la última pieza de la Fase
// 2). Invalidar `importKeys` tampoco corresponde — el batchId del lote nuevo no
// estaba en cache antes de crearse.
//
// El día que exista el listado de eventos, esta mutación va a querer invalidarlo.
// Agregarlo hoy sería inventar una dependencia con algo que no existe.
export function useImportFile(sourceId: string) {
  return useMutation({
    mutationFn: (file: File) => importFile(sourceId, file),
  });
}
