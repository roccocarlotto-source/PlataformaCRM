import { Router } from "express";
import {
  createOpportunityHandler,
  deleteOpportunityHandler,
  getDashboardSummaryHandler,
  getOpportunityHandler,
  listOpportunitiesHandler,
  updateOpportunityHandler,
} from "../controllers/opportunity.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { businessWriteRateLimiter } from "../middlewares/rateLimit";

export const opportunityRouter = Router();

// Lectura: cualquier usuario autenticado de la organización.
opportunityRouter.get("/opportunities", authenticate, listOpportunitiesHandler);
// ANTES de /opportunities/:id, y el orden es parte del contrato: Express
// matchea en orden de declaración, y "dashboard-summary" declarado después
// caería en el :id y respondería 400 ("id inválido"). Lo fija
// opportunity.routes.test.ts.
opportunityRouter.get("/opportunities/dashboard-summary", authenticate, getDashboardSummaryHandler);
opportunityRouter.get("/opportunities/:id", authenticate, getOpportunityHandler);

// Escritura: solo ADMIN. businessWriteRateLimiter (R1.9) va después de
// authenticate (necesita req.auth.userId) y antes de authorize — ver
// rateLimit.ts.
opportunityRouter.post(
  "/opportunities",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  createOpportunityHandler,
);
opportunityRouter.patch(
  "/opportunities/:id",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  updateOpportunityHandler,
);
opportunityRouter.delete(
  "/opportunities/:id",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  deleteOpportunityHandler,
);
