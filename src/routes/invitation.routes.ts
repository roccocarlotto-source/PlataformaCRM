import { Router } from "express";
import {
  acceptInvitationHandler,
  createInvitationHandler,
  listInvitationsHandler,
  revokeInvitationHandler,
} from "../controllers/invitation.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import {
  acceptInvitationRateLimiter,
  acceptPreAuthRateLimiter,
  businessWriteRateLimiter,
} from "../middlewares/rateLimit";
import { verifyInvitationAcceptIdentity } from "../middlewares/verifyInvitationAcceptIdentity";

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
// businessWriteRateLimiter (R1.9) solo en las escrituras — GET arriba
// queda fuera, mismo criterio que el resto de los routers.
invitationRouter.post(
  "/invitations",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  createInvitationHandler,
);
invitationRouter.delete(
  "/invitations/:id",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  revokeInvitationHandler,
);

// Público en el sentido de no pasar por authenticate (exige public.users
// ya existente) — pero no anónimo: exige un JWT de Supabase válido. Ver
// invitation.controller.ts. M1 — dos etapas de rate limiting (ver
// rateLimit.ts para el porqué de cada una):
//   1. acceptPreAuthRateLimiter: por IP, antes de verificar el JWT —
//      protege el costo de intentar verificar, sin identidad todavía.
//   2. verifyInvitationAcceptIdentity: verifica el JWT una sola vez.
//   3. acceptInvitationRateLimiter: por identidad ya verificada (sub).
invitationRouter.post(
  "/invitations/accept",
  acceptPreAuthRateLimiter,
  verifyInvitationAcceptIdentity,
  acceptInvitationRateLimiter,
  acceptInvitationHandler,
);
