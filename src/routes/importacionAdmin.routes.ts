import { Router } from "express";
import {
  cancelarHandler,
  configurarHandler,
  confirmarHandler,
  csvCambiosHandler,
  csvFallidasHandler,
  csvFotosHandler,
  decidirHandler,
  deshacerHandler,
  filasHandler,
  listarHandler,
  obtenerHandler,
  opcionesHandler,
  subirHandler,
} from "../controllers/importacionAdmin.controller";
import { authenticate } from "../middlewares/authenticate";
import { importUpload } from "../middlewares/importUpload";
import { businessWriteRateLimiter, importPreviewRateLimiter } from "../middlewares/rateLimit";
import { requirePlatformAdmin } from "../middlewares/requirePlatformAdmin";

// ---------------------------------------------------------------------------
// Plataforma → Importar datos (docs/importacion-de-datos.md §8 y §9.1).
//
// Cadena: authenticate + rate limit + requirePlatformAdmin, sin
// authorize("ADMIN"): el platform admin no es miembro de la organización que
// importa (ver middlewares/requirePlatformAdmin.ts). Subir un archivo usa la
// cuota de la vista previa de la importación de siempre (parsea un archivo de
// hasta 10 MB), el resto la de escritura de negocio.
// ---------------------------------------------------------------------------

export const importacionAdminRouter = Router();

const BASE = "/admin/organizations/:organizationId/imports";
const gate = [authenticate, businessWriteRateLimiter, requirePlatformAdmin];

importacionAdminRouter.get(`${BASE}/options`, ...gate, opcionesHandler);
importacionAdminRouter.post(
  BASE,
  authenticate,
  importPreviewRateLimiter,
  requirePlatformAdmin,
  importUpload,
  subirHandler,
);
importacionAdminRouter.get(BASE, ...gate, listarHandler);
importacionAdminRouter.get(`${BASE}/:batchId`, ...gate, obtenerHandler);
importacionAdminRouter.put(`${BASE}/:batchId/config`, ...gate, configurarHandler);
importacionAdminRouter.get(`${BASE}/:batchId/rows`, ...gate, filasHandler);
importacionAdminRouter.patch(`${BASE}/:batchId/rows`, ...gate, decidirHandler);
importacionAdminRouter.post(`${BASE}/:batchId/confirm`, ...gate, confirmarHandler);
importacionAdminRouter.post(`${BASE}/:batchId/cancel`, ...gate, cancelarHandler);
importacionAdminRouter.post(`${BASE}/:batchId/undo`, ...gate, deshacerHandler);
importacionAdminRouter.get(`${BASE}/:batchId/failed.csv`, ...gate, csvFallidasHandler);
importacionAdminRouter.get(`${BASE}/:batchId/changes.csv`, ...gate, csvCambiosHandler);
importacionAdminRouter.get(`${BASE}/:batchId/photos.csv`, ...gate, csvFotosHandler);
