import { Prisma } from "@prisma/client";
import { logger } from "../lib/logger";
import {
  countApiKeys,
  createApiKey as createApiKeyRepo,
  findApiKeyById,
  findManyApiKeys,
  revokeApiKeyConditional,
  type ApiKeySortBy,
  type ApiKeyStatus,
  type PublicApiKey,
  type SortOrder,
} from "../repositories/apiKey.repository";
import { findSourceById } from "../repositories/source.repository";
import { AppError } from "../utils/AppError";
import { generateApiKey } from "../utils/apiKey";

export interface ListApiKeysParams {
  page: number;
  pageSize: number;
  sourceId?: string;
  status?: ApiKeyStatus;
  sortBy: ApiKeySortBy;
  sortOrder: SortOrder;
}

export async function listApiKeys(
  organizationId: string,
  params: ListApiKeysParams,
) {
  const { page, pageSize, sortBy, sortOrder, ...filters } = params;
  const skip = (page - 1) * pageSize;

  const [data, total] = await Promise.all([
    findManyApiKeys(
      organizationId,
      filters,
      { skip, take: pageSize },
      { sortBy, sortOrder },
    ),
    countApiKeys(organizationId, filters),
  ]);

  return {
    data,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
    },
  };
}

export interface CreateApiKeyInput {
  sourceId: string;
}

// El único lugar del sistema donde existe una clave en claro.
//
// `key` se agrega al objeto de respuesta y muere con el request: no se
// persiste, no se vuelve a poder consultar, y el repositorio nunca la ve —
// solo su hash. Esto es lo que hace que la promesa "se muestra una sola vez"
// sea una propiedad del diseño y no una convención que alguien pueda olvidar.
//
// No adjuntar `key` a `req`, no meterla en un AppError, no loguearla ni en
// debug. Ver el bloque de utils/apiKey.ts para el porqué y para las dos
// restricciones que hereda el ítem 4.
export type CreatedApiKey = PublicApiKey & { key: string };

export async function createApiKey(
  organizationId: string,
  input: CreateApiKeyInput,
): Promise<CreatedApiKey> {
  // findSourceById filtra deletedAt: null, así que una fuente retirada da 404
  // — para la API no existe. Una fuente PAUSADA (isActive: false) sí acepta
  // claves nuevas a propósito: pausar la ingesta no debería impedir rotar
  // credenciales, y el chequeo de isActive es del ítem 4, en el momento de
  // ingestar, no acá.
  const source = await findSourceById(input.sourceId, organizationId);
  if (!source) {
    throw new AppError("Fuente no encontrada", 404);
  }

  const generated = generateApiKey();

  let apiKey: PublicApiKey;
  try {
    apiKey = await createApiKeyRepo({
      organizationId,
      sourceId: input.sourceId,
      keyHash: generated.keyHash,
      keyPrefix: generated.keyPrefix,
    });
  } catch (err) {
    // key_hash es el único índice único de la tabla, así que un P2002 acá solo
    // puede ser una colisión de SHA-256 sobre dos claves distintas de 256 bits
    // — probabilidad ~2^-128, o sea: si esto pasa, no hubo mala suerte, se
    // rompió randomBytes. Reintentar entraría en un loop contra un generador
    // averiado, así que se falla ruidoso y se deja el rastro.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      logger.error(
        { organizationId, sourceId: input.sourceId },
        "Colisión de keyHash al crear una API key — revisar la generación de claves, no es mala suerte",
      );
      throw new AppError("No se pudo generar la clave", 500);
    }
    throw err;
  }

  return { ...apiKey, key: generated.key };
}

export async function revokeApiKey(organizationId: string, id: string) {
  const apiKey = await findApiKeyById(id, organizationId);
  if (!apiKey) {
    throw new AppError("Clave no encontrada", 404);
  }

  // Chequeo rápido de UX (mensaje específico en el caso común, no
  // concurrente) — NO es la defensa real. La defensa es la escritura
  // condicional de abajo, que solo transiciona si revokedAt sigue en null en
  // el momento exacto del UPDATE, sin importar lo que este SELECT haya visto
  // un instante antes.
  if (apiKey.revokedAt) {
    throw new AppError("Esta clave ya fue revocada", 409);
  }

  const result = await revokeApiKeyConditional(id, organizationId);
  if (result.count === 0) {
    // El CAS ya decidió — count === 0 es la única fuente de verdad sobre si la
    // operación tuvo éxito, este re-read NUNCA participa de esa decisión.
    // Perdió una carrera real: otra revocación (directa, o la cascada de
    // deleteSource) ganó entre el SELECT de arriba y esta escritura. El
    // re-read es solo para reportar la razón específica.
    const current = await findApiKeyById(id, organizationId);
    if (!current) {
      throw new AppError("Clave no encontrada", 404);
    }
    throw new AppError("Esta clave ya fue revocada", 409);
  }

  const updated = await findApiKeyById(id, organizationId);
  if (!updated) {
    throw new AppError("Clave no encontrada tras revocar", 500);
  }
  return updated;
}
