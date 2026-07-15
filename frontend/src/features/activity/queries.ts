import { useQuery } from "@tanstack/react-query";
import { getActivity, listActivities } from "./api";
import type { ActivityListQuery } from "./types";

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

export function useActivities(query: ActivityListQuery) {
  return useQuery({
    queryKey: activityKeys.list(query),
    queryFn: ({ signal }) => listActivities(query, signal),
  });
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
