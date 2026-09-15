import { useQueries, useQuery } from "@tanstack/react-query";
import { getActivity, listActivities } from "./api";
import type { Activity, ActivityListQuery } from "./types";

// Plana, mismo shape que companyKeys/contactKeys/opportunityKeys — NO
// jerárquica: Activity no está scoped a un único padre obligatorio por URL,
// sus relaciones (company/contact/opportunity/author/assignee) son filtros
// opcionales de un listado de primer nivel.
export const activityKeys = {
  all: ["activities"] as const,
  lists: () => [...activityKeys.all, "list"] as const,
  list: (query: ActivityListQuery) => [...activityKeys.lists(), query] as const,
  details: () => [...activityKeys.all, "detail"] as const,
  detail: (id: string) => [...activityKeys.details(), id] as const,
};

// options.enabled — mismo patrón que useOpportunities/useStages: "Mis
// tareas" monta su listado antes de conocer el id de la persona (me puede
// ser undefined un instante) y sin esto pediría las actividades de TODOS.
// undefined → true, ningún caller existente cambia.
export function useActivities(query: ActivityListQuery, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: activityKeys.list(query),
    queryFn: ({ signal }) => listActivities(query, signal),
    enabled: options?.enabled,
  });
}

// Tope real del backend para pageSize (activity.controller.ts,
// listQuerySchema) — mismo límite que documentan PipelineSelect/StageSelect.
const MAX_PAGE_SIZE = 100;

// TODAS las actividades SIN CONFIRMAR asignadas a una persona, para "Mis
// tareas": las pendientes y, desde el §29, también las que ya tildó y
// esperan la confirmación de un ADMIN (bloque "Esperando confirmación").
// Por eso el filtro es confirmed=false y no completed=false: lo confirmado
// es lo único que ya no le concierne. Mismo patrón que
// usePipelineOpportunitiesAll (opportunity/queries.ts): la primera página
// dice cuántas hay (pagination.totalPages) y las restantes se piden en
// paralelo con useQueries. El conjunto sigue siendo chico por construcción
// —lo que una persona tiene abierto, no su historial confirmado—, así que
// traerlo entero es razonable.
//
// Orden fijo por dueDate asc: dentro de cada bloque de la vista, lo que
// vence antes va primero (no hay campo de posición en Activity).
export function useMyPendingActivities(assigneeId: string | undefined) {
  const baseQuery: ActivityListQuery = {
    assigneeId,
    confirmed: false,
    pageSize: MAX_PAGE_SIZE,
    sortBy: "dueDate",
    sortOrder: "asc",
  };
  const enabled = assigneeId !== undefined;

  const firstPage = useActivities({ ...baseQuery, page: 1 }, { enabled });
  const totalPages = firstPage.data?.pagination.totalPages ?? 0;

  const remainingPages = useQueries({
    queries: Array.from({ length: Math.max(0, totalPages - 1) }, (_, index) => {
      const query = { ...baseQuery, page: index + 2 };
      return {
        queryKey: activityKeys.list(query),
        queryFn: ({ signal }: { signal?: AbortSignal }) => listActivities(query, signal),
        enabled,
      };
    }),
  });

  const pages = [firstPage, ...remainingPages];
  const isLoading = pages.some((page) => page.isLoading);
  const failed = pages.find((page) => page.isError);
  const isSuccess = pages.every((page) => page.isSuccess);

  const data: Activity[] | undefined = isSuccess
    ? pages.flatMap((page) => page.data?.data ?? [])
    : undefined;

  return {
    data,
    isLoading,
    isError: failed !== undefined,
    error: failed?.error ?? null,
    isSuccess,
  };
}

// GET /api/activities/:id existe realmente (activity.routes.ts) y se usa
// acá exclusivamente para hidratar ActivityFormPage en modo edición — no
// hay una página de detalle separada (ningún otro módulo del proyecto
// tiene una).
export function useActivity(id: string | undefined) {
  return useQuery({
    queryKey: activityKeys.detail(id ?? ""),
    queryFn: ({ signal }) => getActivity(id ?? "", signal),
    enabled: id !== undefined,
  });
}
