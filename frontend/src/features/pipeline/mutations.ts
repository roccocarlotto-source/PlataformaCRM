import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createPipeline, deletePipeline, updatePipeline } from "./api";
import { pipelineKeys } from "./queries";
import type { CreatePipelineInput, UpdatePipelineInput } from "./types";

// Invalidación deliberadamente MÁS AMPLIA que el patrón selectivo de
// Company/Contact en el único caso en que corresponde: marcar
// isDefault: true dispara, del lado del backend, una transacción que
// desmarca CUALQUIER OTRO pipeline que hoy sea default (unsetDefaultPipeline
// en pipeline.service.ts) — esa fila ajena cambia sin que la respuesta de
// esta mutation la mencione. En ese caso (y solo en ese caso) se invalida
// pipelineKeys.all completo, no solo lists()/detail(id) del pipeline
// tocado. isDefault: false explícito NO promueve ningún reemplazo (ver
// types.ts) y no puede afectar otra fila, así que usa el patrón selectivo
// normal.

export function useCreatePipeline() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePipelineInput) => createPipeline(input),
    onSuccess: (_data, variables) => {
      if (variables.isDefault === true) {
        queryClient.invalidateQueries({ queryKey: pipelineKeys.all });
      } else {
        queryClient.invalidateQueries({ queryKey: pipelineKeys.lists() });
      }
    },
  });
}

export function useUpdatePipeline(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdatePipelineInput) => updatePipeline(id, input),
    onSuccess: (_data, variables) => {
      if (variables.isDefault === true) {
        queryClient.invalidateQueries({ queryKey: pipelineKeys.all });
      } else {
        queryClient.invalidateQueries({ queryKey: pipelineKeys.lists() });
        queryClient.invalidateQueries({ queryKey: pipelineKeys.detail(id) });
      }
    },
  });
}

export function useDeletePipeline() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deletePipeline(id),
    onSuccess: () => {
      // Siempre amplio: borrar puede promover automáticamente otro
      // pipeline a default (deletePipeline en pipeline.service.ts) — no
      // vale la pena leer de antemano si el borrado era el default para
      // angostar el alcance.
      queryClient.invalidateQueries({ queryKey: pipelineKeys.all });
    },
  });
}
