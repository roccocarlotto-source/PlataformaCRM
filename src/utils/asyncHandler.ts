import type { NextFunction, Request, RequestHandler, Response } from "express";

type AsyncRouteHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => Promise<unknown>;

// Express 4 no reenvía automáticamente los rechazos de promesas de handlers
// async a next(). Este wrapper cierra ese hueco sin que cada handler tenga
// que repetir un try/catch.
export function asyncHandler(handler: AsyncRouteHandler): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}
