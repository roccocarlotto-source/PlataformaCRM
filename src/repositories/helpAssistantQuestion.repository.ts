import { prisma, type Db } from "../lib/prisma";

// ---------------------------------------------------------------------------
// Las preguntas al asistente "¿Cómo se hace?" (help_assistant_questions;
// docs-privados/asistente-de-ayuda-diseno.md §7.3, local). Por ahora solo la
// retención; el alta, el tope diario y el informe llegan con el endpoint.
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
