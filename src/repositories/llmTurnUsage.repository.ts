import type { ConversationChannel, Prisma } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";

// ---------------------------------------------------------------------------
// El consumo del modelo por turno del agente (B4, migración 20261023120000).
// Ver el modelo LlmTurnUsage en schema.prisma y llmUsage.service.ts.
// ---------------------------------------------------------------------------

export interface CreateLlmTurnUsageData {
  organizationId: string;
  agentId: string;
  conversationId: string;
  channel: ConversationChannel;
  model: string;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  // null si ninguna llamada del turno informó costo.
  costUsd: number | null;
}

export function createLlmTurnUsage(data: CreateLlmTurnUsageData, db: Db = prisma) {
  return db.llmTurnUsage.create({ data });
}

// El gasto por organización desde `desde`: turnos, tokens y costo. Las
// organizaciones sin ningún turno en la ventana no aparecen.
export interface UsoPorOrganizacion {
  organizationId: string;
  turnos: number;
  promptTokens: number;
  completionTokens: number;
  // null si ningún turno de la ventana trajo costo.
  costUsd: number | null;
}

export async function sumarUsoPorOrganizacion(
  desde: Date,
  db: Db = prisma,
): Promise<UsoPorOrganizacion[]> {
  const grupos = await db.llmTurnUsage.groupBy({
    by: ["organizationId"],
    where: { createdAt: { gte: desde } },
    _count: { _all: true },
    _sum: { promptTokens: true, completionTokens: true, costUsd: true },
  });
  return grupos.map((g) => ({
    organizationId: g.organizationId,
    turnos: g._count._all,
    promptTokens: g._sum.promptTokens ?? 0,
    completionTokens: g._sum.completionTokens ?? 0,
    costUsd: g._sum.costUsd === null ? null : Number(g._sum.costUsd),
  }));
}

// ---------------------------------------------------------------------------
// Purga de retención (scripts/purge-llm-turn-usages.ts), misma forma que
// outbox_events: un único `where` que comparten el conteo y el borrado.
//
// 365 DÍAS. Es el registro de lo que se gastó por organización, y un año es
// lo que hace falta para comparar un mes contra el mismo mes del año anterior
// o responder una consulta sobre una factura vieja. Más que eso no se
// consulta, y el log de producción (FABLE-G-04) sigue teniendo cada turno.
// ---------------------------------------------------------------------------
export const DIAS_DE_RETENCION_LLM_TURN_USAGE = 365;

export function fechaDeCorteDeRetencionLlmTurnUsage(ahora: Date = new Date()): Date {
  const corte = new Date(ahora);
  corte.setUTCDate(corte.getUTCDate() - DIAS_DE_RETENCION_LLM_TURN_USAGE);
  return corte;
}

export interface PurgaLlmTurnUsageScope {
  organizationId?: string;
}

function buildPurgaWhere(
  corte: Date,
  scope: PurgaLlmTurnUsageScope,
): Prisma.LlmTurnUsageWhereInput {
  return {
    createdAt: { lt: corte },
    ...(scope.organizationId ? { organizationId: scope.organizationId } : {}),
  };
}

export function countLlmTurnUsagesPurgables(
  corte: Date,
  scope: PurgaLlmTurnUsageScope = {},
  db: Db = prisma,
) {
  return db.llmTurnUsage.count({ where: buildPurgaWhere(corte, scope) });
}

export function purgeLlmTurnUsages(
  corte: Date,
  scope: PurgaLlmTurnUsageScope = {},
  db: Db = prisma,
) {
  return db.llmTurnUsage.deleteMany({ where: buildPurgaWhere(corte, scope) });
}
