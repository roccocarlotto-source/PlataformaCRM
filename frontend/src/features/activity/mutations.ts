import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createActivity, deleteActivity, updateActivity } from "./api";
import { activityKeys } from "./queries";
import type { CreateActivityInput, UpdateActivityInput } from "./types";

// Invalidación selectiva pura — activity.repository.ts (createActivity/
// updateActivity/softDeleteActivity) toca exclusivamente db.activity, sin
// efecto lateral real sobre otras tablas. Nunca se invalida companyKeys/
// contactKeys/opportunityKeys/userKeys desde acá, mismo criterio que
// opportunity/mutations.ts.

export function useCreateActivity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateActivityInput) => createActivity(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: activityKeys.lists() });
    },
  });
}

export function useUpdateActivity(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateActivityInput) => updateActivity(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: activityKeys.lists() });
      queryClient.invalidateQueries({ queryKey: activityKeys.detail(id) });
    },
  });
}

// Completar desde "Mis tareas". El id viaja en cada llamada en vez de
// fijarse al montar el hook — mismo motivo exacto que useMoveOpportunity
// (opportunity/mutations.ts): una sola vista con muchas filas y un solo
// handler de click, no se puede montar un hook por actividad. El body es
// SOLO completedAt a propósito: es lo único que un USER (no-ADMIN) tiene
// permitido PATCHear sobre su propia actividad, y solo mientras está
// pendiente (activity.service.ts, canSelfServiceCompleteActivity — desde el
// §29 no puede destildarla: deshacer un tilde es "Rechazar", del ADMIN).
// completedAt sigue admitiendo null en el tipo porque el contrato del PATCH
// lo admite (un ADMIN sí puede limpiarlo); "Mis tareas" nunca lo manda.
// Invalida lo mismo que useUpdateActivity.
export function useCompleteActivity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, completedAt }: { id: string; completedAt: string | null }) =>
      updateActivity(id, { completedAt }),
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: activityKeys.lists() });
      queryClient.invalidateQueries({ queryKey: activityKeys.detail(id) });
    },
  });
}

// Confirmar (true) / Rechazar (false) una tarea completada desde el menú de
// la fila en "Actividades" (§29). Solo ADMIN, y el body es SOLO `confirmed`:
// el backend rechaza combinarlo con completedAt, y confirmedAt/confirmedById
// los calcula el server. Mismo esquema de id-por-llamada que
// useCompleteActivity, por el mismo motivo.
export function useConfirmActivity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, confirmed }: { id: string; confirmed: boolean }) =>
      updateActivity(id, { confirmed }),
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: activityKeys.lists() });
      queryClient.invalidateQueries({ queryKey: activityKeys.detail(id) });
    },
  });
}

export function useDeleteActivity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteActivity(id),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: activityKeys.lists() });
      queryClient.invalidateQueries({ queryKey: activityKeys.detail(id) });
    },
  });
}
