// Lógica pura de las tres relaciones opcionales de Activity (companyId/
// contactId/opportunityId), aislada de React para poder testearla sin
// montar ningún componente.
//
// activities_related_entity_check (manual_constraints.sql) es un OR, no un
// XOR: "al menos una" de las tres, nunca "exactamente una". Company +
// Contact, Company + Opportunity, Contact + Opportunity, o las tres a la
// vez son todos estados válidos — no existe ninguna regla de exclusividad
// en el backend (activity.service.ts: validateCompanyId/validateContactId/
// validateOpportunityId son completamente independientes entre sí). Nada
// acá fuerza exclusividad.
export interface RelationState {
  companyId: string | null;
  contactId: string | null;
  opportunityId: string | null;
}

export interface RelationPatch {
  companyId?: string | null;
  contactId?: string | null;
  opportunityId?: string | null;
}

const RELATION_FIELDS = ["companyId", "contactId", "opportunityId"] as const;

// Estado final tras aplicar el formulario — mismo cálculo que hace
// updateActivity en el backend combinando "actual + payload" (activity.
// service.ts). Se usa para bloquear el submit client-side antes de la
// request cuando dejaría las tres relaciones vacías; el backend sigue
// siendo la única autoridad real (ver T-1: una carrera concurrente puede
// llegar igual al CHECK de Postgres, y ese 400 real se muestra tal cual).
export function hasAtLeastOneRelation(state: RelationState): boolean {
  return state.companyId !== null || state.contactId !== null || state.opportunityId !== null;
}

// Compara el estado original (lo que devolvió el GET) contra el estado
// actual del formulario, campo por campo, y arma el PATCH mínimo real: una
// clave se incluye SOLO si el usuario realmente la tocó. Ausencia de clave
// = "no tocar" para el backend ("companyId" in input, ver activity.
// service.ts) — no se asume que "cambiar de relación" implica limpiar la
// anterior: si el usuario agrega un Contact sin tocar la Company ya
// seleccionada, companyId ni siquiera aparece en el patch.
export function buildRelationPatch(original: RelationState, current: RelationState): RelationPatch {
  const patch: RelationPatch = {};
  for (const field of RELATION_FIELDS) {
    if (current[field] !== original[field]) {
      patch[field] = current[field];
    }
  }
  return patch;
}

// Para create: el backend no admite `null` en ninguna de las tres
// relaciones (createActivitySchema no tiene .nullable()) — un valor vacío
// se OMITE, nunca se envía null. Devuelve solo las claves con valor real.
export function buildCreateRelationFields(
  state: RelationState,
): Partial<Record<(typeof RELATION_FIELDS)[number], string>> {
  const fields: Partial<Record<(typeof RELATION_FIELDS)[number], string>> = {};
  for (const field of RELATION_FIELDS) {
    const value = state[field];
    if (value !== null) {
      fields[field] = value;
    }
  }
  return fields;
}
