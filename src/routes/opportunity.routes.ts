import { Router } from "express";
import {
  createOpportunityHandler,
  deleteOpportunityHandler,
  getOpportunityHandler,
  listOpportunitiesHandler,
  updateOpportunityHandler,
} from "../controllers/opportunity.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";

export const opportunityRouter = Router();

// Lectura: cualquier usuario autenticado de la organización.
opportunityRouter.get(
  "/opportunities",
  authenticate,
  listOpportunitiesHandler,
);
opportunityRouter.get(
  "/opportunities/:id",
  authenticate,
  getOpportunityHandler,
);

// Escritura: solo ADMIN.
opportunityRouter.post(
  "/opportunities",
  authenticate,
  authorize("ADMIN"),
  createOpportunityHandler,
);
opportunityRouter.patch(
  "/opportunities/:id",
  authenticate,
  authorize("ADMIN"),
  updateOpportunityHandler,
);
opportunityRouter.delete(
  "/opportunities/:id",
  authenticate,
  authorize("ADMIN"),
  deleteOpportunityHandler,
);
