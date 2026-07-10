import type { NextFunction, Request, RequestHandler, Response } from "express";

type AsyncRouteHandler<Req extends Request> = (
  req: Req,
  res: Response,
  next: NextFunction,
) => Promise<unknown>;

// Express 4 no reenvía automáticamente los rechazos de promesas de handlers
// async a next(). Este wrapper cierra ese hueco sin que cada handler tenga
// que repetir un try/catch.
//
// Genérico sobre el tipo de Request: los handlers montados después de
// `authenticate` pueden tipar su parámetro como `AuthenticatedRequest`
// (`req.auth` no opcional) en vez de `Request` — ver
// src/controllers/company.controller.ts para el uso real. El cast interno es
// el único lugar que "confía" en que el middleware ya corrió; Express no
// tiene forma de expresar esa garantía en el tipo de la ruta.
export function asyncHandler<Req extends Request = Request>(
  handler: AsyncRouteHandler<Req>,
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req as Req, res, next)).catch(next);
  };
}
