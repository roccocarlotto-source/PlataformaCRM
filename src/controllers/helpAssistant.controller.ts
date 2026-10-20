import type { Response } from "express";
import { z } from "zod";
import { darFeedback, preguntarAlAsistente } from "../services/helpAssistant.service";
import { LARGO_MAXIMO_DE_LA_PREGUNTA, PARES_DE_HISTORIAL } from "../services/helpAssistantPrompt";
import type { AuthenticatedRequest } from "../types/auth";
import { asyncHandler } from "../utils/asyncHandler";
import { parseOrThrow } from "../utils/validation";

// ---------------------------------------------------------------------------
// El asistente "¿Cómo se hace?" (docs-privados/asistente-de-ayuda-diseno.md,
// local). Todo lo que decide está en helpAssistant.service.ts; acá solo se
// valida la forma del pedido.
// ---------------------------------------------------------------------------

const preguntaSchema = z
  .object({
    pregunta: z
      .string({ required_error: "pregunta es requerida" })
      .trim()
      .min(1, "pregunta es requerida")
      .max(
        LARGO_MAXIMO_DE_LA_PREGUNTA,
        `pregunta no puede superar los ${String(LARGO_MAXIMO_DE_LA_PREGUNTA)} caracteres`,
      ),
    // La clave de AYUDA de la pantalla (nunca la URL). Una desconocida se
    // ignora en el service, no es un error: el frontend puede ser más nuevo.
    pantalla: z.string().max(60).optional(),
    historial: z
      .array(
        z
          .object({
            pregunta: z.string().max(LARGO_MAXIMO_DE_LA_PREGUNTA),
            respuesta: z.string().max(4000),
          })
          .strict(),
      )
      .max(PARES_DE_HISTORIAL)
      .optional(),
  })
  .strict();

const feedbackSchema = z
  .object({
    feedback: z.enum(["UP", "DOWN"], {
      required_error: "feedback es requerido",
      invalid_type_error: "feedback tiene que ser UP o DOWN",
    }),
  })
  .strict();

const idSchema = z.string().uuid("id inválido");

export const preguntarHandler = asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
  const entrada = parseOrThrow(preguntaSchema, req.body);
  res.status(200).json(await preguntarAlAsistente(req.auth, entrada));
});

export const feedbackHandler = asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
  const id = parseOrThrow(idSchema, req.params.id);
  const { feedback } = parseOrThrow(feedbackSchema, req.body);
  await darFeedback(req.auth, id, feedback);
  res.status(204).end();
});
