import type { Prisma } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";

// ---------------------------------------------------------------------------
// Tokens de embed del widget del canal Web (paso 5a). Calcado de
// apiKey.repository.ts: misma proyección pública que impide que el hash salga
// por la API, mismo CAS para revocar, mismo throttle para lastUsedAt.
// ---------------------------------------------------------------------------

// LA PROYECCIÓN QUE IMPIDE QUE tokenHash SALGA POR LA API. Todas las lecturas
// administrativas la usan; la única que lee por hash (findEmbedTokenByHash)
// tampoco lo devuelve. Exponer material criptográfico requiere editar esta
// constante a propósito.
const EMBED_TOKEN_PUBLIC_SELECT = {
  id: true,
  organizationId: true,
  agentId: true,
  tokenPrefix: true,
  lastUsedAt: true,
  revokedAt: true,
  createdAt: true,
} satisfies Prisma.AgentEmbedTokenSelect;

export type PublicEmbedToken = Prisma.AgentEmbedTokenGetPayload<{
  select: typeof EMBED_TOKEN_PUBLIC_SELECT;
}>;

// Los tokens de UN agente, del más nuevo al más viejo. Sin paginación: son
// unas pocas filas por agente (uno o dos activos durante una rotación, más
// los revocados como auditoría) y el índice (organization_id, agent_id,
// created_at) ya los trae ordenados. Un token revocado SIGUE listándose: es
// información de auditoría que el ADMIN quiere ver.
export function findEmbedTokensByAgent(organizationId: string, agentId: string, db: Db = prisma) {
  return db.agentEmbedToken.findMany({
    where: { organizationId, agentId },
    select: EMBED_TOKEN_PUBLIC_SELECT,
    orderBy: { createdAt: "desc" },
  });
}

// agentId además de organizationId: un token se administra desde la ruta de
// SU agente (/agents/:id/embed-tokens/:tokenId), y el token de otro agente
// de la misma organización no existe para esa ruta.
export function findEmbedTokenById(
  id: string,
  organizationId: string,
  agentId: string,
  db: Db = prisma,
) {
  return db.agentEmbedToken.findFirst({
    where: { id, organizationId, agentId },
    select: EMBED_TOKEN_PUBLIC_SELECT,
  });
}

export interface CreateEmbedTokenData {
  organizationId: string;
  agentId: string;
  tokenHash: string;
  tokenPrefix: string;
}

// Devuelve la proyección pública: el token en claro NO pasa por acá, lo agrega
// el service al objeto de respuesta y muere ahí.
export function createEmbedToken(data: CreateEmbedTokenData, db: Db = prisma) {
  return db.agentEmbedToken.create({ data, select: EMBED_TOKEN_PUBLIC_SELECT });
}

// Compare-and-swap, calcado de revokeApiKeyConditional: la transición solo se
// aplica si el token sigue sin revocar en el momento exacto de la escritura.
// `count === 0` = otra revocación ganó la carrera, o la fila no es de esta
// organización/agente; el caller SIEMPRE debe verificar count.
export function revokeEmbedTokenConditional(
  id: string,
  organizationId: string,
  agentId: string,
  db: Db = prisma,
) {
  return db.agentEmbedToken.updateMany({
    where: { id, organizationId, agentId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

// Revoca de una todos los tokens activos de un agente. La usa deleteAgent
// dentro de su transacción, con el mismo criterio que revokeApiKeysBySource:
// dar de baja un agente tiene que matar sus credenciales, no dejarlas vivas
// esperando a que el 5b se acuerde de chequear agent.deletedAt.
export function revokeEmbedTokensByAgent(agentId: string, organizationId: string, db: Db = prisma) {
  return db.agentEmbedToken.updateMany({
    where: { agentId, organizationId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

// ---------------------------------------------------------------------------
// El camino de autenticación del widget (5b). Estas dos funciones son las
// únicas del repositorio que no sirven a la administración de tokens.
// ---------------------------------------------------------------------------

// La proyección de autenticación. NO INCLUYE tokenHash aunque la búsqueda sea
// POR tokenHash: quien llama ya lo tiene. Trae del Agent lo que el 5b
// necesita decidir en el mismo round-trip —si sigue activo y vivo, sus
// orígenes permitidos, su sucursal y sus canales— y nada más.
const EMBED_TOKEN_AUTH_SELECT = {
  id: true,
  organizationId: true,
  agentId: true,
  revokedAt: true,
  agent: {
    select: {
      isActive: true,
      deletedAt: true,
      allowedOrigins: true,
      branchId: true,
      channels: true,
    },
  },
} satisfies Prisma.AgentEmbedTokenSelect;

export type EmbedTokenForAuth = Prisma.AgentEmbedTokenGetPayload<{
  select: typeof EMBED_TOKEN_AUTH_SELECT;
}>;

// Búsqueda por igualdad sobre token_hash, UNIQUE global — y global porque en
// este punto todavía no se conoce la organización. Sin comparación en tiempo
// constante, por lo mismo que findApiKeyByHash: la defensa está en la
// entropía del token, no acá.
export function findEmbedTokenByHash(tokenHash: string, db: Db = prisma) {
  return db.agentEmbedToken.findUnique({
    where: { tokenHash },
    select: EMBED_TOKEN_AUTH_SELECT,
  });
}

// Registra el uso del token con la MISMA granularidad que ApiKey.lastUsedAt:
// la fila se escribe solo si lastUsedAt es null o anterior a `noUsadaDesde`
// (LAST_USED_AT_GRANULARITY_MS de ingestAuth.service.ts, un minuto), así que
// un widget con mucho tráfico produce una escritura por ventana, no una por
// mensaje. El porqué completo —MVCC, versiones muertas, la condición dentro
// del UPDATE en vez de un caché en memoria— está en ingestAuth.service.ts y
// en touchApiKeyLastUsed; no se repite. El caller SIEMPRE debe tolerar
// count === 0: es el caso normal.
export function touchEmbedTokenLastUsed(
  id: string,
  organizationId: string,
  noUsadaDesde: Date,
  db: Db = prisma,
) {
  return db.agentEmbedToken.updateMany({
    where: {
      id,
      organizationId,
      revokedAt: null,
      OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: noUsadaDesde } }],
    },
    data: { lastUsedAt: new Date() },
  });
}
