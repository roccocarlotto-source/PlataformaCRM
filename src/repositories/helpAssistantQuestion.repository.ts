import type {
  HelpAssistantFeedback,
  HelpAssistantOutcome,
  OrganizationEdition,
  OrganizationIndustry,
} from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";

// ---------------------------------------------------------------------------
// Las preguntas al asistente "¿Cómo se hace?" (help_assistant_questions;
// docs-privados/asistente-de-ayuda-diseno.md §7.3, local): el registro de cada
// pregunta, el tope por usuario, el freno de gasto de la plataforma, el
// feedback y la retención.
// ---------------------------------------------------------------------------

export interface PreguntaARegistrar {
  organizationId: string;
  userId: string;
  industry: OrganizationIndustry;
  edition: OrganizationEdition;
  role: string;
  screen: string | null;
  /** Ya enmascarada. */
  question: string;
  sources: string[];
  outcome: HelpAssistantOutcome;
  model: string;
  promptTokens: number;
  completionTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number | null;
  durationMs: number;
}

/** Registra una pregunta. Devuelve su id (el del feedback). */
export async function registrarPregunta(
  datos: PreguntaARegistrar,
  db: Db = prisma,
): Promise<string> {
  const fila = await db.helpAssistantQuestion.create({ data: datos, select: { id: true } });
  return fila.id;
}

/** Cuántas preguntas hizo el usuario desde `desde`, sin las que fallaron: una
 *  respuesta que no llegó no le gasta una pregunta. */
export function contarPreguntasDesde(userId: string, desde: Date, db: Db = prisma) {
  return db.helpAssistantQuestion.count({
    where: { userId, createdAt: { gte: desde }, outcome: { not: "ERROR" } },
  });
}

/** Lo que costaron todas las preguntas de la plataforma desde `desde`, en
 *  dólares. Las que no informaron costo cuentan 0. */
export async function gastoDesde(desde: Date, db: Db = prisma): Promise<number> {
  const { _sum } = await db.helpAssistantQuestion.aggregate({
    where: { createdAt: { gte: desde } },
    _sum: { costUsd: true },
  });
  return Number(_sum.costUsd ?? 0);
}

/** El 👍/👎 de una respuesta, solo de quien preguntó. Devuelve cuántas filas
 *  cambió: 0 si la pregunta no existe o es de otra persona. */
export async function guardarFeedback(
  id: string,
  organizationId: string,
  userId: string,
  feedback: HelpAssistantFeedback,
  db: Db = prisma,
): Promise<number> {
  const { count } = await db.helpAssistantQuestion.updateMany({
    where: { id, organizationId, userId },
    data: { feedback },
  });
  return count;
}

// ---------------------------------------------------------------------------
// Retención
// ---------------------------------------------------------------------------

// Lo mínimo para ver qué pregunta la gente y mejorar la guía: la pregunta es
// texto que escribió un usuario y, aunque se guarda enmascarada, no se
// conserva más de lo necesario.
export const DIAS_DE_RETENCION_DE_PREGUNTAS = 90;

export function fechaDeCorteDePreguntas(ahora: Date = new Date()): Date {
  return new Date(ahora.getTime() - DIAS_DE_RETENCION_DE_PREGUNTAS * 24 * 60 * 60 * 1000);
}

/** Borra las preguntas anteriores al corte. Devuelve cuántas borró. */
export async function purgarPreguntasViejas(corte: Date, db: Db = prisma): Promise<number> {
  const { count } = await db.helpAssistantQuestion.deleteMany({
    where: { createdAt: { lt: corte } },
  });
  return count;
}
