import { env } from "../config/env";
import { describirError, resolverFallo } from "../utils/backoff";
import { logger } from "../lib/logger";
import type { Db } from "../lib/prisma";
import {
  markOutboxEventDeadLetter,
  markOutboxEventProcessed,
  rescheduleOutboxEvent,
  type EventoReclamado,
} from "../repositories/outboxEvent.repository";
import type { RegistroDeHandlers } from "./outboxHandlers";
import { registroDeHandlers as registroPorDefecto } from "./outboxHandlers";

// ---------------------------------------------------------------------------
// La entrega de UN evento saliente, y las decisiones puras que la gobiernan.
//
// Análogo a promotion.service.ts en la capa de ingesta: el worker recorre la
// cola, esto resuelve un evento. La separación permite que el worker no sepa
// nada de reintentos y que los reintentos se puedan probar sin base.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// DECISIONES PURAS
// ---------------------------------------------------------------------------

// Desde B-30 (docs/auditoria-2026-08-29.md) viven en src/utils/backoff.ts,
// compartidas con la cola de ingesta: no tienen nada específico de outbox en su
// firma, y dejarlas acá habría obligado a la capa de ingesta a importar de un
// archivo llamado outbox.service.ts o a duplicar la matemática. Se reexportan
// para que los consumidores y tests existentes sigan importando de acá; la
// lógica no cambió.
export {
  calcularEsperaDeBackoff,
  describirError,
  resolverFallo,
  type ParametrosDeBackoff,
  type ResolucionDeFallo,
} from "../utils/backoff";

// ---------------------------------------------------------------------------
// ENTREGA
// ---------------------------------------------------------------------------

export type EstadoDeEntrega = "PROCESSED" | "REINTENTAR" | "DEAD_LETTER";

export interface ResultadoDeEntrega {
  estado: EstadoDeEntrega;
  attempts: number;
}

export interface OpcionesDeEntrega {
  registro?: RegistroDeHandlers;
  ahora?: Date;
}

// Corre el handler acotado por un tope de tiempo. El tope no es una comodidad:
// esta función corre DENTRO de la transacción del evento, así que un handler
// colgado sostiene el lock de la fila y una conexión del pool. Si lo cortara el
// timeout de Prisma en vez de éste, la transacción se abortaría y el UPDATE de
// attempts/nextAttemptAt se revertiría con ella — el fallo no quedaría
// registrado y el evento se reintentaría para siempre sin avanzar el contador.
//
// Se corre contra el reloj real y no contra `ahora`: `ahora` es la referencia
// para calcular el próximo turno, esto es tiempo de pared.
//
// EL ABORTSIGNAL (M-14 de docs/auditoria-2026-08-29.md) no cancela nada por su
// cuenta — ningún mecanismo de JS puede forzar a una promesa ajena a dejar de
// correr, y Promise.race menos: solo decide a quién se le hace caso primero.
// Lo que hace es darle al handler la SEÑAL para que se pare solo, si la
// respeta (pasándosela a un fetch, por ejemplo). Sin la señal, esta función ya
// cortaba la ESPERA al vencer el tope, pero el handler seguía corriendo
// huérfano: si más tarde completaba, el reintento ya estaba agendado y el
// destino podía recibir el aviso dos veces; y si más tarde lanzaba, nadie
// escuchaba esa segunda promesa y la excepción se perdía sin dejar rastro. Lo
// segundo se arregla siempre, respete el handler la señal o no: el fallo
// tardío queda logueado.
//
// Exportada para poder probarla en aislamiento: es exactamente la función que
// el hallazgo cambia, y no toca la base.
export async function ejecutarConTope(
  handler: (signal: AbortSignal) => Promise<void>,
  topeMs: number,
): Promise<void> {
  const controller = new AbortController();
  let temporizador: NodeJS.Timeout | undefined;

  const promesaDelHandler = handler(controller.signal);

  // Rama SEPARADA de la que mira Promise.race: no consume el rechazo que race
  // necesita ver cuando el handler falla ANTES del tope (ese sigue subiendo
  // normal y entregarEvento lo traduce a REINTENTAR/DEAD_LETTER). Solo actúa
  // cuando la señal ya está abortada, es decir, cuando el fallo llegó tarde —
  // el único caso donde, sin esto, se perdía sin log.
  promesaDelHandler.catch((err: unknown) => {
    if (controller.signal.aborted) {
      logger.warn(
        { err },
        "El handler del outbox falló después de vencer su propio tope — el intento ya se había reprogramado",
      );
    }
  });

  const limite = new Promise<never>((_resolve, reject) => {
    temporizador = setTimeout(() => {
      const motivo = new Error(`el handler no respondió en ${String(topeMs)} ms`);
      controller.abort(motivo);
      reject(motivo);
    }, topeMs);
  });

  try {
    await Promise.race([promesaDelHandler, limite]);
  } finally {
    // Sin esto, el timer pendiente mantiene vivo el event loop hasta que expire
    // — en un test, eso es un proceso que no termina.
    if (temporizador) {
      clearTimeout(temporizador);
    }
  }
}

// Entrega un evento ya reclamado (y bloqueado) y escribe su transición.
//
// TODO OCURRE DENTRO DE `db`, que es la transacción del evento. Es lo que hace
// que no exista un estado en el que la entrega ocurrió pero la fila no lo
// registra: o commitean las dos cosas, o ninguna.
//
// NUNCA LANZA POR UN FALLO DE ENTREGA. Un handler que revienta es el caso
// esperado, no una excepción — se traduce a REINTENTAR o DEAD_LETTER. Lo que sí
// puede lanzar es un fallo de la BASE al escribir la transición, y ahí lanzar es
// lo correcto: la transacción se revierte y el worker lo pospone.

// Calca exigirTransicion de promotion.service.ts (E-1) — B-26 de
// docs/auditoria-2026-08-29.md: las tres transiciones son updateMany con
// status: PENDING en el WHERE, y su { count } se descartaba. Un count === 0
// significa que la fila ya no estaba en PENDING al escribir, y commitear en
// silencio la dejaría pisada con un estado que no corresponde. Error pelado y
// no AppError: esto corre en el worker, no en un request.
//
// HONESTIDAD SOBRE EL ALCANCE, porque acá NO es igual que en la ingesta: en
// promoverEvento, el CAS y la escritura de negocio (crear el Contact) van en
// la misma transacción, así que revertir deshace las dos juntas. Acá el
// handler ya corrió ANTES de la transición — su efecto externo, si lo tiene,
// ya ocurrió y ninguna reversión lo deshace. Este chequeo NO previene
// entregas duplicadas: protege algo más angosto — que la fila no quede
// sobreescrita con un estado incorrecto si alguna vez dejara de ser cierto
// que el reclamo (FOR UPDATE SKIP LOCKED, misma transacción) la mantiene
// bloqueada de punta a punta. Hoy ese camino es inalcanzable; el chequeo
// existe para que el invariante sobreviva a un cambio del mecanismo, igual
// que B-12/B-17.
function exigirTransicion(count: number, evento: EventoReclamado, destino: string): void {
  if (count === 0) {
    throw new Error(
      `entregarEvento: la transición a ${destino} del evento ${evento.id} no afectó ninguna fila ` +
        "— ya no estaba en PENDING al momento de escribir. Se revierte la transacción para no " +
        "pisar el estado que otro actor ya dejó (B-26, docs/auditoria-2026-08-29.md).",
    );
  }
}

export async function entregarEvento(
  evento: EventoReclamado,
  db: Db,
  opciones: OpcionesDeEntrega = {},
): Promise<ResultadoDeEntrega> {
  const registro = opciones.registro ?? registroPorDefecto;
  const ahora = opciones.ahora ?? new Date();

  const handler = registro.obtener(evento.eventType);

  // HANDLER AUSENTE: DEAD_LETTER DIRECTO, SIN GASTAR REINTENTOS. Reintentar no
  // hace aparecer un handler — es un bug de configuración, no una falla
  // transitoria, y consumir los 5 intentos solo retrasaría el diagnóstico
  // varios minutos y ensuciaría el contador. attempts queda como estaba: nadie
  // intentó nada.
  if (!handler) {
    const marcado = await markOutboxEventDeadLetter(
      evento.id,
      evento.organizationId,
      {
        attempts: evento.attempts,
        lastError: `no hay handler registrado para "${evento.eventType}"`,
      },
      db,
    );
    exigirTransicion(marcado.count, evento, "DEAD_LETTER");
    return { estado: "DEAD_LETTER", attempts: evento.attempts };
  }

  try {
    await ejecutarConTope(
      (signal) =>
        handler({
          id: evento.id,
          organizationId: evento.organizationId,
          eventType: evento.eventType,
          payload: evento.payload,
          signal,
        }),
      env.OUTBOX_HANDLER_TIMEOUT_MS,
    );
  } catch (err) {
    const resolucion = resolverFallo(evento.attempts, ahora, {
      maxIntentos: env.OUTBOX_MAX_ATTEMPTS,
      backoff: {
        baseMs: env.OUTBOX_BACKOFF_BASE_MS,
        topeMs: env.OUTBOX_BACKOFF_MAX_MS,
      },
    });
    const lastError = describirError(err);

    if (resolucion.estado === "DEAD_LETTER") {
      const marcado = await markOutboxEventDeadLetter(
        evento.id,
        evento.organizationId,
        { attempts: resolucion.attempts, lastError },
        db,
      );
      exigirTransicion(marcado.count, evento, "DEAD_LETTER");
      return { estado: "DEAD_LETTER", attempts: resolucion.attempts };
    }

    const reprogramado = await rescheduleOutboxEvent(
      evento.id,
      evento.organizationId,
      {
        attempts: resolucion.attempts,
        // No puede ser null en esta rama; el tipo lo permite porque la rama
        // DEAD_LETTER comparte la forma del resultado.
        nextAttemptAt: resolucion.nextAttemptAt ?? ahora,
        lastError,
      },
      db,
    );
    exigirTransicion(reprogramado.count, evento, "REINTENTAR (reschedule)");
    return { estado: "REINTENTAR", attempts: resolucion.attempts };
  }

  const procesado = await markOutboxEventProcessed(evento.id, evento.organizationId, db);
  exigirTransicion(procesado.count, evento, "PROCESSED");
  return { estado: "PROCESSED", attempts: evento.attempts };
}
