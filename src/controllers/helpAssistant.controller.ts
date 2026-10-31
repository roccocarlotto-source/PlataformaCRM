import type { Response } from "express";
import { z } from "zod";
import { mensajesDeTipo } from "../utils/erroresDeZod";
import { darFeedback, preguntarAlAsistente } from "../services/helpAssistant.service";
import {
  DIAS_DEL_INFORME,
  informeDePreguntas,
  type DiasDelInforme,
} from "../services/helpAssistantInforme.service";
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
      .string(mensajesDeTipo({ requerido: "pregunta es requerida" }))
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
            // AGE-01: opcional para no romper un navegador con la versión
            // anterior de la app; sin firma válida, el par se descarta.
            firma: z.string().max(100).optional(),
          })
          .strict(),
      )
      .max(PARES_DE_HISTORIAL)
      .optional(),
  })
  .strict();

const feedbackSchema = z
  .object({
    feedback: z.enum(
      ["UP", "DOWN"],
      mensajesDeTipo({
        requerido: "feedback es requerido",
        tipo: "feedback tiene que ser UP o DOWN",
      }),
    ),
  })
  .strict();

const idSchema = z.string().guid("id inválido");

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

// "Preguntas a la ayuda" (Plataforma). Los filtros llegan por query string;
// los vacíos son "todos".
const vacioComoAusente = (valor: unknown) => (valor === "" ? undefined : valor);

const informeSchema = z
  .object({
    dias: z.preprocess(
      (valor) => (valor === undefined || valor === "" ? 30 : Number(valor)),
      z
        .number()
        .refine((d): d is DiasDelInforme => (DIAS_DEL_INFORME as readonly number[]).includes(d), {
          message: `dias tiene que ser ${DIAS_DEL_INFORME.join(", ")}`,
        }),
    ),
    industry: z.preprocess(vacioComoAusente, z.enum(["AUTOMOTORA", "CLINICA"]).optional()),
    role: z.preprocess(vacioComoAusente, z.enum(["ADMIN", "USER", "RECEPCION"]).optional()),
    screen: z.preprocess(vacioComoAusente, z.string().max(60).optional()),
    outcome: z.preprocess(
      vacioComoAusente,
      z.enum(["ANSWERED", "NOT_COVERED", "DATA_REDIRECT", "OFF_TOPIC", "ERROR"]).optional(),
    ),
    feedback: z.preprocess(vacioComoAusente, z.enum(["UP", "DOWN"]).optional()),
  })
  .strict();

export const informeHandler = asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
  const filtros = parseOrThrow(informeSchema, req.query);
  res.status(200).json(await informeDePreguntas(filtros));
});
