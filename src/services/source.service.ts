import type { SourceType } from "@prisma/client";
import { logger } from "../lib/logger";
import { prisma } from "../lib/prisma";
import { revokeApiKeysBySource } from "../repositories/apiKey.repository";
import {
  countSources,
  createSource as createSourceRepo,
  findManySources,
  findSourceById,
  softDeleteSource,
  updateSource as updateSourceRepo,
  type SourceSortBy,
  type SortOrder,
} from "../repositories/source.repository";
import { AppError } from "../utils/AppError";

export interface ListSourcesParams {
  page: number;
  pageSize: number;
  search?: string;
  type?: SourceType;
  isActive?: boolean;
  sortBy: SourceSortBy;
  sortOrder: SortOrder;
}

export async function listSources(
  organizationId: string,
  params: ListSourcesParams,
) {
  const { page, pageSize, sortBy, sortOrder, ...filters } = params;
  const skip = (page - 1) * pageSize;

  const [data, total] = await Promise.all([
    findManySources(
      organizationId,
      filters,
      { skip, take: pageSize },
      { sortBy, sortOrder },
    ),
    countSources(organizationId, filters),
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

export async function getSourceById(organizationId: string, id: string) {
  const source = await findSourceById(id, organizationId);
  if (!source) {
    throw new AppError("Fuente no encontrada", 404);
  }
  return source;
}

export interface CreateSourceInput {
  name: string;
  type: SourceType;
  isActive?: boolean;
}

// fieldMapping no se acepta ni acá ni en el update: el documento de ingesta la
// declara "JSONB" y nada más — ni la forma, ni las claves, ni quién la
// consume. La define el ítem 4, mirando un payload real. Hasta entonces la
// columna queda nullable y sin escribir, a propósito.
export function createSource(organizationId: string, input: CreateSourceInput) {
  return createSourceRepo({
    organizationId,
    name: input.name,
    type: input.type,
    ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
  });
}

export interface UpdateSourceInput {
  name?: string;
  isActive?: boolean;
}

export async function updateSource(
  organizationId: string,
  id: string,
  input: UpdateSourceInput,
) {
  // 404 si no existe, no es de esta organización, o ya está borrada.
  await getSourceById(organizationId, id);

  const result = await updateSourceRepo(id, organizationId, input);
  if (result.count === 0) {
    throw new AppError("Fuente no encontrada", 404);
  }

  return getSourceById(organizationId, id);
}

// Baja lógica. No hay baja física posible y es deliberado: ingestion_events ->
// sources es RESTRICT, así que una fuente que alguna vez ingestó algo no se
// puede borrar sin perder la auditoría de origen. deletedAt existe justamente
// para poder retirarla de la vista sin tocar su historial (decisión del ítem
// 2).
//
// REVOCA EN CASCADA LAS CLAVES DE LA FUENTE, en la misma transacción. Sin
// esto, retirar una integración dejaría vivas sus credenciales y el único
// obstáculo para seguir ingestando sería que authenticateApiKey (ítem 4) se
// acordara de chequear source.deletedAt — una invariante de seguridad que
// depende de la memoria de un middleware que todavía no existe. Con la
// cascada, la credencial queda muerta en los datos y el chequeo del ítem 4 es
// defensa en profundidad en vez de la única defensa.
//
// No es lo mismo que isActive = false, y la diferencia es deliberada (ver
// createApiKey en apiKey.service.ts): pausar una integración NO toca sus
// claves, porque pausar es reversible y rotar credenciales durante una pausa
// es un caso legítimo. Retirarla sí, porque es terminal.
export async function deleteSource(organizationId: string, id: string) {
  await getSourceById(organizationId, id);

  const revokedCount = await prisma.$transaction(async (tx) => {
    const result = await softDeleteSource(id, organizationId, tx);
    if (result.count === 0) {
      throw new AppError("Fuente no encontrada", 404);
    }

    const revoked = await revokeApiKeysBySource(id, organizationId, tx);
    return revoked.count;
  });

  // El endpoint responde 204 como el resto de los DELETE del proyecto, así que
  // el caller no ve este número. Queda en el log porque revocar credenciales
  // es un evento de seguridad y "cuántas murieron con esta fuente" es
  // exactamente lo que se va a querer saber después.
  if (revokedCount > 0) {
    logger.info(
      { sourceId: id, organizationId, revokedApiKeys: revokedCount },
      "Claves de ingesta revocadas en cascada al retirar la fuente",
    );
  }
}
