import { Router } from "express";
import { healthRouter } from "./health.routes";

// Agrega acá cada router nuevo a medida que se implementen entidades del CRM.
export const routes = Router();

routes.use(healthRouter);
