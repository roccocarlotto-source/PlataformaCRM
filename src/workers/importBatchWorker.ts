import { Prisma } from "@prisma/client";
import { env } from "../config/env";
import { logger } from "../lib/logger";
import { prisma } from "../lib/prisma";
import {
  claimLoteParaAnalizar,
  claimLoteParaDeshacer,
  claimLoteTerminado,
  confirmarFilas,
  resumenDeFilas,
  transicionarLote,
} from "../repositories/importacion.repository";
import { analizarLote } from "../services/importacionAnalisis.service";
import { deshacerLote } from "../services/importacionDeshacer.service";
import { marcarFaltantes } from "../services/importacionSync.service";
import { describirError } from "../utils/backoff";
import { anotarSiLaBaseNoResponde, laBaseEstaCaida } from "./esperaDeLaBase";
import { crearTemporizadorDeSondeo } from "./temporizadorDeSondeo";

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
//   3. UNDOING -> UNDONE: deshacer lo creado (importacionDeshacer.service.ts).
//      Si falla, el lote vuelve a DONE con el motivo, como el análisis.
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
  deshechos: number;
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
        // Una corrida de una sincronización se confirma sola, sin vista
        // previa (§7): en la misma transacción que la dejó READY.
        if (lote.originKind === "SYNC") {
          await transicionarLote(
            lote.organizationId,
            lote.id,
            ["READY"],
            { status: "RUNNING", confirmedAt: new Date() },
            tx,
          );
          await confirmarFilas(lote.organizationId, lote.id, tx);
        }
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

async function deshacerUno(resumen: ResumenDeLotes): Promise<boolean> {
  let tomado: { id: string; organizationId: string } | undefined;
  try {
    const hubo = await prisma.$transaction(
      async (tx) => {
        const lote = await claimLoteParaDeshacer(tx);
        if (!lote) return false;
        tomado = { id: lote.id, organizationId: lote.organizationId };
        await deshacerLote(lote, tx);
        return true;
      },
      { timeout: ANALISIS_TRANSACTION_TIMEOUT_MS },
    );
    if (hubo) resumen.deshechos++;
    return hubo;
  } catch (err) {
    if (!tomado) throw err;
    resumen.conError++;
    logger.error({ err, loteId: tomado.id }, "No se pudo deshacer un lote de importación");
    await transicionarLote(tomado.organizationId, tomado.id, ["UNDOING"], {
      status: "DONE",
      errorMessage: `No se pudo deshacer el lote: ${describirError(err)}`.slice(0, 1000),
    });
    return true;
  }
}

// Cerrar un lote puede fallar (marcar las unidades que faltan de una
// sincronización, el resumen de filas). Sin este catch, el error cortaba la
// pasada entera y, como el lote seguía RUNNING, la próxima volvía a fallar con
// él: no se cerraba ni se deshacía ningún lote de ninguna organización
// (NEG-02 de docs-privados/auditoria-2026-10-21, local). Ahora el lote queda
// DONE con errorMessage, mismo criterio que deshacerUno: sus filas ya se
// procesaron, lo que falló es el cierre, y sale de la cola.
async function terminarUno(resumen: ResumenDeLotes): Promise<boolean> {
  let tomado: { id: string; organizationId: string } | undefined;
  try {
    return await terminarUnoEnTransaccion(resumen, (lote) => {
      tomado = lote;
    });
  } catch (err) {
    if (!tomado) throw err;
    resumen.conError++;
    logger.error({ err, loteId: tomado.id }, "No se pudo cerrar un lote de importación");
    await transicionarLote(tomado.organizationId, tomado.id, ["RUNNING"], {
      status: "DONE",
      finishedAt: new Date(),
      errorMessage: `No se pudo cerrar el lote: ${describirError(err)}`.slice(0, 1000),
    });
    return true;
  }
}

async function terminarUnoEnTransaccion(
  resumen: ResumenDeLotes,
  alTomar: (lote: { id: string; organizationId: string }) => void,
): Promise<boolean> {
  return prisma.$transaction(
    async (tx) => {
      const lote = await claimLoteTerminado(tx);
      if (!lote) return false;
      alTomar({ id: lote.id, organizationId: lote.organizationId });
      const final = await resumenDeFilas(lote.organizationId, lote.id, tx);
      // Una corrida de una sincronización: las unidades que ya no están en la
      // planilla (§7).
      const sync = await marcarFaltantes(lote, tx);
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
          counters: {
            ...previos,
            final,
            ...(sync ? { sync } : {}),
          } as unknown as Prisma.InputJsonValue,
        },
        tx,
      );
      resumen.terminados++;
      return true;
    },
    { timeout: ANALISIS_TRANSACTION_TIMEOUT_MS },
  );
}

// Una pasada: analiza y cierra todo lo que haya, de a un lote por vez. Cada
// bucle atrapa lo suyo: que falle el análisis (la base, por ejemplo) no deja
// sin cerrar ni deshacer los lotes de las demás organizaciones.
export async function procesarLotes(): Promise<ResumenDeLotes> {
  const resumen: ResumenDeLotes = { analizados: 0, terminados: 0, deshechos: 0, conError: 0 };
  const pasos: [string, (r: ResumenDeLotes) => Promise<boolean>][] = [
    ["analizar", analizarUno],
    ["cerrar", terminarUno],
    ["deshacer", deshacerUno],
  ];
  for (const [paso, uno] of pasos) {
    try {
      while (await uno(resumen)) {
        /* uno por transacción */
      }
    } catch (err) {
      if (!anotarSiLaBaseNoResponde(err)) {
        logger.error(
          { err, paso },
          "Falló un paso del worker de lotes de importación; sigue el próximo",
        );
      }
    }
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
  let tickEnCurso: Promise<void> | undefined;

  const tick = async () => {
    if (detenido) return;
    let huboTrabajo = false;
    tickEnCurso = (async () => {
      try {
        if (laBaseEstaCaida()) return;
        const resumen = await procesarLotes();
        huboTrabajo =
          resumen.analizados + resumen.terminados + resumen.deshechos + resumen.conError > 0;
        if (huboTrabajo) {
          logger.info(resumen, "Lotes de importación");
        }
      } catch (err) {
        if (!anotarSiLaBaseNoResponde(err)) {
          logger.error({ err }, "Fallo inesperado en el worker de lotes de importación");
        }
      }
    })();
    await tickEnCurso;
    tickEnCurso = undefined;
    if (!detenido) reloj.programar(huboTrabajo);
  };

  // Sin trabajo, espera cada vez más, hasta 60 s; quien encola lo despierta
  // (workers/temporizadorDeSondeo.ts).
  const reloj = crearTemporizadorDeSondeo({
    cola: "lotes",
    minimoMs: env.IMPORT_BATCH_WORKER_POLL_MS,
    maximoMs: 60_000,
    pasada: () => void tick(),
  });
  reloj.arrancar(env.IMPORT_BATCH_WORKER_POLL_MS);

  return async () => {
    detenido = true;
    reloj.detener();
    await tickEnCurso;
  };
}
