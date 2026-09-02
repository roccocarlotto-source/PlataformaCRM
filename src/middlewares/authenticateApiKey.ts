import type { NextFunction, Request, Response } from "express";
import { recordApiKeyUsage, resolveIngestContext } from "../services/ingestAuth.service";
import { AppError } from "../utils/AppError";
import { asyncHandler } from "../utils/asyncHandler";
import { countRawHeaderOccurrences } from "../utils/rawHeaders";

// ---------------------------------------------------------------------------
// SEGUNDO camino de autenticación (docs/ingestion-architecture.md §3). No
// modifica, no envuelve y no comparte nada con `authenticate`: una landing page
// pública no tiene usuario, y forzar el camino del JWT terminaría en un userId
// falso o nullable (§8).
//
// Se monta SOLO en las rutas de ingesta, y esas rutas NO montan `authorize`: no
// hay usuario, no hay rol y no hay membresía que chequear. Una API key no puede
// hacer nada más que ingestar — administrarse a sí misma es el camino del JWT
// con rol ADMIN (ver apiKey.routes.ts).
// ---------------------------------------------------------------------------

// LA CLAVE VIAJA EXCLUSIVAMENTE ACÁ. Nunca en la URL, nunca en query string,
// nunca en un path param, y esto no es una convención de estilo.
//
// Los serializers por defecto de pino-http (pino-std-serializers) escriben
// req.url, req.query y req.params en cada línea de log. La config de `redact`
// de lib/logger.ts cubre HEADERS —incluido este— pero no llega a la URL: no
// puede, redact opera sobre rutas del objeto ya serializado y la querystring es
// texto adentro de un string. Aceptar la clave por query sería dejarla en claro
// en el log del primer request, en un formato que además se archiva y se
// reenvía a cualquier agregador.
//
// logger.test.ts tiene un control negativo que deja esa limitación escrita en
// la suite, y el test de integración de esta etapa verifica sobre una línea de
// log REAL que la clave no aparece.
const API_KEY_HEADER = "x-api-key";

export const authenticateApiKey = asyncHandler(
  async (req: Request, _res: Response, next: NextFunction) => {
    // B-25: un header repetido NO llega como array — Node une los valores con
    // ", " en un solo string antes de que ningún middleware los vea (el array
    // existe solo para set-cookie), así que el `typeof !== "string"` que
    // había acá era código muerto. La única evidencia del repetido es
    // req.rawHeaders (ver utils/rawHeaders.ts). No se elige una ni se acepta
    // la concatenación: no hay forma de saber cuál quiso mandar el emisor, y
    // "a, b" no es una credencial que nadie presentó tal cual. (Antes la
    // concatenación terminaba en 401 igual, por no matchear ninguna clave
    // real; ahora el rechazo es explícito y por el motivo verdadero, con el
    // mismo 401 genérico de todos los rechazos.)
    if (countRawHeaderOccurrences(req.rawHeaders, API_KEY_HEADER) > 1) {
      throw new AppError("Credencial de ingesta inválida", 401);
    }

    // Con 0 o 1 ocurrencia garantizada arriba, el valor normalizado es
    // siempre string o undefined — el cast documenta lo que el tipo genérico
    // de req.headers no sabe.
    const header = req.headers[API_KEY_HEADER] as string | undefined;

    if (header === undefined || header.length === 0) {
      throw new AppError("Credencial de ingesta inválida", 401);
    }

    // `header` se pasa CRUDO, sin trim. Node ya descarta el whitespace
    // opcional que el propio protocolo HTTP define alrededor del valor; lo que
    // quede adentro es parte de la cadena presentada, y una cadena que no es
    // exactamente la que generamos no es la clave. Ver la restricción 1 del
    // encabezado de utils/apiKey.ts.
    const ingest = await resolveIngestContext(header);

    req.ingest = ingest;

    // Después de resolver, nunca antes: no se registra actividad de una
    // credencial que no se aceptó. Awaited y no fatal — ver recordApiKeyUsage.
    await recordApiKeyUsage(ingest);

    next();
  },
);
