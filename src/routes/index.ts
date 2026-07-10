import { Router } from "express";
import { companyRouter } from "./company.routes";
import { healthRouter } from "./health.routes";
import { onboardingRouter } from "./onboarding.routes";

// Agrega acá cada router nuevo a medida que se implementen entidades del CRM.
// /health queda sin prefijo (convención de health checks); las rutas de
// negocio van bajo /api.
export const routes = Router();

routes.use(healthRouter);
routes.use("/api", onboardingRouter);
routes.use("/api", companyRouter);
