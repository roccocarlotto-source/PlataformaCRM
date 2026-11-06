import express, { Router, type NextFunction, type Request, type Response } from "express";
import { env } from "../config/env";
import { pedirTurnoDeVozHandler } from "../controllers/voz.controller";
import { crearAutenticacionDeVoz } from "../middlewares/authenticateVoz";
import { clasificarErrorDeBodyParser } from "../middlewares/bodyParserError";
import { createVozRateLimiter } from "../middlewares/rateLimit";
import { requireWidgetJsonContentType } from "../middlewares/widgetBody";
import { AppError } from "../utils/AppError";
import type { AccesoDeVoz } from "../voz/accesos";

// La plataforma manda toda la conversación en cada turno: una llamada larga
// puede pesar bastante más que los mensajes del widget.
export const VOZ_MAX_BODY_BYTES = 256 * 1024;

const parser = express.json({ limit: VOZ_MAX_BODY_BYTES, type: "application/json" });

function vozJsonParser(req: Request, res: Response, next: NextFunction): void {
  parser(req, res, (err: unknown) => {
    if (!err) {
      next();
      return;
    }
    switch (clasificarErrorDeBodyParser(err)) {
      case "demasiado_grande":
        next(new AppError(`El cuerpo supera el máximo de ${VOZ_MAX_BODY_BYTES} bytes`, 413));
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

// ---------------------------------------------------------------------------
// POST /api/voz/llm/chat/completions: la plataforma de voz pide acá cada turno,
// con el formato de OpenAI.
//
// Apagado no existe: el pedido sigue de largo y termina en el 404 de siempre.
// El secreto se revisa antes de leer el cuerpo, porque revisarlo no toca la base
// y leer 256 KB de un desconocido sí cuesta.
// ---------------------------------------------------------------------------
export function crearRouterDeVoz(
  config: { habilitada: boolean; accesos: readonly AccesoDeVoz[]; maxPorMinuto?: number } = {
    habilitada: env.VOZ_HABILITADA,
    accesos: env.VOZ_ACCESOS,
  },
): Router {
  const router = Router();
  if (!config.habilitada) {
    return router;
  }
  router.post(
    "/llm/chat/completions",
    crearAutenticacionDeVoz(config.accesos),
    createVozRateLimiter(
      config.maxPorMinuto === undefined ? undefined : { max: config.maxPorMinuto },
    ),
    requireWidgetJsonContentType,
    vozJsonParser,
    pedirTurnoDeVozHandler,
  );
  return router;
}
