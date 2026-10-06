import type { ContactCustomFieldType } from "./types";

// Mismo tope que MAX_CAMPOS_POR_ORGANIZACION del backend
// (src/utils/camposPersonalizados.ts). Acá solo decide si se ofrece "Nuevo
// campo"; el backend lo exige igual.
export const MAX_CAMPOS_POR_ORGANIZACION = 30;

export const TIPO_DE_CAMPO_LABEL: Record<ContactCustomFieldType, string> = {
  TEXT: "Texto",
  NUMBER: "Número",
  DATE: "Fecha",
  BOOLEAN: "Sí / No",
  SELECT: "Lista de opciones",
};

export const TIPOS_DE_CAMPO = Object.keys(TIPO_DE_CAMPO_LABEL) as ContactCustomFieldType[];
