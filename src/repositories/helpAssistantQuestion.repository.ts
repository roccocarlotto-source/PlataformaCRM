import {
  Prisma,
  type HelpAssistantFeedback,
  type HelpAssistantOutcome,
  type OrganizationEdition,
  type OrganizationIndustry,
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

// ---------------------------------------------------------------------------
// El informe de Plataforma ("Preguntas a la ayuda"): de todas las
// organizaciones, sin usuario ni organización en ninguna fila que devuelve.
// ---------------------------------------------------------------------------

export interface FiltroDelInforme {
  desde: Date;
  industry?: OrganizationIndustry;
  role?: string;
  screen?: string;
  outcome?: HelpAssistantOutcome;
  feedback?: HelpAssistantFeedback;
}

/** Las condiciones del filtro, sin la pantalla cuando se cuentan las
 *  preguntas por pantalla (si no, la lista tendría una sola). */
function condicionesDe(filtro: FiltroDelInforme, conPantalla = true): Prisma.Sql {
  const condiciones = [Prisma.sql`created_at >= ${filtro.desde}`];
  if (filtro.industry) condiciones.push(Prisma.sql`industry::text = ${filtro.industry}`);
  if (filtro.role) condiciones.push(Prisma.sql`role = ${filtro.role}`);
  if (conPantalla && filtro.screen) condiciones.push(Prisma.sql`screen = ${filtro.screen}`);
  if (filtro.outcome) condiciones.push(Prisma.sql`outcome::text = ${filtro.outcome}`);
  if (filtro.feedback) condiciones.push(Prisma.sql`feedback::text = ${filtro.feedback}`);
  return Prisma.join(condiciones, " AND ");
}

export interface TotalesPorResultado {
  outcome: HelpAssistantOutcome;
  preguntas: number;
  utiles: number;
  noUtiles: number;
  conCache: number;
  /** null: ninguna pregunta del grupo informó costo. */
  costoUsd: number | null;
}

export function totalesPorResultado(
  filtro: FiltroDelInforme,
  db: Db = prisma,
): Promise<TotalesPorResultado[]> {
  return db.$queryRaw<TotalesPorResultado[]>`
    SELECT outcome::text AS outcome,
           count(*)::int AS preguntas,
           count(*) FILTER (WHERE feedback = 'UP')::int AS utiles,
           count(*) FILTER (WHERE feedback = 'DOWN')::int AS "noUtiles",
           count(*) FILTER (WHERE cache_read_tokens > 0)::int AS "conCache",
           sum(cost_usd)::float8 AS "costoUsd"
      FROM help_assistant_questions
     WHERE ${condicionesDe(filtro)}
     GROUP BY outcome`;
}

export interface PreguntasDePantalla {
  /** null: la pregunta llegó sin pantalla, o con una que no está en AYUDA. */
  screen: string | null;
  preguntas: number;
}

export function preguntasPorPantalla(
  filtro: FiltroDelInforme,
  db: Db = prisma,
): Promise<PreguntasDePantalla[]> {
  return db.$queryRaw<PreguntasDePantalla[]>`
    SELECT screen, count(*)::int AS preguntas
      FROM help_assistant_questions
     WHERE ${condicionesDe(filtro, false)}
     GROUP BY screen
     ORDER BY preguntas DESC, screen`;
}

export const TOPE_DE_PREGUNTAS_FRECUENTES = 20;

export interface PreguntaFrecuente {
  /** La forma más reciente en que se escribió. */
  pregunta: string;
  veces: number;
  ultima: Date;
}

/** Las preguntas que se repiten, agrupadas sin mayúsculas, tildes, signos ni
 *  espacios de más: "¿Cómo invito a un vendedor?" y "como invito a un vendedor"
 *  son la misma. Solo las que aparecen dos veces o más. */
export function preguntasFrecuentes(
  filtro: FiltroDelInforme,
  db: Db = prisma,
): Promise<PreguntaFrecuente[]> {
  return db.$queryRaw<PreguntaFrecuente[]>`
    SELECT (array_agg(question ORDER BY created_at DESC))[1] AS pregunta,
           count(*)::int AS veces,
           max(created_at) AS ultima
      FROM help_assistant_questions
     WHERE ${condicionesDe(filtro)}
     GROUP BY btrim(regexp_replace(
                translate(lower(regexp_replace(question, '[[:punct:]¿¡]', '', 'g')), 'áéíóúü', 'aeiouu'),
                '[[:space:]]+', ' ', 'g'))
    HAVING count(*) > 1
     ORDER BY veces DESC, ultima DESC
     LIMIT ${TOPE_DE_PREGUNTAS_FRECUENTES}`;
}

export const TOPE_DE_PREGUNTAS_RECIENTES = 50;

export interface PreguntaDelInforme {
  id: string;
  createdAt: Date;
  industry: OrganizationIndustry;
  role: string;
  screen: string | null;
  question: string;
  sources: string[];
  outcome: HelpAssistantOutcome;
  feedback: HelpAssistantFeedback | null;
}

/** Las últimas preguntas. Sin organization_id ni user_id: el informe nunca
 *  dice quién preguntó. */
export function preguntasRecientes(
  filtro: FiltroDelInforme,
  db: Db = prisma,
): Promise<PreguntaDelInforme[]> {
  return db.$queryRaw<PreguntaDelInforme[]>`
    SELECT id, created_at AS "createdAt", industry::text AS industry, role, screen,
           question, sources, outcome::text AS outcome, feedback::text AS feedback
      FROM help_assistant_questions
     WHERE ${condicionesDe(filtro)}
     ORDER BY created_at DESC
     LIMIT ${TOPE_DE_PREGUNTAS_RECIENTES}`;
}
