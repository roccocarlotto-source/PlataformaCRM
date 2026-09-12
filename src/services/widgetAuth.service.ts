import { logger } from "../lib/logger";
import {
  findEmbedTokenByHash,
  touchEmbedTokenLastUsed,
} from "../repositories/agentEmbedToken.repository";
import type { WidgetAuthContext } from "../types/widgetAuth";
import { AppError } from "../utils/AppError";
import { hashEmbedToken } from "../utils/agentEmbedToken";
import { normalizeOrigin } from "../utils/origin";
import { LAST_USED_AT_GRANULARITY_MS } from "./ingestAuth.service";

// ---------------------------------------------------------------------------
// Resolución de un embed token presentado -> WidgetAuthContext (paso 5b,
// nota fechada bajo §6 de docs/ai-agent-architecture.md). Es al widget lo que
// resolveIngestContext es a la ingesta: el único lugar donde la credencial se
// traduce en permiso, siempre contra Postgres.
// ---------------------------------------------------------------------------

// UN SOLO MENSAJE Y UN SOLO STATUS PARA TODOS LOS RECHAZOS, exactamente el
// mismo criterio que RECHAZO en ingestAuth.service.ts (leer ese bloque: es el
// argumento completo y no se repite acá). Los siete casos que se rechazan —
// header ausente, token inexistente, token revocado, agente inactivo o
// borrado, agentId del token distinto del de la URL, Origin ausente o no
// registrado— responden esto y 401, sin ninguna diferencia observable. Es un
// endpoint público sin usuario detrás: cualquier diferencia lo convierte en
// un oráculo para enumerar tokens válidos, dominios registrados o si un
// agente existe. El motivo real se loguea server-side y nada más.
export const RECHAZO_WIDGET = "Credencial de widget inválida";

export async function resolveWidgetAuthContext(
  agentIdFromUrl: string,
  presentedToken: string,
  originHeader: string | undefined,
): Promise<WidgetAuthContext> {
  // hashEmbedToken recibe LOS BYTES EXACTOS del header: sin trim ni
  // normalización, por lo mismo que hashApiKey en resolveIngestContext.
  const token = await findEmbedTokenByHash(hashEmbedToken(presentedToken));

  if (!token) {
    // Sin ningún id que reportar y sin nada del token presentado en el log,
    // ni siquiera su prefijo.
    logger.warn({ motivo: "token inexistente", agentIdFromUrl }, "Widget rechazado");
    throw new AppError(RECHAZO_WIDGET, 401);
  }

  // A partir de acá sí se loguea el motivo real y los ids: es información que
  // el operador necesita y que nunca sale en la respuesta HTTP.
  const origin = originHeader === undefined ? null : normalizeOrigin(originHeader);

  const motivo =
    token.revokedAt !== null
      ? "token revocado"
      : token.agent.deletedAt !== null
        ? "agente borrado"
        : !token.agent.isActive
          ? "agente inactivo"
          : token.agentId !== agentIdFromUrl
            ? "agentId de la URL no coincide con el del token"
            : originHeader === undefined
              ? "Origin ausente"
              : origin === null
                ? "Origin ilegible"
                : !token.agent.allowedOrigins.includes(origin)
                  ? "Origin no registrado en allowedOrigins"
                  : null;

  if (motivo !== null) {
    logger.warn(
      {
        motivo,
        embedTokenId: token.id,
        organizationId: token.organizationId,
        agentId: token.agentId,
        agentIdFromUrl,
        // El Origin sí se loguea: no es un secreto, es lo que el navegador
        // manda en claro, y es lo que el operador necesita para ver qué
        // dominio le falta registrar.
        origin: originHeader ?? null,
      },
      "Widget rechazado",
    );
    throw new AppError(RECHAZO_WIDGET, 401);
  }

  // Los chequeos de deletedAt/isActive son DEFENSA EN PROFUNDIDAD: deleteAgent
  // ya revoca los tokens en cascada (5a), así que un token de un agente
  // borrado debería haber salido por "token revocado". Que igual se mire acá
  // es lo que hace que el invariante no dependa de que alguien recuerde
  // mantener la cascada. isActive, en cambio, NO revoca nada (apagar un
  // agente es reversible), así que este es el único lugar que lo hace valer.
  return {
    organizationId: token.organizationId,
    agentId: token.agentId,
    branchId: token.agent.branchId,
    embedTokenId: token.id,
  };
}

// Registra el uso del token con la MISMA granularidad que ApiKey.lastUsedAt
// (LAST_USED_AT_GRANULARITY_MS, reusada y no copiada: es la misma decisión y
// el mismo argumento MVCC, escrito en ingestAuth.service.ts). Awaited pero no
// fatal, igual que recordApiKeyUsage: lastUsedAt es telemetría de credencial,
// no parte del contrato del widget.
export async function recordEmbedTokenUsage(ctx: WidgetAuthContext): Promise<void> {
  const corte = new Date(Date.now() - LAST_USED_AT_GRANULARITY_MS);

  try {
    await touchEmbedTokenLastUsed(ctx.embedTokenId, ctx.organizationId, corte);
  } catch (err) {
    logger.error(
      { err, embedTokenId: ctx.embedTokenId, organizationId: ctx.organizationId },
      "No se pudo registrar lastUsedAt del token de embed",
    );
  }
}
