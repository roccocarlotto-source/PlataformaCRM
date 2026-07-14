import { useQueries } from "@tanstack/react-query";
import { getContact } from "../contact/api";
import { contactKeys } from "../contact/queries";
import { getPipeline } from "../pipeline/api";
import { pipelineKeys } from "../pipeline/queries";
import { getStage } from "../stage/api";
import { stageKeys } from "../stage/queries";
import { useUsers } from "../user/queries";

// Resolución de relaciones de Opportunity a nombre humano — deliberadamente
// LOCAL a este módulo, no generalizada (decisión de M5): Stage y User no
// encajan en la misma forma que Company/Contact/Pipeline (ver abajo), y no
// hay evidencia suficiente de repetición estable fuera de Opportunity para
// justificar una abstracción compartida todavía.

// Company: reutiliza tal cual el hook ya existente y probado de M3 — mismo
// patrón (useQueries + companyKeys.detail/getCompany) — sin duplicarlo ni
// modificar contact/companyResolution.ts.
export { useCompaniesByIds as useCompanyNames } from "../contact/companyResolution";

// Contact: mismo patrón estructural que useCompaniesByIds, escrito acá
// porque no existe hoy un equivalente reutilizable dentro de features/contact/.
// Deduplicado por id distinto, un fallo de resolución individual no rompe
// el resto (mismo criterio que useCompaniesByIds).
export function useContactNames(ids: readonly string[]) {
  const uniqueIds = Array.from(new Set(ids));

  const results = useQueries({
    queries: uniqueIds.map((id) => ({
      queryKey: contactKeys.detail(id),
      queryFn: () => getContact(id),
    })),
  });

  const byId = new Map<string, string>();
  uniqueIds.forEach((id, index) => {
    const contact = results[index]?.data;
    if (contact) {
      byId.set(id, `${contact.firstName} ${contact.lastName}`);
    }
  });

  return { byId, isLoading: results.some((result) => result.isLoading) };
}

// Pipeline: mismo patrón, con pipelineKeys.detail/getPipeline (existentes, M4).
export function usePipelineNames(ids: readonly string[]) {
  const uniqueIds = Array.from(new Set(ids));

  const results = useQueries({
    queries: uniqueIds.map((id) => ({
      queryKey: pipelineKeys.detail(id),
      queryFn: () => getPipeline(id),
    })),
  });

  const byId = new Map<string, string>();
  uniqueIds.forEach((id, index) => {
    const pipeline = results[index]?.data;
    if (pipeline) {
      byId.set(id, pipeline.name);
    }
  });

  return { byId, isLoading: results.some((result) => result.isLoading) };
}

// Stage: NO encaja en la forma de arriba — stageKeys.detail requiere
// (pipelineId, id), no solo id (stage/queries.ts es jerárquico por
// pipeline, ver M4). Recibe pares ya armados por el caller: cada
// Opportunity trae su propio (pipelineId, stageId).
export interface StageRef {
  pipelineId: string;
  stageId: string;
}

export function useStageNames(refs: readonly StageRef[]) {
  const uniqueRefs = Array.from(
    new Map(refs.map((ref) => [`${ref.pipelineId}:${ref.stageId}`, ref])).values(),
  );

  const results = useQueries({
    queries: uniqueRefs.map((ref) => ({
      queryKey: stageKeys.detail(ref.pipelineId, ref.stageId),
      queryFn: () => getStage(ref.stageId),
    })),
  });

  const byId = new Map<string, string>();
  uniqueRefs.forEach((ref, index) => {
    const stage = results[index]?.data;
    if (stage) {
      byId.set(ref.stageId, stage.name);
    }
  });

  return { byId, isLoading: results.some((result) => result.isLoading) };
}

// Owner: NO puede usar el patrón de arriba — no existe GET /api/users/:id
// (user/api.ts). Se resuelve con la lista completa (hasta 100 usuarios
// activos, mismo query que UserSelect — cache compartido por queryKey),
// armando un mapa id → fullName. `enabled` gatea el fetch por completo:
// false para USER (GET /api/users es ADMIN-only, ver user.routes.ts) —
// nunca se dispara la request, no se captura un 403.
export function useOwnerNames(enabled: boolean) {
  const usersQuery = useUsers(
    { pageSize: 100, isActive: true, sortBy: "fullName", sortOrder: "asc" },
    { enabled },
  );

  const byId = new Map<string, string>();
  usersQuery.data?.data.forEach((user) => byId.set(user.id, user.fullName));

  return { byId, isLoading: enabled && usersQuery.isLoading };
}
