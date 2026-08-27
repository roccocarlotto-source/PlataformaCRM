import { Router } from "express";
import {
  listIngestionEventsHandler,
  retryIngestionEventHandler,
} from "../controllers/ingestionEvent.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { businessWriteRateLimiter } from "../middlewares/rateLimit";

export const ingestionEventRouter = Router();

// ---------------------------------------------------------------------------
// Observabilidad y reproceso de la cola de ingesta — G-1, G-2 y G-7 de
// docs/research-frontend-ingesta-2026-08-27.md.
//
// RUTA PLANA `/api/ingestion-events`, no anidada bajo /sources/:sourceId/events:
// misma convención que documentan apiKey.routes.ts e import.routes.ts. El filtro
// `?sourceId=` cubre el mismo caso sin crear una segunda forma de nombrar el
// mismo recurso.
//
// ADMIN-only en las dos, LECTURA INCLUIDA — mismo criterio que source.routes.ts
// y apiKey.routes.ts, y distinto del de Company/Contact: esto es superficie de
// integración, no un módulo de negocio de lectura abierta. Deja toda la capa de
// ingesta detrás de un solo rol en vez de dos criterios distintos.
//
// EL CAMINO DE AUTH ES EL EXISTENTE (`authenticate` + `authorize`), nunca
// `authenticateApiKey`. Una API key sirve para ingestar y nada más: no puede
// leer la cola ni pedir reprocesos, igual que no puede administrarse a sí misma
// (ver apiKey.routes.ts). Del otro lado de estas dos rutas hay una persona con
// sesión, así que hay userId, rol y membresía que chequear.
// ---------------------------------------------------------------------------
ingestionEventRouter.get(
  "/ingestion-events",
  authenticate,
  authorize("ADMIN"),
  listIngestionEventsHandler,
);

// businessWriteRateLimiter después de authenticate (necesita req.auth.userId) y
// antes de authorize — ver rateLimit.ts. Solo en la escritura, mismo criterio
// que el resto de los routers.
//
// Es una escritura aunque el cuerpo vaya vacío: cambia el estado persistido de
// una fila y encola trabajo para el worker.
ingestionEventRouter.post(
  "/ingestion-events/:id/retry",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  retryIngestionEventHandler,
);
