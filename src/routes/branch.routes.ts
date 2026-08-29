import { Router } from "express";
import {
  createBranchHandler,
  deleteBranchHandler,
  getBranchHandler,
  listBranchesHandler,
  updateBranchHandler,
} from "../controllers/branch.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { businessWriteRateLimiter } from "../middlewares/rateLimit";

export const branchRouter = Router();

// Mismo esquema de permisos que el resto de los CRUD de configuracion
// (pipelines, stages): lectura para cualquier usuario autenticado de la
// organizacion, escritura solo ADMIN. No se invento nada nuevo — Role sigue
// teniendo ADMIN/USER y nada mas.
branchRouter.get("/branches", authenticate, listBranchesHandler);
branchRouter.get("/branches/:id", authenticate, getBranchHandler);

// businessWriteRateLimiter (R1.9) va despues de authenticate —necesita
// req.auth.userId— y antes de authorize. Mismo orden que pipeline.routes.ts.
branchRouter.post(
  "/branches",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  createBranchHandler,
);
branchRouter.patch(
  "/branches/:id",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  updateBranchHandler,
);
branchRouter.delete(
  "/branches/:id",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  deleteBranchHandler,
);
