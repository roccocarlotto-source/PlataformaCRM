import type { LifecycleStage } from "./types";

// ---------------------------------------------------------------------------
// Rótulos en español de las etapas del ciclo de vida de Contact. Mismo
// criterio que features/opportunity/labels.ts y features/vehicle/labels.ts:
// los valores son los del enum del schema (lo que viaja a la API y se guarda
// en la base, sin cambios), acá solo el texto que ve la persona, y
// Record<Enum, string> para que un valor nuevo sin rótulo no compile.
//
// Son las etapas clásicas del embudo de marketing/ventas — LEAD (sin
// calificar), MQL ("Marketing Qualified Lead", calificado por marketing),
// SQL ("Sales Qualified Lead", confirmado por ventas), CUSTOMER (ya es
// cliente) y CHURNED (fue cliente y se perdió) — que en la UI se mostraban
// crudas, sin explicación (docs/frontend-cambios-pendientes.md, ítem 9).
//
// Este mapa es la ÚNICA fuente de las opciones del <select> del formulario y
// del filtro "Etapa" del listado (vía LIFECYCLE_STAGES), y del texto del
// Badge de la columna "Etapa". El color del Badge NO vive acá: sigue en
// LIFECYCLE_BADGE_VARIANT (ContactListPage.tsx), que es una decisión del
// listado y no del rótulo.
// ---------------------------------------------------------------------------

export const LIFECYCLE_STAGE_LABELS: Record<LifecycleStage, string> = {
  LEAD: "Nuevo",
  MQL: "Calificado (Marketing)",
  SQL: "Calificado (Ventas)",
  CUSTOMER: "Cliente",
  CHURNED: "Perdido",
};

// Orden de las opciones = orden de las claves del mapa (el orden natural del
// embudo). Agregar un valor al mapa es agregar la opción en form y filtro.
export const LIFECYCLE_STAGES = Object.keys(LIFECYCLE_STAGE_LABELS) as LifecycleStage[];
