import { useQueries } from "@tanstack/react-query";
import { getContact } from "../contact/api";
import { contactKeys } from "../contact/queries";
import { USUARIOS_PARA_ELEGIR, useUsers } from "../user/queries";
import type { OpportunityListItem } from "./types";

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

  // Los ids que todavía se están pidiendo: el caller muestra "…" en vez del
  // fallback de "no se pudo resolver" (ver textoDeLaRelacion).
  const cargando = new Set(uniqueIds.filter((_, index) => results[index]?.isLoading));

  return { byId, cargando, isLoading: results.some((result) => result.isLoading) };
}

// El listado de oportunidades (tabla y embudo) NO usa los hooks de arriba: cada
// fila de GET /api/opportunities ya trae el nombre de su contacto, empresa,
// proceso y etapa (antes era un GET por cada uno, una ronda más de requests).
// Mismo resultado que con el GET por id: sin la relación, null (no se
// muestra); con la relación pero borrada, "—". La empresa, además, solo con el
// módulo empresas (sin él el GET daba 403 y se veía "—").
export function nombreDelContacto(opportunity: OpportunityListItem): string | null {
  if (!opportunity.contactId) return null;
  return opportunity.contact
    ? `${opportunity.contact.firstName} ${opportunity.contact.lastName}`
    : "—";
}

export function nombreDeLaEmpresa(
  opportunity: OpportunityListItem,
  conEmpresas: boolean,
): string | null {
  if (!opportunity.companyId) return null;
  return conEmpresas && opportunity.company ? opportunity.company.name : "—";
}

// Owner: NO puede usar el patrón de arriba — no existe GET /api/users/:id
// (user/api.ts). Se resuelve con la lista completa (hasta 100 usuarios
// activos, mismo query que UserSelect — cache compartido por queryKey),
// armando un mapa id → fullName. `enabled` gatea el fetch por completo:
// false para USER (GET /api/users es ADMIN-only, ver user.routes.ts) —
// nunca se dispara la request, no se captura un 403.
export function useOwnerNames(enabled: boolean) {
  const usersQuery = useUsers(USUARIOS_PARA_ELEGIR, { enabled });

  const byId = new Map<string, string>();
  usersQuery.data?.data.forEach((user) => byId.set(user.id, user.fullName));

  return { byId, isLoading: enabled && usersQuery.isLoading };
}
