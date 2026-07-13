import { Router } from "express";
import { activityRouter } from "./activity.routes";
import { companyRouter } from "./company.routes";
import { contactRouter } from "./contact.routes";
import { healthRouter } from "./health.routes";
import { invitationRouter } from "./invitation.routes";
import { meRouter } from "./me.routes";
import { onboardingRouter } from "./onboarding.routes";
import { opportunityRouter } from "./opportunity.routes";
import { pipelineRouter } from "./pipeline.routes";
import { stageRouter } from "./stage.routes";
import { userRouter } from "./user.routes";

// Agrega acá cada router nuevo a medida que se implementen entidades del CRM.
// /health queda sin prefijo (convención de health checks); las rutas de
// negocio van bajo /api.
export const routes = Router();

routes.use(healthRouter);
routes.use("/api", onboardingRouter);
routes.use("/api", meRouter);
routes.use("/api", companyRouter);
routes.use("/api", contactRouter);
routes.use("/api", pipelineRouter);
routes.use("/api", stageRouter);
routes.use("/api", opportunityRouter);
routes.use("/api", activityRouter);
routes.use("/api", invitationRouter);
routes.use("/api", userRouter);
