import { logger } from "../lib/logger";
import { findApiKeyByHash, touchApiKeyLastUsed } from "../repositories/apiKey.repository";
import type { IngestContext } from "../types/ingest";
import { AppError } from "../utils/AppError";
import { hashApiKey } from "../utils/apiKey";

// ---------------------------------------------------------------------------
// Resolución de una API key presentada -> IngestContext
// (docs/ingestion-architecture.md §3). Es a la ingesta lo que
// resolveAuthContext es al JWT: el único lugar donde una credencial se traduce
// en permiso, siempre contra Postgres.
// ---------------------------------------------------------------------------

// UN SOLO MENSAJE Y UN SOLO STATUS PARA TODOS LOS RECHAZOS.
//
// No se distingue clave inexistente de revocada, de Source pausada, de Source
// retirada, ni de clave de otra organización. Cualquier diferencia observable
// —el texto, el status, incluso una latencia sistemáticamente distinta—
// convierte al endpoint en un oráculo: con él se puede confirmar que una clave
// existió alguna vez, o enumerar qué fuentes están activas, sin tener ninguna
// credencial válida.
//
// Es una constante y no un literal repetido justamente para que no puedan
// divergir: agregar mañana un rechazo nuevo con su propio mensaje sería la
// forma natural de romper esto sin darse cuenta.
const RECHAZO = "Credencial de ingesta inválida";

// Cada cuánto, como mucho, se escribe ApiKey.lastUsedAt.
//
// EL PROBLEMA QUE RESUELVE: lastUsedAt es la primera columna del proyecto que
// se escribe en el camino caliente. Escribirla en cada request significaría un
// UPDATE por request SOBRE LA MISMA FILA — cada uno crea una versión nueva de
// la tupla (MVCC), y todos serializan contra el mismo row lock. Una fuente que
// manda 50 eventos por segundo produciría 50 versiones muertas por segundo de
// una fila cuya información útil es "se usó hace poco".
//
// LA GRANULARIDAD ES EL VALOR DEL DATO. lastUsedAt existe para que un ADMIN vea
// en la UI cuál de sus claves sigue viva y cuál puede revocar. Para esa
// pregunta, un minuto de resolución es indistinguible de un milisegundo.
//
// CÓMO SE APLICA: no con un caché en memoria del proceso, sino con la condición
// dentro del propio UPDATE (`lastUsedAt IS NULL OR lastUsedAt < corte`, ver
// touchApiKeyLastUsed). Un UPDATE que no matchea ninguna fila no crea versión
// ni toma lock, así que el costo por request queda en una búsqueda por índice.
// Y a diferencia de un caché en memoria, la ventana sigue valiendo con varias
// instancias del proceso: la condición la evalúa Postgres, que es uno solo.
export const LAST_USED_AT_GRANULARITY_MS = 60 * 1000;

export async function resolveIngestContext(presentedKey: string): Promise<IngestContext> {
  // hashApiKey recibe LOS BYTES EXACTOS del header: sin trim, sin toLowerCase,
  // sin normalización Unicode. El hash guardado es sobre la cadena exacta que
  // generamos, así que cualquier transformación acá haría que dos cadenas
  // distintas resolvieran a la misma fila — lo contrario de lo que el hash
  // está haciendo (utils/apiKey.ts, y nota 9.3 del documento).
  const apiKey = await findApiKeyByHash(hashApiKey(presentedKey));

  if (!apiKey) {
    // Sin apiKeyId que reportar y sin nada de la clave presentada en el log,
    // ni siquiera su prefijo: una clave que no existe acá puede ser una clave
    // válida en otro lado.
    logger.warn({ motivo: "clave inexistente" }, "Ingesta rechazada");
    throw new AppError(RECHAZO, 401);
  }

  // A partir de acá sí se loguea el motivo real y el apiKeyId: es información
  // que el operador necesita y que nunca sale en la respuesta HTTP. La
  // asimetría entre lo que se registra y lo que se responde es deliberada.
  const motivo =
    apiKey.revokedAt !== null
      ? "clave revocada"
      : apiKey.source.deletedAt !== null
        ? "fuente retirada"
        : !apiKey.source.isActive
          ? "fuente pausada"
          : null;

  if (motivo !== null) {
    logger.warn(
      {
        motivo,
        apiKeyId: apiKey.id,
        organizationId: apiKey.organizationId,
        sourceId: apiKey.sourceId,
      },
      "Ingesta rechazada",
    );
    throw new AppError(RECHAZO, 401);
  }

  // El chequeo de deletedAt de arriba es DEFENSA EN PROFUNDIDAD, no la única
  // defensa: retirar una Source ya revoca sus claves en cascada, en la misma
  // transacción (deleteSource en source.service.ts, nota 9.4). Una clave de una
  // fuente retirada debería haber salido por "clave revocada". Que igual se
  // mire acá es lo que hace que el invariante no dependa de que alguien
  // recuerde mantener la cascada.
  return {
    organizationId: apiKey.organizationId,
    sourceId: apiKey.sourceId,
    apiKeyId: apiKey.id,
  };
}

// Registra el uso de la clave. Se AWAITEA pero NO PUEDE HACER FALLAR EL
// REQUEST.
//
// Awaited: es una sola sentencia indexada sobre un request que ya hace un
// SELECT y un INSERT, y a cambio el dato queda escrito antes de que se responda
// — observable, verificable en un test, sin promesas colgando después de que el
// handler terminó.
//
// No fatal: lastUsedAt es telemetría de credencial, no parte del contrato de la
// ingesta. Un evento válido no puede perderse porque falló una escritura de
// conveniencia; el error se registra y el request sigue.
export async function recordApiKeyUsage(ctx: IngestContext): Promise<void> {
  const corte = new Date(Date.now() - LAST_USED_AT_GRANULARITY_MS);

  try {
    await touchApiKeyLastUsed(ctx.apiKeyId, ctx.organizationId, corte);
  } catch (err) {
    logger.error(
      { err, apiKeyId: ctx.apiKeyId, organizationId: ctx.organizationId },
      "No se pudo registrar lastUsedAt de la clave de ingesta",
    );
  }
}
