import { Prisma } from "@prisma/client";
import { env } from "../config/env";
import { logger } from "../lib/logger";
import { prisma } from "../lib/prisma";
import {
  claimLoteParaAnalizar,
  claimLoteTerminado,
  resumenDeFilas,
  transicionarLote,
} from "../repositories/importacion.repository";
import { analizarLote } from "../services/importacionAnalisis.service";
import { describirError } from "../utils/backoff";

// ---------------------------------------------------------------------------
// El worker de los LOTES del asistente de importación
// (docs/importacion-de-datos.md §8). Las FILAS las promueve el worker de
// ingesta de siempre; este hace lo que es del lote entero:
//
//   1. ANALYZING -> READY: la vista previa (importacionAnalisis.service.ts),
//      en una transacción que tiene el lote tomado con FOR UPDATE SKIP LOCKED.
//      Si el análisis explota, el lote vuelve a STAGED con el motivo en
//      errorMessage, en vez de reintentarse para siempre cada pocos segundos.
//   2. RUNNING -> DONE: cuando ya no le queda ninguna fila por promover, con
//      los contadores finales materializados (sobreviven a la purga de las
//      filas, §9.4).
//
// Mismo patrón que el resto (setTimeout encadenado, stop que espera la pasada
// en curso). Correcto con más de una instancia: el reclamo es por fila de la
// base, nada vive en memoria entre pasadas (G-04/G-09 de las auditorías
// locales).
// ---------------------------------------------------------------------------

// 10.000 filas en tandas de 500, con un par de consultas por tanda: medido en
// local, unos pocos segundos. El tope es para no dejar una transacción colgada.
export const ANALISIS_TRANSACTION_TIMEOUT_MS = 120_000;

export interface ResumenDeLotes {
  analizados: number;
  terminados: number;
  conError: number;
}

async function analizarUno(resumen: ResumenDeLotes): Promise<boolean> {
  let tomado: { id: string; organizationId: string } | undefined;
  try {
    const hubo = await prisma.$transaction(
      async (tx) => {
        const lote = await claimLoteParaAnalizar(tx);
        if (!lote) return false;
        tomado = { id: lote.id, organizationId: lote.organizationId };
        await analizarLote(lote, tx);
        return true;
      },
      { timeout: ANALISIS_TRANSACTION_TIMEOUT_MS },
    );
    if (hubo) resumen.analizados++;
    return hubo;
  } catch (err) {
    if (!tomado) throw err;
    resumen.conError++;
    logger.error({ err, loteId: tomado.id }, "No se pudo analizar un lote de importación");
    await transicionarLote(tomado.organizationId, tomado.id, ["ANALYZING"], {
      status: "STAGED",
      errorMessage: `No se pudo analizar el lote: ${describirError(err)}`.slice(0, 1000),
    });
    return true;
  }
}

async function terminarUno(resumen: ResumenDeLotes): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const lote = await claimLoteTerminado(tx);
    if (!lote) return false;
    const final = await resumenDeFilas(lote.organizationId, lote.id, tx);
    const previos =
      lote.counters !== null && typeof lote.counters === "object" && !Array.isArray(lote.counters)
        ? lote.counters
        : {};
    await transicionarLote(
      lote.organizationId,
      lote.id,
      ["RUNNING"],
      {
        status: "DONE",
        finishedAt: new Date(),
        counters: { ...previos, final } as unknown as Prisma.InputJsonValue,
      },
      tx,
    );
    resumen.terminados++;
    return true;
  });
}

// Una pasada: analiza y cierra todo lo que haya, de a un lote por vez.
export async function procesarLotes(): Promise<ResumenDeLotes> {
  const resumen: ResumenDeLotes = { analizados: 0, terminados: 0, conError: 0 };
  while (await analizarUno(resumen)) {
    /* uno por transacción */
  }
  while (await terminarUno(resumen)) {
    /* uno por transacción */
  }
  return resumen;
}

export function iniciarWorkerDeLotesDeImportacion(): () => Promise<void> {
  if (!env.IMPORT_BATCH_WORKER_ENABLED) {
    logger.info(
      "Worker de lotes de importación deshabilitado por IMPORT_BATCH_WORKER_ENABLED: la vista previa no se calcula",
    );
    return () => Promise.resolve();
  }
  let detenido = false;
  let timer: NodeJS.Timeout | undefined;
  let tickEnCurso: Promise<void> | undefined;

  const tick = async () => {
    if (detenido) return;
    tickEnCurso = (async () => {
      try {
        const resumen = await procesarLotes();
        if (resumen.analizados + resumen.terminados + resumen.conError > 0) {
          logger.info(resumen, "Lotes de importación");
        }
      } catch (err) {
        logger.error({ err }, "Fallo inesperado en el worker de lotes de importación");
      }
    })();
    await tickEnCurso;
    tickEnCurso = undefined;
    if (!detenido) timer = setTimeout(() => void tick(), env.IMPORT_BATCH_WORKER_POLL_MS);
  };

  timer = setTimeout(() => void tick(), env.IMPORT_BATCH_WORKER_POLL_MS);

  return async () => {
    detenido = true;
    if (timer) clearTimeout(timer);
    await tickEnCurso;
  };
}
