import express, { type NextFunction, type Request, type Response } from "express";
import { AppError } from "../utils/AppError";
import { clasificarErrorDeBodyParser } from "./bodyParserError";

// ---------------------------------------------------------------------------
// Parseo del cuerpo de la ingesta, con su propio límite y su propio
// Content-Type. Vive acá y no en el express.json() global de app.ts por dos
// razones distintas.
//
// 1. UN LÍMITE MONTADO DESPUÉS DEL PARSER GLOBAL NO LIMITA NADA. body-parser
//    marca el request al parsearlo (req._body) y toda instancia posterior se
//    saltea a sí misma: el stream ya se consumió. Un express.json({ limit })
//    colgado del router de ingesta habría parecido una garantía sin serlo, que
//    es peor que no tenerla. Por eso app.ts monta el router de ingesta ANTES
//    del parser global — ver el comentario de orden en app.ts.
//
// 2. LA INGESTA MERECE UN LÍMITE MÁS ESTRICTO QUE EL RESTO. Es el único
//    endpoint del sistema sin usuario detrás: lo puede llamar cualquiera que
//    tenga una clave, desde cualquier lado, sin sesión y sin rol.
// ---------------------------------------------------------------------------

// Un formulario de landing page razonable entra holgado en 64 KB. El caso de
// volumen —un Excel de 5.000 filas— NO pasa por acá: es el ítem 5, con su
// propio contrato de subida de archivo (§5, §6.5). Si alguna vez este número
// tiene que crecer para acomodar un lote, la respuesta correcta casi seguro no
// es subirlo sino usar el camino del ítem 5.
export const INGEST_MAX_BODY_BYTES = 64 * 1024;

// 415 explícito y ANTES del parser. Sin esto, un Content-Type que no sea JSON
// hace que body-parser se saltee el request en silencio y el handler reciba un
// req.body vacío: la ingesta guardaría un evento vacío con 202, y el emisor se
// enteraría del problema recién cuando su lead no apareciera nunca.
//
// req.is() y no una comparación de strings: contempla los parámetros del
// header, así que `application/json; charset=utf-8` —lo que manda cualquier
// cliente HTTP real— se acepta, y `application/x-www-form-urlencoded` o
// `text/plain` no.
export function requireJsonContentType(req: Request, _res: Response, next: NextFunction): void {
  if (!req.is("application/json")) {
    next(new AppError("La ingesta solo acepta application/json", 415));
    return;
  }
  next();
}

const parser = express.json({
  limit: INGEST_MAX_BODY_BYTES,
  type: "application/json",
});

// Traduce los errores de body-parser a AppError.
//
// HACE FALTA PORQUE errorHandler MANDA A 500 TODO LO QUE NO SEA AppError. Los
// errores de body-parser son http-errors con su `status` correcto adentro, pero
// errorHandler no lo mira (a propósito: no filtrar qué error de terceros trae
// un status creíble es cómo se filtran mensajes internos al cliente).
//
// LA CLASIFICACIÓN DEL `err.type` VIVE EN bodyParserError.ts y la comparten
// este parser y los globales de app.ts (M-11 a). Lo que es propio de acá son
// los MENSAJES: el de 413 nombra INGEST_MAX_BODY_BYTES porque el emisor de un
// webhook necesita saber cuál es el tope que superó, y no es el mismo que el
// del resto de la app.
export function ingestJsonParser(req: Request, res: Response, next: NextFunction): void {
  parser(req, res, (err: unknown) => {
    if (!err) {
      next();
      return;
    }

    switch (clasificarErrorDeBodyParser(err)) {
      case "demasiado_grande":
        next(
          new AppError(
            `El cuerpo del request supera el máximo de ${INGEST_MAX_BODY_BYTES} bytes`,
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
        // request.aborted, stream.encoding.set, y cualquier cosa que no
        // conozcamos: se deja pasar sin traducir para que errorHandler la
        // registre con su stack. Inventarle un 4xx a un error que no
        // entendemos sería decirle al cliente que la culpa es suya sin
        // saberlo.
        next(err);
    }
  });
}
