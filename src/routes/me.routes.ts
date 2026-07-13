import { Router } from "express";
import { getMeHandler } from "../controllers/me.controller";
import { authenticate } from "../middlewares/authenticate";

export const meRouter = Router();

// Identidad de negocio del usuario autenticado (AuthContext ya resuelto por
// `authenticate`) — sin authorize: cualquier rol autenticado tiene una
// necesidad legítima de conocer su propia identidad.
meRouter.get("/me", authenticate, getMeHandler);
