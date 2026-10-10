import { useQueries } from "@tanstack/react-query";
import { getOpportunity } from "../opportunity/api";
import { opportunityKeys } from "../opportunity/queries";

// Este archivo existe para UNA sola pieza de lógica real: resolver
// opportunityId -> title para ActivityListPage. Company/Contact/Author/
// Assignee NO se reimplementan ni se re-exportan acá — ActivityListPage
// los importa directamente de su fuente real (useCompaniesByIds de
// ../contact/companyResolution, useContactNames y useOwnerNames de
// ../opportunity/relationResolution), porque ya son reutilizables tal
// cual y una capa de re-export acá no agregaría nada. No existe hoy ningún
// resolvedor de Opportunity por id en el proyecto (Opportunity nunca
// necesitó resolverse a sí misma), así que esta es la única lógica
// genuinamente nueva — mismo patrón estructural que usePipelineNames/
// useContactNames en opportunity/relationResolution.ts, aplicado a
// Opportunity.
// Rótulo humano de un authorId/assigneeId, la misma regla para la tabla de
// "Actividades" y el feed del Dashboard (§30): "Vos" si es quien mira
// (conocido vía useAuth, sin request), el nombre resuelto por useOwnerNames
// si es ADMIN, y "—" si no se puede resolver — nunca el UUID crudo. Un USER
// no tiene acceso a GET /api/users, así que cualquier id ajeno cae en "—".
export function resolveUserLabel(
  userId: string | null,
  viewer: { meId: string | undefined; isAdmin: boolean; names: ReadonlyMap<string, string> },
): string {
  if (!userId) return "";
  if (userId === viewer.meId) return "Vos";
  if (viewer.isAdmin) return viewer.names.get(userId) ?? "—";
  return "—";
}

// R11 (docs/rubros.md §5.1): el asunto de una nota que dejó el agente de una
// clínica empieza con esta marca (MARCA_DEL_ASISTENTE en
// src/clinicas/services/reprogramar.service.ts, ESPEJO A MANO). La firma una
// persona porque authorId no admite nulos, pero el autor que se muestra es
// "Asistente", nunca su nombre.
export const MARCA_DEL_ASISTENTE = "[Asistente] ";
export const AUTOR_ASISTENTE = "Asistente";

/** El autor de una actividad para mostrar: "Asistente" si la dejó el agente,
 *  si no la regla de resolveUserLabel. */
export function autorDeLaActividad(
  activity: { authorId: string; subject: string },
  viewer: Parameters<typeof resolveUserLabel>[1],
): string {
  if (activity.subject.startsWith(MARCA_DEL_ASISTENTE)) return AUTOR_ASISTENTE;
  return resolveUserLabel(activity.authorId, viewer);
}

export function useOpportunityNames(ids: readonly string[]) {
  const uniqueIds = Array.from(new Set(ids));

  const results = useQueries({
    queries: uniqueIds.map((id) => ({
      queryKey: opportunityKeys.detail(id),
      queryFn: () => getOpportunity(id),
    })),
  });

  const byId = new Map<string, string>();
  uniqueIds.forEach((id, index) => {
    const opportunity = results[index]?.data;
    if (opportunity) {
      byId.set(id, opportunity.title);
    }
  });

  return { byId, isLoading: results.some((result) => result.isLoading) };
}
