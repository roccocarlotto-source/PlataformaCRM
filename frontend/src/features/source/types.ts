// Reconstruido desde el contrato real del backend (src/controllers/source.controller.ts,
// src/services/source.service.ts, src/repositories/source.repository.ts,
// prisma/schema.prisma modelo Source). No se agrega ningún campo que el backend
// no devuelva o no acepte.

export type SourceType = "WEBHOOK" | "FILE_IMPORT" | "EXTERNAL_DB";

// Los cinco campos de Contact que la ingesta sabe escribir. Es la lista real de
// CAMPOS_DE_CONTACTO en src/schemas/ingestContact.schema.ts, no una paralela:
// fieldMappingSchema restringe los destinos exactamente a este conjunto, así que
// agregar uno acá solo produciría un 400 del backend.
export const CAMPOS_DE_CONTACTO = ["firstName", "lastName", "email", "phone", "jobTitle"] as const;

export type CampoDeContacto = (typeof CAMPOS_DE_CONTACTO)[number];

// Etiquetas para mostrar. Viven acá y no en el componente para que la lista de
// destinos y sus nombres visibles no puedan divergir.
export const ETIQUETA_DE_CAMPO: Record<CampoDeContacto, string> = {
  firstName: "Nombre",
  lastName: "Apellido",
  email: "Email",
  phone: "Teléfono",
  jobTitle: "Puesto",
};

// Mapa plano: ENCABEZADO DEL ARCHIVO -> CAMPO DE Contact.
// Ver src/schemas/fieldMapping.schema.ts para la forma canónica.
export type FieldMapping = Record<string, CampoDeContacto>;

// Topes reales del backend (fieldMapping.schema.ts). Se replican para poder
// avisar antes de mandar, no para reemplazar la validación server-side.
export const MAX_COLUMNAS_MAPEADAS = 50;
export const MAX_LARGO_ENCABEZADO = 255;

// SIN `deletedAt`, y no es un olvido: SOURCE_PUBLIC_SELECT
// (src/repositories/source.repository.ts) es una proyección explícita que lo
// excluye a propósito. Es una divergencia deliberada del backend con los 8
// módulos viejos, que sí devuelven la fila cruda — tiparlo acá sería inventar un
// campo que la API nunca manda.
export interface Source {
  id: string;
  organizationId: string;
  name: string;
  type: SourceType;
  isActive: boolean;
  fieldMapping: FieldMapping | null;
  createdAt: string;
  updatedAt: string;
}

export interface SourceListPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface SourceListResponse {
  data: Source[];
  pagination: SourceListPagination;
}

export type SourceSortBy = "name" | "createdAt";
export type SortOrder = "asc" | "desc";

// Los tres filtros que acepta listQuerySchema en source.controller.ts. `isActive`
// se tipa como boolean acá aunque viaje como "true"/"false" en la query string —
// la serialización la resuelve api.ts, igual que hace contact/api.ts.
export interface SourceListQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  type?: SourceType;
  isActive?: boolean;
  sortBy?: SourceSortBy;
  sortOrder?: SortOrder;
}

// `fieldMapping` es OPCIONAL PERO NO NULLABLE en el create: createSourceSchema
// usa `fieldMappingSchema.optional()`, sin `.nullable()`. Para crear una fuente
// sin mapeo hay que OMITIR el campo — mandar null sería un 400.
//
// Y solo se acepta con `type: "FILE_IMPORT"`: el superRefine del create lo
// rechaza en cualquier otro tipo.
export interface CreateSourceInput {
  name: string;
  type: SourceType;
  isActive?: boolean;
  fieldMapping?: FieldMapping;
}

// El update NO acepta `type`: es inmutable (ver el comentario de
// updateSourceSchema en source.controller.ts). No es un Partial<CreateSourceInput>
// justamente por eso — mandarlo no lo cambiaría, lo rechazaría.
//
// `fieldMapping` acá SÍ es nullable: `fieldMappingSchema.nullable().optional()`.
// null LIMPIA el mapeo, omitirlo lo deja intacto. Un objeto vacío `{}` NO sirve
// para limpiarlo: el superRefine lo rechaza con "fieldMapping no puede ser un
// objeto vacío: para no mapear nada, omitilo o mandá null".
export interface UpdateSourceInput {
  name?: string;
  isActive?: boolean;
  fieldMapping?: FieldMapping | null;
}
