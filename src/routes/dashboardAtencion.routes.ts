import { Router } from "express";
import { getDashboardDeAtencionHandler } from "../controllers/dashboardAtencion.controller";
import { authenticate } from "../middlewares/authenticate";

export const dashboardAtencionRouter = Router();

// Dashboard de atención (docs/ediciones.md §6.4): de lectura, para los dos
// roles, como el dashboard comercial. Módulo dashboard_atencion del catálogo
// de ediciones (src/config/ediciones.ts), incluido en las dos ediciones.
dashboardAtencionRouter.get("/dashboard/atencion", authenticate, getDashboardDeAtencionHandler);
