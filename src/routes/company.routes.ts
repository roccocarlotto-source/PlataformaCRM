import { Router } from "express";
import {
  createCompanyHandler,
  deleteCompanyHandler,
  getCompanyHandler,
  listCompaniesHandler,
  updateCompanyHandler,
} from "../controllers/company.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { businessWriteRateLimiter } from "../middlewares/rateLimit";

export const companyRouter = Router();

// Lectura: cualquier usuario autenticado de la organización.
companyRouter.get("/companies", authenticate, listCompaniesHandler);
companyRouter.get("/companies/:id", authenticate, getCompanyHandler);

// Escritura: solo ADMIN. businessWriteRateLimiter (R1.9) va después de
// authenticate (necesita req.auth.userId) y antes de authorize — ver
// rateLimit.ts.
companyRouter.post(
  "/companies",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  createCompanyHandler,
);
companyRouter.patch(
  "/companies/:id",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  updateCompanyHandler,
);
companyRouter.delete(
  "/companies/:id",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  deleteCompanyHandler,
);
