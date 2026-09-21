import type { ResourceType } from "./types";

// Los rótulos de ResourceType, en un solo lugar: los usan el listado (columna y
// filtro) y el formulario. Mismo criterio que contact/labels.ts.
export const RESOURCE_TYPE_LABEL: Record<ResourceType, string> = {
  PERSON: "Persona",
  ROOM: "Sala",
  CLASS: "Clase",
};

export const RESOURCE_TYPE_OPTIONS = (Object.keys(RESOURCE_TYPE_LABEL) as ResourceType[]).map(
  (value) => ({ value, label: RESOURCE_TYPE_LABEL[value] }),
);
