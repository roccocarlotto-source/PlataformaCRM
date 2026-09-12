import { Prisma } from "@prisma/client";
import { logger } from "../lib/logger";
import {
  createEmbedToken as createEmbedTokenRepo,
  findEmbedTokenById,
  findEmbedTokensByAgent,
  revokeEmbedTokenConditional,
  type PublicEmbedToken,
} from "../repositories/agentEmbedToken.repository";
import { AppError } from "../utils/AppError";
import { generateEmbedToken } from "../utils/agentEmbedToken";
import { getAgentById } from "./agent.service";

// ---------------------------------------------------------------------------
// Administración de los tokens de embed del widget (paso 5a). Calcado de
// apiKey.service.ts. Lo que NO está acá es la resolución de un token
// presentado por el widget (buscar por hash, chequear revokedAt, el Agent y
// el Origin): eso es el camino de autenticación del 5b.
// ---------------------------------------------------------------------------

// El único lugar del sistema donde existe un token de embed en claro. `token`
// se agrega al objeto de respuesta y muere con el request: no se persiste, no
// se vuelve a poder consultar, y el repositorio nunca lo ve — solo su hash.
export type CreatedEmbedToken = PublicEmbedToken & { token: string };

export async function createEmbedToken(
  organizationId: string,
  agentId: string,
): Promise<CreatedEmbedToken> {
  // 404 si el agente no existe, no es de esta organización o está borrado.
  // Un agente DESACTIVADO (isActive: false) sí acepta tokens nuevos, a
  // propósito: apagar el agente no debería impedir rotar credenciales, y el
  // chequeo de isActive es del 5b, en el momento de recibir un mensaje. Mismo
  // criterio que una Source pausada en createApiKey.
  await getAgentById(organizationId, agentId);

  const generated = generateEmbedToken();

  let embedToken: PublicEmbedToken;
  try {
    embedToken = await createEmbedTokenRepo({
      organizationId,
      agentId,
      tokenHash: generated.tokenHash,
      tokenPrefix: generated.tokenPrefix,
    });
  } catch (err) {
    // token_hash es el único índice único de la tabla: un P2002 solo puede
    // ser una colisión de SHA-256 entre dos tokens de 256 bits, o sea que se
    // rompió randomBytes. Se falla ruidoso, no se reintenta (ver el mismo
    // caso en createApiKey).
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      logger.error(
        { organizationId, agentId },
        "Colisión de tokenHash al crear un token de embed — revisar la generación, no es mala suerte",
      );
      throw new AppError("No se pudo generar el token", 500);
    }
    throw err;
  }

  return { ...embedToken, token: generated.token };
}

// Nunca devuelve el hash ni el token: solo tokenPrefix + metadata.
export async function listEmbedTokens(organizationId: string, agentId: string) {
  await getAgentById(organizationId, agentId);
  return findEmbedTokensByAgent(organizationId, agentId);
}

export async function revokeEmbedToken(organizationId: string, agentId: string, tokenId: string) {
  await getAgentById(organizationId, agentId);

  const embedToken = await findEmbedTokenById(tokenId, organizationId, agentId);
  if (!embedToken) {
    throw new AppError("Token no encontrado", 404);
  }

  // Chequeo rápido de UX; la defensa real es el CAS de abajo.
  if (embedToken.revokedAt) {
    throw new AppError("Este token ya fue revocado", 409);
  }

  const result = await revokeEmbedTokenConditional(tokenId, organizationId, agentId);
  if (result.count === 0) {
    // Perdió una carrera real: otra revocación (directa, o la cascada de
    // deleteAgent) ganó entre el SELECT y esta escritura.
    const current = await findEmbedTokenById(tokenId, organizationId, agentId);
    if (!current) {
      throw new AppError("Token no encontrado", 404);
    }
    throw new AppError("Este token ya fue revocado", 409);
  }

  const updated = await findEmbedTokenById(tokenId, organizationId, agentId);
  if (!updated) {
    throw new AppError("Token no encontrado tras revocar", 500);
  }
  return updated;
}
