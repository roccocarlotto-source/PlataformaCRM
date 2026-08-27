// Reconstruido desde el contrato real del backend (src/controllers/apiKey.controller.ts,
// src/services/apiKey.service.ts, src/repositories/apiKey.repository.ts,
// prisma/schema.prisma modelo ApiKey). No se agrega ningún campo que el backend
// no devuelva o no acepte.

// La proyección pública: exactamente API_KEY_PUBLIC_SELECT
// (src/repositories/apiKey.repository.ts). `keyHash` NUNCA sale por la API —
// esa proyección existe justamente para que no pueda salir— así que no se tipa
// acá ni como opcional.
//
// No hay columna `status`: el estado se DERIVA de `revokedAt` (ver
// estadoDeClave más abajo). El backend hace lo mismo con su filtro ?status=.
export interface ApiKey {
  id: string;
  organizationId: string;
  sourceId: string;
  // Los primeros 12 caracteres de la clave, en claro y a propósito: es lo único
  // que permite identificar cuál de varias claves se está por revocar.
  keyPrefix: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// LA ÚNICA RESPUESTA DEL SISTEMA QUE TRAE LA CLAVE EN CLARO: el 201 de
// POST /api/api-keys (CreatedApiKey en src/services/apiKey.service.ts).
//
// Se modela como un tipo APARTE que extiende ApiKey, no como `key?: string` en
// ApiKey, y esa es la garantía que pide el diseño: un `ApiKey` no tiene la
// propiedad, así que leer `.key` sobre una fila del listado es un error de
// compilación, no un `undefined` en runtime que nadie note. El secreto solo
// existe donde el tipo dice que existe.
export interface CreatedApiKey extends ApiKey {
  key: string;
}

export interface ApiKeyListPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ApiKeyListResponse {
  data: ApiKey[];
  pagination: ApiKeyListPagination;
}

// Estado derivado, no una columna — el mismo par de valores que acepta el filtro
// ?status= del backend (listQuerySchema en apiKey.controller.ts).
export type ApiKeyStatus = "ACTIVE" | "REVOKED";

export type ApiKeySortBy = "createdAt" | "lastUsedAt";
export type SortOrder = "asc" | "desc";

export function estadoDeClave(apiKey: ApiKey): ApiKeyStatus {
  return apiKey.revokedAt === null ? "ACTIVE" : "REVOKED";
}

export interface ApiKeyListQuery {
  page?: number;
  pageSize?: number;
  sourceId?: string;
  status?: ApiKeyStatus;
  sortBy?: ApiKeySortBy;
  sortOrder?: SortOrder;
}

// El create tiene UN solo campo. No hay nombre, ni descripción, ni fecha de
// expiración: createApiKeySchema es `{ sourceId }` y nada más.
export interface CreateApiKeyInput {
  sourceId: string;
}
