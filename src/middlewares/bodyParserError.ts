import express, { type RequestHandler } from "express";
import { AppError } from "../utils/AppError";

// ---------------------------------------------------------------------------
// Los errores de body-parser, traducidos a AppError — M-11 (a) de
// docs/auditoria-2026-08-29.md.
//
// HACE FALTA PORQUE errorHandler MANDA A 500 TODO LO QUE NO SEA AppError (a
// propósito: confiar en el `status` que trae un error de terceros es cómo se
// filtran mensajes internos al cliente). Los errores de body-parser son
// http-errors con un `type` estable documentado; sin traducción, un cuerpo
// demasiado grande o un JSON mal formado en CUALQUIER endpoint respondía 500
// —"bug nuestro"— en vez de 413/400 —"tu request está mal".
//
// UN SOLO LUGAR CON EL SWITCH SOBRE `err.type`. La ingesta ya traducía estos
// mismos errores con sus propios mensajes (mencionan INGEST_MAX_BODY_BYTES);
// el parser global los traduce con otros. Lo que comparten es la
// CLASIFICACIÓN del error, y eso es lo único que vive acá: qué `type` significa
// qué, sin mensaje ni status embebido. Cada call site decide el texto y el
// código para su categoría.
// ---------------------------------------------------------------------------

export type TipoErrorBodyParser =
  "demasiado_grande" | "cuerpo_invalido" | "codificacion_no_soportada";

// Solo lo que body-parser documenta y sabemos interpretar. request.aborted,
// stream.encoding.set y cualquier cosa que no conozcamos devuelven undefined:
// inventarle un 4xx a un error que no entendemos sería decirle al cliente que
// la culpa es suya sin saberlo.
export function clasificarErrorDeBodyParser(err: unknown): TipoErrorBodyParser | undefined {
  const tipo = (err as { type?: unknown } | null | undefined)?.type;

  switch (tipo) {
    case "entity.too.large":
      return "demasiado_grande";
    case "entity.parse.failed":
      return "cuerpo_invalido";
    case "charset.unsupported":
    case "encoding.unsupported":
      return "codificacion_no_soportada";
    default:
      return undefined;
  }
}

export interface TraduccionDeErrorDeBodyParser {
  message: string;
  statusCode: number;
}

// Envuelve un parser de body-parser y traduce sus errores según la tabla que
// le pasa el call site. Una categoría sin entrada en la tabla —o un error que
// no clasifica— sigue su camino sin traducir, para que errorHandler lo
// registre con su stack.
export function envolverParserConTraduccion(
  parser: RequestHandler,
  mensajes: Partial<Record<TipoErrorBodyParser, TraduccionDeErrorDeBodyParser>>,
): RequestHandler {
  return (req, res, next) => {
    parser(req, res, (err?: unknown) => {
      if (!err) {
        next();
        return;
      }

      const tipo = clasificarErrorDeBodyParser(err);
      const traduccion = tipo ? mensajes[tipo] : undefined;

      if (!traduccion) {
        next(err);
        return;
      }

      next(new AppError(traduccion.message, traduccion.statusCode));
    });
  };
}

// ---------------------------------------------------------------------------
// Los parsers GLOBALES de app.ts. Sin `limit` explícito a propósito: siguen
// con el default de la librería (100 KB), igual que antes. Este archivo
// traduce el error a un status correcto; decidir un límite nuevo es otra
// conversación.
// ---------------------------------------------------------------------------

export const jsonParser: RequestHandler = envolverParserConTraduccion(express.json(), {
  demasiado_grande: { message: "El cuerpo del request es demasiado grande", statusCode: 413 },
  cuerpo_invalido: { message: "El cuerpo del request no es JSON válido", statusCode: 400 },
  codificacion_no_soportada: { message: "Codificación de cuerpo no soportada", statusCode: 415 },
});

export const urlencodedParser: RequestHandler = envolverParserConTraduccion(
  express.urlencoded({ extended: true }),
  {
    demasiado_grande: { message: "El cuerpo del request es demasiado grande", statusCode: 413 },
    cuerpo_invalido: { message: "El cuerpo del request no se pudo interpretar", statusCode: 400 },
    codificacion_no_soportada: { message: "Codificación de cuerpo no soportada", statusCode: 415 },
  },
);
