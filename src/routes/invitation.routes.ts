import { Router } from "express";
import {
  acceptInvitationHandler,
  createInvitationHandler,
  listInvitationsHandler,
  revokeInvitationHandler,
} from "../controllers/invitation.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";

export const invitationRouter = Router();

// A diferencia del resto de los módulos, lectura y escritura son ambas
// ADMIN-only: listar invitaciones expone emails de gente que todavía no es
// miembro, más sensible que ver Company/Contact.
invitationRouter.get(
  "/invitations",
  authenticate,
  authorize("ADMIN"),
  listInvitationsHandler,
);
invitationRouter.post(
  "/invitations",
  authenticate,
  authorize("ADMIN"),
  createInvitationHandler,
);
invitationRouter.delete(
  "/invitations/:id",
  authenticate,
  authorize("ADMIN"),
  revokeInvitationHandler,
);

// Público en el sentido de no pasar por authenticate (exige public.users
// ya existente) — pero no anónimo: exige un JWT de Supabase válido. Ver
// invitation.controller.ts.
invitationRouter.post("/invitations/accept", acceptInvitationHandler);
