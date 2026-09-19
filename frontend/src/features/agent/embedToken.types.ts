// Reconstruido desde el contrato real del backend
// (src/repositories/agentEmbedToken.repository.ts — EMBED_TOKEN_PUBLIC_SELECT,
// src/services/agentEmbedToken.service.ts, src/controllers/agentEmbedToken.controller.ts).
// No se declara ningún campo que el backend no devuelva.
//
// Archivo aparte de types.ts, y no un par de interfaces más ahí adentro: el
// token de embed es otro recurso (su propia ruta anidada, su propio CRUD),
// solo que del mismo feature. Mismo criterio por el que existe
// features/apiKey/types.ts separado del de Source.

// La proyección pública: exactamente EMBED_TOKEN_PUBLIC_SELECT. `tokenHash`
// NUNCA sale por la API —esa proyección existe justamente para que no pueda
// salir— así que no se tipa acá ni como opcional.
//
// No hay columna `status`: el estado se DERIVA de `revokedAt`, igual que en
// ApiKey (estadoDeClave).
export interface EmbedToken {
  id: string;
  organizationId: string;
  agentId: string;
  // Los primeros caracteres del token, en claro y a propósito: es lo único
  // que permite identificar cuál de varios tokens se está por revocar. NO
  // sirve para autenticar y nunca debe ofrecerse como si fuera el token.
  tokenPrefix: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

// LA ÚNICA RESPUESTA DEL SISTEMA QUE TRAE EL TOKEN EN CLARO: el 201 de
// POST /api/agents/:id/embed-tokens (CreatedEmbedToken en
// src/services/agentEmbedToken.service.ts).
//
// Tipo APARTE que extiende EmbedToken, no `token?: string` en EmbedToken —
// misma garantía que CreatedApiKey: leer `.token` sobre una fila del listado
// es un error de compilación, no un `undefined` que nadie note en runtime. El
// token solo existe donde el tipo dice que existe.
export interface CreatedEmbedToken extends EmbedToken {
  token: string;
}

// El listado NO pagina: son unas pocas filas por agente y el backend devuelve
// `{ data }` a secas (listEmbedTokensHandler), sin objeto `pagination`.
export interface EmbedTokenListResponse {
  data: EmbedToken[];
}

export type EmbedTokenStatus = "ACTIVE" | "REVOKED";

// Estado derivado, no una columna — misma función que estadoDeClave.
export function estadoDeToken(token: EmbedToken): EmbedTokenStatus {
  return token.revokedAt === null ? "ACTIVE" : "REVOKED";
}
