import { Router } from "express";
import { ingestHandler } from "../controllers/ingest.controller";
import { authenticateApiKey } from "../middlewares/authenticateApiKey";
import {
  ingestJsonParser,
  requireJsonContentType,
} from "../middlewares/ingestBody";
import { ingestRateLimiter } from "../middlewares/rateLimit";

export const ingestRouter = Router();

// ---------------------------------------------------------------------------
// POST /api/ingest — la mitad de staging de la ingesta
// (docs/ingestion-architecture.md §5).
//
// RUTA PLANA, SIN sourceId EN EL PATH. La clave YA determina la Source y la
// organización: ponerlas también en la URL crearía dos fuentes de verdad para
// el mismo dato y una pregunta sin buena respuesta ("¿qué hago si no
// coinciden?"). Y, más concreto: cualquier identificador en el path se
// serializa en req.params, que pino escribe en cada línea de log y que `redact`
// no alcanza.
//
// NO MONTA `authorize`, Y ES DELIBERADO: no hay usuario, no hay rol y no hay
// membresía que chequear. Una API key no tiene rol; lo único que puede hacer es
// esto (§3).
//
// EL ORDEN DE LOS CUATRO MIDDLEWARES NO ES INTERCAMBIABLE:
//
//   1. requireJsonContentType — antes del parser. Es lo único que distingue
//      "mandaste otro formato" (415) de "mandaste un cuerpo vacío": body-parser
//      con `type` se saltea en silencio lo que no le corresponde.
//   2. ingestJsonParser — antes de authenticateApiKey a propósito. Un cuerpo de
//      un giga tiene que morir contra el límite ANTES de que gastemos un SELECT
//      en resolver la credencial; al revés, el límite protegería la base pero
//      no el proceso. Cuesta parsear el cuerpo de un request no autenticado, y
//      es el intercambio correcto: parsear 64 KB es barato y acotado.
//   3. authenticateApiKey — el 401 genérico y la resolución del IngestContext.
//   4. ingestRateLimiter — DESPUÉS de authenticateApiKey por necesidad
//      estructural: cuenta por apiKeyId, que no existe hasta que el paso 3
//      resolvió la clave.
// ---------------------------------------------------------------------------
ingestRouter.post(
  "/ingest",
  requireJsonContentType,
  ingestJsonParser,
  authenticateApiKey,
  ingestRateLimiter,
  ingestHandler,
);
