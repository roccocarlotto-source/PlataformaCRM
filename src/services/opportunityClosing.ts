import type { OpportunityStatus } from "@prisma/client";
import { DateTime } from "luxon";
import { AppError } from "../utils/AppError";

// ---------------------------------------------------------------------------
// Ítem 154 de docs/matriz-de-datos-crm.md — la ETAPA manda sobre el ESTADO, y
// los campos de cierre acompañan al estado. Todo puro y exportado para
// probarlo sin base (opportunityClosing.test.ts); opportunity.service.ts lo
// aplica con las filas leídas.
//
// POR QUÉ ACÁ Y NO SOLO EN EL FRONTEND. El §51 decidió que la etapa es la
// única fuente de verdad del cierre, pero lo cerró solo en la UI
// (frontend/src/features/opportunity/stageStatus.ts): el backend aceptaba
// cualquier combinación. El ítem 150 lo midió: una oportunidad WON parada en
// "Nuevo" (el embudo la mostraba abierta, el dashboard la contaba ganada), una
// OPEN en "Ganado", y una WON sin fecha de cierre que no existía para el
// dashboard. La regla de acá es la MISMA que la del frontend, así que la UI
// (que ya manda etapa y estado coherentes) no nota nada; lo que cambia es para
// todo lo que escribe sin pasar por ella: el agente, la API, los scripts.
// ---------------------------------------------------------------------------

export interface EtapaConMarca {
  id: string;
  isWon: boolean;
  isLost: boolean;
}

// El estado que "significa" una etapa: la ganada cierra ganando, la perdida
// perdiendo, cualquier otra está abierta.
export function estadoDeLaEtapa(etapa: { isWon: boolean; isLost: boolean }): OpportunityStatus {
  if (etapa.isWon) return "WON";
  if (etapa.isLost) return "LOST";
  return "OPEN";
}

export const ESTADO_NO_COINCIDE_CON_ETAPA =
  "El estado no coincide con la etapa: una etapa ganada lleva WON, una perdida LOST, y cualquier otra OPEN";
export const ETAPA_DE_CIERRE_SIN_ESTADO =
  "La etapa elegida cierra la oportunidad: para crearla ahí indicá status (WON o LOST), o elegí una etapa abierta";
export const SIN_ETAPA_PARA_ESE_ESTADO =
  "El pipeline no tiene una etapa para ese estado: mové la oportunidad a una etapa que lo tenga";

export interface ResolverEstadoInput {
  // La etapa con la que la oportunidad QUEDA si no se decide moverla: la del
  // body, o la actual.
  etapa: EtapaConMarca;
  // true si el body trae una etapa DISTINTA de la actual (o si se está
  // creando). Reenviar la misma etapa no es "cambiar de etapa": el formulario
  // manda todos los campos en cada guardado.
  etapaCambia: boolean;
  creando: boolean;
  statusPedido: OpportunityStatus | undefined;
  // undefined al crear.
  statusActual: OpportunityStatus | undefined;
  // Las etapas activas del pipeline efectivo, ordenadas por `order`.
  etapasDelPipeline: readonly EtapaConMarca[];
}

// Devuelve el estado y la etapa con los que la oportunidad queda, o tira 400.
//
//   - Cambia la etapa (o se crea): el estado SALE de la etapa. Si el body
//     también trae un estado, tiene que coincidir. Única excepción, la vía de
//     escape del §51: un pipeline SIN ninguna etapa de ese cierre (P5 del
//     ítem 150) sigue pudiendo cerrar por estado, parado en una etapa abierta.
//     Crear en una etapa de cierre sin decir el estado es 400: derivarlo
//     crearía una venta ganada que nadie pidió (y dispararía opportunity.won).
//   - Solo cambia el estado: la oportunidad se MUEVE a la primera etapa (por
//     orden) que significa ese estado — lo mismo que arrastrarla en el embudo.
//     Si el pipeline no tiene ninguna, vale la misma vía de escape.
//   - Nada cambia (mismo estado, misma etapa): se acepta tal cual, aunque la
//     fila venga en drift de antes de esta regla. Corregir datos viejos que
//     nadie pidió tocar no es trabajo de un guardado (mismo criterio que §50).
export function resolverEstadoYEtapa(input: ResolverEstadoInput): {
  status: OpportunityStatus;
  stageId: string;
} {
  const { etapa, etapaCambia, creando, statusPedido, statusActual, etapasDelPipeline } = input;
  const estadoEtapa = estadoDeLaEtapa(etapa);
  const hayEtapaPara = (estado: OpportunityStatus) =>
    etapasDelPipeline.some((e) => estadoDeLaEtapa(e) === estado);

  if (creando || etapaCambia) {
    if (statusPedido === undefined) {
      if (creando && estadoEtapa !== "OPEN") {
        throw new AppError(ETAPA_DE_CIERRE_SIN_ESTADO, 400);
      }
      return { status: estadoEtapa, stageId: etapa.id };
    }
    if (statusPedido === estadoEtapa) {
      return { status: statusPedido, stageId: etapa.id };
    }
    if (estadoEtapa === "OPEN" && !hayEtapaPara(statusPedido)) {
      return { status: statusPedido, stageId: etapa.id };
    }
    throw new AppError(ESTADO_NO_COINCIDE_CON_ETAPA, 400);
  }

  // Sin cambio de etapa.
  const status = statusPedido ?? statusActual ?? estadoEtapa;
  if (status === statusActual || status === estadoEtapa) {
    return { status, stageId: etapa.id };
  }
  const destino = etapasDelPipeline.find((e) => estadoDeLaEtapa(e) === status);
  if (destino) {
    return { status, stageId: destino.id };
  }
  if (estadoEtapa === "OPEN") {
    return { status, stageId: etapa.id };
  }
  throw new AppError(SIN_ETAPA_PARA_ESE_ESTADO, 400);
}

// ---------------------------------------------------------------------------
// Campos de cierre: actualCloseDate y lostReason acompañan al estado.
// ---------------------------------------------------------------------------

export const ABIERTA_CON_DATOS_DE_CIERRE =
  "Una oportunidad abierta no lleva fecha real de cierre ni motivo de pérdida";
export const GANADA_CON_MOTIVO_DE_PERDIDA = "Una oportunidad ganada no lleva motivo de pérdida";

export interface CamposDeCierre {
  actualCloseDate?: Date | null;
  lostReason?: string | null;
}

// "Hoy" como día del calendario en la zona de la organización, a medianoche
// UTC: así guarda Prisma un @db.Date. Mismo criterio que todayIsoDate del
// frontend (el día LOCAL de quien cierra), que de noche en Montevideo no es el
// día UTC.
export function hoyEnLaZona(timezone: string, ahora: Date = new Date()): Date {
  const dia =
    DateTime.fromJSDate(ahora).setZone(timezone).toISODate() ??
    DateTime.fromJSDate(ahora).toUTC().toISODate();
  return new Date(`${dia}T00:00:00.000Z`);
}

// Devuelve SOLO los campos a escribir (lo que el body trajo, más lo que la
// regla completa). `previo` es el estado antes del cambio (undefined al
// crear) y `actual` los campos de cierre que la fila ya tiene.
//
//   - Queda abierta: traer una fecha de cierre o un motivo es 400. Si VIENE de
//     cerrada (reabrir), los dos se vacían — lo que hace el formulario, que
//     la API no hacía.
//   - Queda ganada: traer un motivo de pérdida es 400; si viene de otro
//     estado, el motivo se vacía.
//   - Queda cerrada (ganada o perdida) sin fecha: la fecha es hoy. Una fecha
//     ya cargada nunca se pisa. Sin esto, una venta ganada sin fecha no
//     existía para el dashboard, que agrupa por actualCloseDate.
//
// Solo actúa cuando hay transición (o creación): un guardado que no cambia el
// estado no reescribe los campos de cierre de una fila vieja.
export function resolverCamposDeCierre(input: {
  status: OpportunityStatus;
  previo: OpportunityStatus | undefined;
  body: CamposDeCierre;
  actual: { actualCloseDate: Date | null; lostReason: string | null };
  hoy: Date;
}): CamposDeCierre {
  const { status, previo, body, actual, hoy } = input;
  const transicion = previo !== status;
  const salida: CamposDeCierre = {};
  if (body.actualCloseDate !== undefined) salida.actualCloseDate = body.actualCloseDate;
  if (body.lostReason !== undefined) salida.lostReason = body.lostReason;

  if (status === "OPEN") {
    if ((body.actualCloseDate ?? null) !== null || (body.lostReason ?? null) !== null) {
      throw new AppError(ABIERTA_CON_DATOS_DE_CIERRE, 400);
    }
    if (transicion && previo !== undefined) {
      salida.actualCloseDate = null;
      salida.lostReason = null;
    }
    return salida;
  }

  if (status === "WON") {
    if ((body.lostReason ?? null) !== null) {
      throw new AppError(GANADA_CON_MOTIVO_DE_PERDIDA, 400);
    }
    if (transicion && actual.lostReason !== null) {
      salida.lostReason = null;
    }
  }

  if (transicion) {
    const fecha =
      body.actualCloseDate !== undefined ? body.actualCloseDate : actual.actualCloseDate;
    if (fecha === null) {
      salida.actualCloseDate = hoy;
    }
  }
  return salida;
}
