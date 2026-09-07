import { Router } from "express";
import {
  createVehicleHandler,
  deleteVehicleHandler,
  getVehicleChangeLogHandler,
  getVehicleHandler,
  listVehiclesHandler,
  updateVehicleHandler,
} from "../controllers/vehicle.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { businessWriteRateLimiter } from "../middlewares/rateLimit";

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
