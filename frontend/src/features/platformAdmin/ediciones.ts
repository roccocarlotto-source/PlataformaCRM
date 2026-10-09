import type { OrganizationEdition } from "./types";

// Cómo se muestra cada edición (docs/ediciones.md §1.1) en las pantallas de
// Plataforma.
export const NOMBRE_DE_EDICION: Record<OrganizationEdition, string> = {
  COMPLETA: "Completa",
  ESENCIAL: "Esencial",
};
