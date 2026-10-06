import type { ConversationChannel } from "@prisma/client";
import { logger } from "../lib/logger";
import {
  createLlmTurnUsage,
  sumarUsoPorOrganizacion,
  type CreateLlmTurnUsageData,
} from "../repositories/llmTurnUsage.repository";
import { listActiveOrganizations } from "../repositories/organization.repository";
import type { LlmUsage } from "./llmProvider.service";

// ---------------------------------------------------------------------------
// El consumo del modelo por turno y por organización (FABLE-G-04 y FABLE-B-01
// de docs-privados/auditoria-2026-10-05-FABLE.md, local).
//
// Antes no se leía el `usage` que devuelve el proveedor: no había forma de
// saber cuánto gastaba cada negocio ni de notar un turno anormalmente caro.
// Cada turno suma lo que informó cada una de sus llamadas y lo registra UNA
// vez, con la organización: en una línea de log estructurada y, desde B4
// (migración 20261023120000), en una fila de llm_turn_usages. El log sigue
// existiendo para alertar; la tabla es lo que permite el gasto por
// organización (la vista de plataforma) y, cuando se decida, el tope diario.
//
// LA FILA NUNCA TUMBA EL TURNO: la respuesta ya está redactada cuando se
// registra el uso, y una base que no responde en ese momento se loguea y
// listo. El registro se espera (es un insert) para que quien lo necesite leer
// enseguida —un test, la vista— lo encuentre.
// ---------------------------------------------------------------------------

export interface UsoAcumulado {
  // Llamadas al modelo del turno, hayan informado consumo o no.
  llamadas: number;
  promptTokens: number;
  completionTokens: number;
  // null mientras ninguna llamada haya informado costo.
  costUsd: number | null;
}

export function usoVacio(): UsoAcumulado {
  return { llamadas: 0, promptTokens: 0, completionTokens: 0, costUsd: null };
}

// Suma una llamada. Sin `usage` (el proveedor no lo mandó) cuenta la llamada
// igual: "5 llamadas y 0 tokens" dice que falta el dato, no que fue gratis.
export function sumarUso(acumulado: UsoAcumulado, usage: LlmUsage | undefined): void {
  acumulado.llamadas += 1;
  if (!usage) {
    return;
  }
  acumulado.promptTokens += usage.promptTokens;
  acumulado.completionTokens += usage.completionTokens;
  if (usage.costUsd !== null) {
    acumulado.costUsd = (acumulado.costUsd ?? 0) + usage.costUsd;
  }
}

export interface UsoDelTurno {
  organizationId: string;
  agentId: string;
  conversationId: string;
  channel: ConversationChannel;
  model: string;
  uso: UsoAcumulado;
}

export const MENSAJE_DE_USO_DEL_TURNO = "Uso del modelo en el turno";

// Lo que esto escribe, inyectable para que el unitario no necesite Postgres.
export interface DepsDeRegistroDeUso {
  guardar: (data: CreateLlmTurnUsageData) => Promise<unknown>;
}

const depsReales: DepsDeRegistroDeUso = { guardar: (data) => createLlmTurnUsage(data) };

export async function registrarUsoDelTurno(
  datos: UsoDelTurno,
  deps: DepsDeRegistroDeUso = depsReales,
): Promise<void> {
  if (datos.uso.llamadas === 0) {
    return;
  }
  logger.info(
    {
      organizationId: datos.organizationId,
      agentId: datos.agentId,
      conversationId: datos.conversationId,
      channel: datos.channel,
      model: datos.model,
      llamadas: datos.uso.llamadas,
      promptTokens: datos.uso.promptTokens,
      completionTokens: datos.uso.completionTokens,
      costUsd: datos.uso.costUsd,
    },
    MENSAJE_DE_USO_DEL_TURNO,
  );
  try {
    await deps.guardar({
      organizationId: datos.organizationId,
      agentId: datos.agentId,
      conversationId: datos.conversationId,
      channel: datos.channel,
      model: datos.model,
      calls: datos.uso.llamadas,
      promptTokens: datos.uso.promptTokens,
      completionTokens: datos.uso.completionTokens,
      costUsd: datos.uso.costUsd,
    });
  } catch (err) {
    // El turno ya respondió: un registro que no se pudo guardar no lo tumba.
    logger.error(
      { err, organizationId: datos.organizationId, conversationId: datos.conversationId },
      "No se pudo guardar el uso del modelo del turno (la respuesta salió igual)",
    );
  }
}

// ---------------------------------------------------------------------------
// EL TOPE DIARIO (B4): DÓNDE IRÍA, todavía sin implementar por decisión de
// Rocco (06/10/2026). Cuando exista, se consulta ANTES de la primera llamada
// al modelo de cada turno (responderEnLaConversacion, justo después del gate
// de humanoAtiendeLaConversacion), con la organización y el día en su zona:
// la suma de cost_usd (o de tokens) de llm_turn_usages desde las 00:00 contra
// un tope por organización —que todavía no tiene dónde vivir (una columna en
// Organization o en el plan)—, y si lo supera, el turno no corre y la
// conversación se deriva a una persona con un motivo propio, nunca silencio.
// Hoy devuelve siempre false para que el lugar exista sin cambiar nada.
// ---------------------------------------------------------------------------
export function topeDiarioAlcanzado(organizationId: string): boolean {
  // Cuando exista: sumar llm_turn_usages de `organizationId` desde las 00:00
  // de su zona y compararlo con su tope.
  void organizationId;
  return false;
}

// ---------------------------------------------------------------------------
// El gasto por organización de los últimos `dias` días, para la vista de la
// plataforma (GET /api/admin/llm-usage). Todas las organizaciones vigentes,
// también las que no gastaron nada en la ventana (quedan en cero): la
// pregunta de quien mira la pantalla es "cuánto gastó cada cliente", y una
// que no aparece se confunde con una que falta.
// ---------------------------------------------------------------------------
export const DIAS_DE_LA_VISTA_DE_USO = 30;

export interface GastoDeOrganizacion {
  organizationId: string;
  organizationName: string;
  turnos: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: number | null;
}

export async function gastoPorOrganizacion(
  dias: number = DIAS_DE_LA_VISTA_DE_USO,
  ahora: Date = new Date(),
): Promise<GastoDeOrganizacion[]> {
  const desde = new Date(ahora.getTime() - dias * 24 * 60 * 60 * 1000);
  const [organizaciones, uso] = await Promise.all([
    listActiveOrganizations(),
    sumarUsoPorOrganizacion(desde),
  ]);
  const porId = new Map(uso.map((u) => [u.organizationId, u]));
  return organizaciones
    .map((org) => {
      const u = porId.get(org.id);
      return {
        organizationId: org.id,
        organizationName: org.name,
        turnos: u?.turnos ?? 0,
        promptTokens: u?.promptTokens ?? 0,
        completionTokens: u?.completionTokens ?? 0,
        costUsd: u?.costUsd ?? null,
      };
    })
    .sort((a, b) => (b.costUsd ?? 0) - (a.costUsd ?? 0) || b.turnos - a.turnos);
}
