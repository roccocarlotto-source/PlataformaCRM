import { z } from "zod";

// Extraído de invitation.controller.ts (M1): acceptInvitationRateLimiter
// necesita el mismo schema para decidir qué requests cuentan contra el
// cupo (ver rateLimit.ts) — se comparte el objeto, no se redeclaran las
// reglas. createInvitationSchema/listQuerySchema quedan donde estaban:
// nadie más los necesita compartidos.
export const acceptInvitationSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(1, "fullName es requerido")
    .max(255, "fullName no puede superar los 255 caracteres"),
  invitationId: z.string().uuid("invitationId inválido").optional(),
});
