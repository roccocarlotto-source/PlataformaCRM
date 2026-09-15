import { Router } from "express";
import {
  createOpportunityHandler,
  deleteOpportunityHandler,
  getDashboardSummaryHandler,
  getOpportunityHandler,
  getRevenueSeriesHandler,
  listOpportunitiesHandler,
  updateOpportunityHandler,
} from "../controllers/opportunity.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { businessWriteRateLimiter } from "../middlewares/rateLimit";

export const opportunityRouter = Router();

// Lectura: cualquier usuario autenticado de la organización.
opportunityRouter.get("/opportunities", authenticate, listOpportunitiesHandler);
// Las dos rutas de agregados van ANTES de /opportunities/:id, y el orden es
// parte del contrato: Express matchea en orden de declaración, y
// "dashboard-summary" o "revenue-series" declaradas después caerían en el :id
// y responderían 400 ("id inválido"). Lo fija opportunity.routes.test.ts.
opportunityRouter.get("/opportunities/dashboard-summary", authenticate, getDashboardSummaryHandler);
opportunityRouter.get("/opportunities/revenue-series", authenticate, getRevenueSeriesHandler);
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
