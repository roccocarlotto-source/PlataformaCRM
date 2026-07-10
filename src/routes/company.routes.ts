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

export const companyRouter = Router();

// Lectura: cualquier usuario autenticado de la organización.
companyRouter.get("/companies", authenticate, listCompaniesHandler);
companyRouter.get("/companies/:id", authenticate, getCompanyHandler);

// Escritura: solo ADMIN.
companyRouter.post(
  "/companies",
  authenticate,
  authorize("ADMIN"),
  createCompanyHandler,
);
companyRouter.patch(
  "/companies/:id",
  authenticate,
  authorize("ADMIN"),
  updateCompanyHandler,
);
companyRouter.delete(
  "/companies/:id",
  authenticate,
  authorize("ADMIN"),
  deleteCompanyHandler,
);
