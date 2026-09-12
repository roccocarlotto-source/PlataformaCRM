import type { NextFunction, Request, Response } from "express";
import {
  RECHAZO_WIDGET,
  recordEmbedTokenUsage,
  resolveWidgetAuthContext,
} from "../services/widgetAuth.service";
import { AppError } from "../utils/AppError";
import { asyncHandler } from "../utils/asyncHandler";
import { countRawHeaderOccurrences } from "../utils/rawHeaders";

// ---------------------------------------------------------------------------
// TERCER camino de autenticación (docs/ai-agent-architecture.md, nota del
// paso 5b bajo §6). No modifica, no envuelve y no comparte nada con
// `authenticate` ni con `authenticateApiKey`: un visitante anónimo del sitio
// de un cliente no tiene usuario, y el token que presenta es público por
// diseño — de MENOR privilegio que una API key de ingesta.
//
// Se monta SOLO en la ruta pública del widget, y esa ruta NO monta `authorize`:
// no hay usuario, no hay rol y no hay membresía. Un embed token no puede hacer
// nada más que mandarle mensajes a SU agente — administrarse a sí mismo es el
// camino del JWT con rol ADMIN (agentEmbedToken.routes.ts).
// ---------------------------------------------------------------------------

// EL TOKEN VIAJA EXCLUSIVAMENTE ACÁ, nunca en la URL ni en la query, por el
// mismo motivo exacto que x-api-key (leer el bloque de authenticateApiKey.ts):
// pino escribe req.url/req.query/req.params en cada línea de log y `redact`
// no llega ahí; el header sí está redactado en lib/logger.ts.
//
// Lo que SÍ va en la URL es el :agentId, y no es una contradicción: es un
// identificador público que existe para que el preflight CORS —que nunca
// trae el valor de un header custom— pueda decidir (punto 1 de la nota de 5b).
export const EMBED_TOKEN_HEADER = "x-embed-token";

export const authenticateEmbedToken = asyncHandler(
  async (req: Request, _res: Response, next: NextFunction) => {
    // B-25: un header repetido no llega como array —Node lo une con ", "— y la
    // única evidencia es req.rawHeaders. Mismo tratamiento que x-api-key: no
    // se elige uno ni se acepta la concatenación, y el rechazo es el mismo
    // 401 genérico de todos los rechazos.
    if (countRawHeaderOccurrences(req.rawHeaders, EMBED_TOKEN_HEADER) > 1) {
      throw new AppError(RECHAZO_WIDGET, 401);
    }

    const header = req.headers[EMBED_TOKEN_HEADER] as string | undefined;

    if (header === undefined || header.length === 0) {
      throw new AppError(RECHAZO_WIDGET, 401);
    }

    // req.params.agentId lo popula Express al montar la ruta con el parámetro
    // con nombre (publicWidget.routes.ts). Se pasa tal cual: si no es un UUID,
    // no puede coincidir con el agentId de ningún token y cae en el mismo 401
    // genérico — el 400 de validación del controller nunca llega a correr
    // para un token que no autentica, y así no hay diferencia observable
    // entre "agentId mal formado" y "agentId de otro agente".
    const agentIdFromUrl = String(req.params.agentId ?? "");

    // `header` se pasa CRUDO, sin trim (restricción 1 de utils/apiKey.ts).
    const widgetAuth = await resolveWidgetAuthContext(agentIdFromUrl, header, req.headers.origin);

    req.widgetAuth = widgetAuth;

    // Después de resolver, nunca antes: no se registra actividad de una
    // credencial que no se aceptó. Awaited y no fatal.
    await recordEmbedTokenUsage(widgetAuth);

    next();
  },
);
