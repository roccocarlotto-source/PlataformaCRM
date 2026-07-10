import { Router } from "express";
import { createOnboarding } from "../controllers/onboarding.controller";

export const onboardingRouter = Router();

// Único registro público del sistema — sin authenticate, ver
// docs/authentication-architecture.md sección 1.
onboardingRouter.post("/onboarding", createOnboarding);
