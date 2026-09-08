import { Router } from "express";
import {
  createVehicleHandler,
  deleteVehicleHandler,
  getVehicleChangeLogHandler,
  getVehicleHandler,
  listVehiclesHandler,
  updateVehicleHandler,
} from "../controllers/vehicle.controller";
import {
  deleteVehiclePhotoHandler,
  reorderVehiclePhotosHandler,
  updateVehiclePhotoHandler,
  uploadVehiclePhotoHandler,
} from "../controllers/vehiclePhoto.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { businessWriteRateLimiter } from "../middlewares/rateLimit";
import { vehiclePhotoUpload } from "../middlewares/vehiclePhotoUpload";

export const vehicleRouter = Router();

// ---------------------------------------------------------------------------
// Stock de vehículos de la organización (Fase 2a). Mismo esquema de permisos
// que qrRouter/branchRouter: lectura para cualquier usuario autenticado de la
// organización, escritura solo ADMIN. Reservar/liberar una unidad (PATCH de
// status) queda bajo ADMIN también — si un vendedor tuviera que poder
// hacerlo, es una decisión de producto, no de esta fase.
//
// businessWriteRateLimiter va después de authenticate —necesita
// req.auth.userId— y antes de authorize. Mismo orden que qr.routes.ts.
// ---------------------------------------------------------------------------
vehicleRouter.get("/vehicles", authenticate, listVehiclesHandler);
vehicleRouter.get("/vehicles/:id", authenticate, getVehicleHandler);
vehicleRouter.get("/vehicles/:id/change-log", authenticate, getVehicleChangeLogHandler);

vehicleRouter.post(
  "/vehicles",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  createVehicleHandler,
);
vehicleRouter.patch(
  "/vehicles/:id",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  updateVehicleHandler,
);
vehicleRouter.delete(
  "/vehicles/:id",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  deleteVehicleHandler,
);

// ---------------------------------------------------------------------------
// Galería de una unidad (Fase 2b). La lectura va dentro de GET /vehicles/:id
// (campo `photos`); acá solo las escrituras, todas ADMIN.
//
// vehiclePhotoUpload va DESPUÉS de authorize: el multipart no se parsea —ni
// se carga en memoria— para un request sin token o sin permiso. Mismo orden
// que importUpload en import.routes.ts.
// ---------------------------------------------------------------------------
vehicleRouter.post(
  "/vehicles/:id/photos",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  vehiclePhotoUpload,
  uploadVehiclePhotoHandler,
);
vehicleRouter.put(
  "/vehicles/:id/photos/reorder",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  reorderVehiclePhotosHandler,
);
vehicleRouter.patch(
  "/vehicles/:id/photos/:photoId",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  updateVehiclePhotoHandler,
);
vehicleRouter.delete(
  "/vehicles/:id/photos/:photoId",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  deleteVehiclePhotoHandler,
);
