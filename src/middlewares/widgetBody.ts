import express, { type NextFunction, type Request, type Response } from "express";
import { AppError } from "../utils/AppError";
import { clasificarErrorDeBodyParser } from "./bodyParserError";

// ---------------------------------------------------------------------------
// Parseo del cuerpo del widget del canal Web (paso 5b), calcado de
// ingestBody.ts y por los mismos dos motivos que ese archivo explica: un
// límite montado DESPUÉS del parser global no limita nada (por eso el router
// público se monta antes en app.ts), y un endpoint sin usuario detrás merece
// un límite más estricto que el resto.
// ---------------------------------------------------------------------------

// 8 KB alcanza de sobra para { sessionId, message } con message de hasta 4000
// caracteres (UTF-8 multibyte incluido) — bien por encima de lo necesario pero
// mucho más chico que los 64 KB de ingesta, porque acá no hay un payload
// arbitrario de terceros: son dos strings cortos con forma fija.
export const WIDGET_MAX_BODY_BYTES = 8 * 1024;

// 415 explícito y ANTES del parser, por lo mismo que requireJsonContentType
// de ingestBody.ts. Propio y no reexportado: el de ingesta nombra "la
// ingesta" en su mensaje, y este endpoint no es la ingesta.
export function requireWidgetJsonContentType(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  if (!req.is("application/json")) {
    next(new AppError("Este endpoint solo acepta application/json", 415));
    return;
  }
  next();
}

const parser = express.json({
  limit: WIDGET_MAX_BODY_BYTES,
  type: "application/json",
});

// Traduce los errores de body-parser a AppError, con la clasificación
// compartida de bodyParserError.ts (M-11 a) y los mismos códigos que la
// ingesta (413/400/415). El 413 nombra el tope propio de este endpoint.
export function widgetJsonParser(req: Request, res: Response, next: NextFunction): void {
  parser(req, res, (err: unknown) => {
    if (!err) {
      next();
      return;
    }

    switch (clasificarErrorDeBodyParser(err)) {
      case "demasiado_grande":
        next(
          new AppError(
            `El cuerpo del request supera el máximo de ${WIDGET_MAX_BODY_BYTES} bytes`,
            413,
          ),
        );
        return;
      case "cuerpo_invalido":
        next(new AppError("El cuerpo del request no es JSON válido", 400));
        return;
      case "codificacion_no_soportada":
        next(new AppError("Codificación de cuerpo no soportada", 415));
        return;
      default:
        next(err);
    }
  });
}
