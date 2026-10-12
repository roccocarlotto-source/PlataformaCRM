import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { logger } from "../lib/logger";
import { prisma, type Db } from "../lib/prisma";
import {
  leaseVigenteConLaFilaTomada,
  renovarLease,
  soltarLease,
  tomarLease,
  type LeaseDelTurno,
} from "../repositories/agentTurnLease.repository";
import { AppError } from "../utils/AppError";

// ---------------------------------------------------------------------------
// EL LOCK DEL TURNO COMO LEASE (préstamo con vencimiento), con fencing.
//
// Lo usa conLockDeConversacion (agentOrchestration.service.ts). Antes el lock
// era un pg_advisory_xact_lock sostenido por una transacción abierta durante
// todo el turno: cada turno en curso ocupaba una conexión del pool mientras
// esperaba al modelo y a Meta, y el cupo de turnos tenía que quedar por debajo
// del pool. Ahora:
//
//   - TOMAR: un INSERT ... ON CONFLICT que solo gana si la fila no existe o
//     venció (agentTurnLease.repository.ts). Si otro proceso la tiene, se
//     reintenta con espera creciente. Dentro de un proceso los turnos de la
//     misma clave ya esperan en memoria (limitadorDeTurnos), así que esto solo
//     espera de verdad entre procesos (por ejemplo, durante un deploy).
//   - SOSTENER: cada RENOVAR_CADA_MS se extiende el vencimiento a
//     DURACION_DEL_LEASE_MS, solo si sigue siendo de este turno. Si el proceso
//     muere, el lease vence solo, a lo sumo DURACION_DEL_LEASE_MS después.
//   - LÍMITE DEL TURNO: pasado `limiteDelTurnoMs` (AGENT_TURN_LOCK_TIMEOUT_MS)
//     se deja de renovar, igual que antes vencía la transacción del lock.
//   - FENCING (verificar el lease en la misma transacción que escribe): antes
//     de guardar un mensaje saliente, el turno comprueba —con la fila del lease
//     tomada FOR UPDATE— que el lease sigue siendo suyo y no venció. Si lo
//     perdió, no escribe (LeasePerdidoError). Esa garantía era la que daba la
//     transacción abierta: un turno que perdió el lock no responde encima del
//     que lo tomó después.
//   - SOLTAR: un DELETE del lease propio al terminar, haya salido bien o no.
//
// El lease del turno en curso viaja en un AsyncLocalStorage: las funciones que
// guardan mensajes no necesitan recibirlo por parámetro, y fuera de un turno
// (sin lease) el fencing no hace nada.
// ---------------------------------------------------------------------------

export const DURACION_DEL_LEASE_MS = 90_000;
export const RENOVAR_CADA_MS = 30_000;
const ESPERA_INICIAL_MS = 100;
const ESPERA_MAXIMA_ENTRE_INTENTOS_MS = 2_000;

export const MENSAJE_CONVERSACION_OCUPADA =
  "La conversación está ocupada con otra respuesta. Reintentá en unos segundos.";

/** El turno perdió su lease (venció, o lo tomó otro): no escribe nada más. */
export class LeasePerdidoError extends Error {
  constructor(lockKey: string) {
    super(`El turno perdió el lock de la conversación (${lockKey}): no se guarda la respuesta`);
    this.name = "LeasePerdidoError";
  }
}

interface EstadoDelLease {
  lease: LeaseDelTurno;
  perdido: boolean;
}

const leaseEnCurso = new AsyncLocalStorage<EstadoDelLease>();

export interface OpcionesDelLease {
  // Pasado este tiempo de turno se deja de renovar.
  limiteDelTurnoMs: number;
  // Cuánto se espera, como mucho, a que otro proceso suelte la clave.
  esperaMaximaMs: number;
  // Para los tests: leases y renovaciones cortas.
  duracionMs?: number;
  renovarCadaMs?: number;
}

export async function conLeaseDelTurno<T>(
  lockKey: string,
  organizationId: string,
  fn: () => Promise<T>,
  opciones: OpcionesDelLease,
): Promise<T> {
  const duracionMs = opciones.duracionMs ?? DURACION_DEL_LEASE_MS;
  const renovarCadaMs = opciones.renovarCadaMs ?? RENOVAR_CADA_MS;
  const lease: LeaseDelTurno = { lockKey, organizationId, holderId: randomUUID() };

  await esperarYTomar(lease, duracionMs, opciones.esperaMaximaMs);

  const estado: EstadoDelLease = { lease, perdido: false };
  const inicio = Date.now();
  const renovacion = setInterval(() => {
    if (Date.now() - inicio > opciones.limiteDelTurnoMs) {
      clearInterval(renovacion);
      return;
    }
    renovarLease(lease, duracionMs).then(
      (sigue) => {
        if (!sigue) {
          estado.perdido = true;
          clearInterval(renovacion);
          logger.warn({ lockKey, organizationId }, "El turno perdió el lock de la conversación");
        }
      },
      (err: unknown) => {
        // Un error de red: el próximo intento puede andar, y el fencing es la
        // garantía de todos modos.
        logger.warn({ err, lockKey, organizationId }, "No se pudo renovar el lock del turno");
      },
    );
  }, renovarCadaMs);
  renovacion.unref();

  try {
    return await leaseEnCurso.run(estado, fn);
  } finally {
    clearInterval(renovacion);
    try {
      await soltarLease(lease);
    } catch (err) {
      // Vence solo en a lo sumo duracionMs.
      logger.warn({ err, lockKey, organizationId }, "No se pudo soltar el lock del turno");
    }
  }
}

async function esperarYTomar(
  lease: LeaseDelTurno,
  duracionMs: number,
  esperaMaximaMs: number,
): Promise<void> {
  const limite = Date.now() + esperaMaximaMs;
  let espera = ESPERA_INICIAL_MS;
  for (;;) {
    if (await tomarLease(lease, duracionMs)) {
      return;
    }
    if (Date.now() + espera > limite) {
      throw new AppError(MENSAJE_CONVERSACION_OCUPADA, 409);
    }
    await new Promise((resolve) => setTimeout(resolve, espera));
    espera = Math.min(espera * 2, ESPERA_MAXIMA_ENTRE_INTENTOS_MS);
  }
}

/** FENCING dentro de una transacción que ya escribe un mensaje del turno: si
 *  hay un turno en curso y su lease no sigue vigente, lanza LeasePerdidoError
 *  y la transacción no escribe nada. Fuera de un turno no hace nada. */
export async function exigirLeaseVigente(tx: Db): Promise<void> {
  const estado = leaseEnCurso.getStore();
  if (!estado) {
    return;
  }
  if (estado.perdido || !(await leaseVigenteConLaFilaTomada(estado.lease, tx))) {
    estado.perdido = true;
    throw new LeasePerdidoError(estado.lease.lockKey);
  }
}

/** Lo mismo para una escritura suelta: la envuelve en una transacción corta
 *  con el fencing adelante. Fuera de un turno escribe directo. */
export async function conLeaseVigente<T>(escribir: (db: Db) => Promise<T>): Promise<T> {
  if (!leaseEnCurso.getStore()) {
    return escribir(prisma);
  }
  return prisma.$transaction(async (tx) => {
    await exigirLeaseVigente(tx);
    return escribir(tx);
  });
}
