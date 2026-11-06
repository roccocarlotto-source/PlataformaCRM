import type { NextFunction, Request, RequestHandler, Response } from "express";
import { soloDigitos } from "../lib/telefono";
import type { VozRequest } from "../types/vozAuth";
import { AppError } from "../utils/AppError";
import { buscarAccesoDeVoz, type AccesoDeVoz } from "../voz/accesos";

const BEARER = /^Bearer ([^\s]+)$/;
export const HEADER_NUMERO_LLAMADO = "x-voz-numero";

// El mismo 401 para todo: no dice si el secreto existe ni qué número atiende.
function rechazo(): AppError {
  return new AppError("No autorizado", 401);
}

// Un acceso vale para su número. Si la plataforma no manda a qué número
// llamaron, alcanza con el secreto; si lo manda, tiene que coincidir.
export function crearAutenticacionDeVoz(accesos: readonly AccesoDeVoz[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const secreto = BEARER.exec(req.headers.authorization ?? "")?.[1];
    const acceso = secreto ? buscarAccesoDeVoz(accesos, secreto) : null;
    if (!acceso) {
      next(rechazo());
      return;
    }
    const numero = req.headers[HEADER_NUMERO_LLAMADO];
    if (typeof numero === "string" && soloDigitos(numero) !== soloDigitos(acceso.numero)) {
      next(rechazo());
      return;
    }
    (req as VozRequest).vozAcceso = acceso;
    next();
  };
}
