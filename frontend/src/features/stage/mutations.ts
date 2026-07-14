import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createStage, deleteStage, updateStage } from "./api";
import { stageKeys } from "./queries";
import type { CreateStageInput, UpdateStageInput } from "./types";

// Siempre invalida stageKeys.byPipeline(pipelineId) COMPLETO (listas y
// details de ese pipeline), nunca solo el detail/lista de la etapa
// tocada — decisión deliberada, distinta del patrón selectivo de
// Company/Contact: crear, actualizar (con o sin cambio de order) o
// borrar una etapa puede renumerar el `order` de sus hermanas del mismo
// pipeline (shiftUpFrom/shiftDownAfter/reindexStages en
// stage.repository.ts) sin que la respuesta de la mutation las mencione.
// No se condiciona a "si esta escritura tocó order" para mantener la
// lógica simple: el alcance ya es angosto (un solo pipeline), y refinar
// más agregaría una rama frágil por un ahorro marginal de requests.

export function useCreateStage(pipelineId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateStageInput) => createStage(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: stageKeys.byPipeline(pipelineId) });
    },
  });
}

// A diferencia de useUpdateCompany(id)/useUpdatePipeline(id) (que fijan el
// id en el propio hook porque solo existen en un formulario de una única
// entidad), useUpdateStage recibe el id en cada llamada a mutate(): esta
// misma mutation la usa tanto StageFormPage (un id fijo) como
// StageListPage (múltiples filas, cada una con su propio id, para
// "Subir"/"Bajar") — mismo criterio ya usado por useDeleteStage/
// useDeleteCompany, que tampoco fijan el id en el hook.
export function useUpdateStage(pipelineId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateStageInput }) => updateStage(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: stageKeys.byPipeline(pipelineId) });
    },
  });
}

export function useDeleteStage(pipelineId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteStage(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: stageKeys.byPipeline(pipelineId) });
    },
  });
}
