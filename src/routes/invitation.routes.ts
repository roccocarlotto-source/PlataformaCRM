import { Router } from "express";
import {
  acceptInvitationHandler,
  createInvitationHandler,
  listInvitationsHandler,
  revokeInvitationHandler,
} from "../controllers/invitation.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { businessWriteRateLimiter } from "../middlewares/rateLimit";
import { cadenaDeAceptacionDeInvitacion } from "../middlewares/verifyInvitationAcceptIdentity";

export const invitationRouter = Router();

// A diferencia del resto de los módulos, lectura y escritura son ambas
// ADMIN-only: listar invitaciones expone emails de gente que todavía no es
// miembro, más sensible que ver Company/Contact.
invitationRouter.get("/invitations", authenticate, authorize("ADMIN"), listInvitationsHandler);
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
// invitation.controller.ts. La cadena vive en UN solo lugar
// (crearCadenaDeAceptacion, verifyInvitationAcceptIdentity.ts) porque su orden
// es lo que V-8 de docs/auditoria-2026-08-29.md corrigió:
//   1. verifyInvitationAcceptToken: firma del JWT (barato, JWKS cacheado).
//   2. body válido (400 barato).
//   3. acceptInvitationRateLimiter: por el `sub` verificado.
//   4. resolveInvitationAcceptIdentity: Admin API, ya dentro del cupo.
// Antes el limiter corría después de la Admin API, así que un 429 no
// ahorraba la llamada cara.
//
// SIN LIMITER ANTES DE VERIFICAR, y es una decisión (A-2 de
// docs/auditoria-2026-08-29.md): hasta el 29/08 acá iba acceptPreAuthRateLimiter,
// que keyeaba por IP porque antes de verificar no hay ninguna identidad — y
// por IP, detrás de un proxy, el cupo era global para todos los clientes. Lo
// que queda sin acotar es una verificación de firma contra un JWKS cacheado
// por request anónimo, que no toca Postgres ni la Admin API; ver rateLimit.ts
// para el paralelismo con el flood anónimo de ingesta, que ya se aceptaba.
invitationRouter.post(
  "/invitations/accept",
  ...cadenaDeAceptacionDeInvitacion,
  acceptInvitationHandler,
);
