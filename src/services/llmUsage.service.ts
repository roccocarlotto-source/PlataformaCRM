import { logger } from "../lib/logger";
import type { LlmUsage } from "./llmProvider.service";

// ---------------------------------------------------------------------------
// El consumo del modelo por turno y por organización (FABLE-G-04 y FABLE-B-01
// de docs-privados/auditoria-2026-10-05-FABLE.md, local).
//
// Antes no se leía el `usage` que devuelve el proveedor: no había forma de
// saber cuánto gastaba cada negocio ni de notar un turno anormalmente caro.
// Cada turno suma lo que informó cada una de sus llamadas y lo registra UNA
// vez, con la organización, en una línea de log estructurada.
//
// Es un registro en el log, no una tabla: sirve para medir y para alertar
// sobre los logs, no para facturar. Guardarlo en la base necesita una
// migración y va por separado.
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
  model: string;
  uso: UsoAcumulado;
}

export const MENSAJE_DE_USO_DEL_TURNO = "Uso del modelo en el turno";

export function registrarUsoDelTurno(datos: UsoDelTurno): void {
  if (datos.uso.llamadas === 0) {
    return;
  }
  logger.info(
    {
      organizationId: datos.organizationId,
      agentId: datos.agentId,
      conversationId: datos.conversationId,
      model: datos.model,
      llamadas: datos.uso.llamadas,
      promptTokens: datos.uso.promptTokens,
      completionTokens: datos.uso.completionTokens,
      costUsd: datos.uso.costUsd,
    },
    MENSAJE_DE_USO_DEL_TURNO,
  );
}
