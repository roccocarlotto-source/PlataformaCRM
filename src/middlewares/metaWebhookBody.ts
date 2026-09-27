import express, { type NextFunction, type Request, type Response } from "express";
import { AppError } from "../utils/AppError";
import { hmacSha256Hex, timingSafeEqual } from "../utils/hmac";
import { envolverParserConTraduccion } from "./bodyParserError";

// ---------------------------------------------------------------------------
// Lo que comparten los webhooks de Meta: WhatsApp (ítem 81,
// routes/whatsappWebhook.routes.ts) y Messenger + Instagram (ítem 171,
// routes/metaWebhook.routes.ts). Nació dentro del de WhatsApp y se mudó acá
// cuando apareció el segundo consumidor, mismo criterio que utils/hmac.ts.
//
// Los dos firman igual: HMAC-SHA256 del CUERPO CRUDO con el App Secret, en
// X-Hub-Signature-256 con el prefijo "sha256=". Por eso los dos necesitan un
// parser propio que guarde los bytes tal cual llegaron (el `verify` corre ANTES
// de JSON.parse) y montarse antes del express.json() global (ver app.ts).
// ---------------------------------------------------------------------------

// El request con los bytes crudos que dejó el `verify` del parser.
export interface RequestConRawBody extends Request {
  rawBody?: Buffer;
}

export const META_SIGNATURE_HEADER = "x-hub-signature-256";
const PREFIJO_DE_FIRMA = "sha256=";

// 400 explícito si el Content-Type no es JSON. Sin esto body-parser se saltea
// el request en silencio, no hay rawBody y la firma daría un 401 que describe
// mal el problema.
export function requireJsonBody(req: Request, _res: Response, next: NextFunction): void {
  if (!req.is("application/json")) {
    next(new AppError("El webhook solo acepta application/json", 400));
    return;
  }
  next();
}

// Parser propio con tope propio: corre ANTES de verificar la firma, así que
// el tope es lo que acota lo que cualquiera puede hacernos parsear sin estar
// autenticado. Errores traducidos a 413/400/415 con la misma tabla que el
// parser global.
export function crearParserConRawBody(maxBytes: number) {
  return envolverParserConTraduccion(
    express.json({
      limit: maxBytes,
      type: "application/json",
      verify: (req, _res, buf) => {
        (req as RequestConRawBody).rawBody = Buffer.from(buf);
      },
    }),
    {
      demasiado_grande: {
        message: `El cuerpo del request supera el máximo de ${maxBytes} bytes`,
        statusCode: 413,
      },
      cuerpo_invalido: { message: "El cuerpo del request no es JSON válido", statusCode: 400 },
      codificacion_no_soportada: {
        message: "Codificación de cuerpo no soportada",
        statusCode: 415,
      },
    },
  );
}

// ¿La firma del request es la de Meta con este App Secret? Sin rawBody (cuerpo
// vacío), sin header, sin el prefijo o con un HMAC que no coincide: false —
// todo cae en el mismo 401. Comparación en tiempo constante (utils/hmac.ts).
export function firmaDeMetaValida(req: Request, appSecret: string): boolean {
  const rawBody = (req as RequestConRawBody).rawBody;
  const header = req.headers[META_SIGNATURE_HEADER];
  const firma =
    typeof header === "string" && header.startsWith(PREFIJO_DE_FIRMA)
      ? header.slice(PREFIJO_DE_FIRMA.length)
      : undefined;
  return !!rawBody && !!firma && timingSafeEqual(hmacSha256Hex(appSecret, rawBody), firma);
}
