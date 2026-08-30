import { env } from "../config/env";
import { logger } from "../lib/logger";
import { prisma } from "../lib/prisma";
import { claimNextClaimableEvent } from "../repositories/outboxEvent.repository";
import { entregarEvento, type ResultadoDeEntrega } from "../services/outbox.service";
import type { RegistroDeHandlers } from "../services/outboxHandlers";
import { registroDeHandlers } from "../services/outboxHandlers";

// ---------------------------------------------------------------------------
// Worker in-process con polling del motor de eventos salientes.
//
// Calca ingestionWorker.ts a propósito. Las decisiones de aquel archivo valen
// idénticas acá y no se repiten enteras: polling en vez de una librería de
// colas (no hay ninguna en package.json y LISTEN/NOTIFY pierde los avisos
// emitidos mientras el worker está caído, así que habría que combinarlo IGUAL
// con un polling de respaldo), setTimeout encadenado en vez de setInterval, y
// arranque en server.ts y no en app.ts.
//
// DÓNDE ARRANCA, que es lo que más fácil se rompe: en server.ts. app.ts arma la
// instancia de Express y lo importan los tests de integración, que levantan sus
// propias apps. Si el worker arrancara ahí, cada test que importa una ruta
// encendería un timer que drena la cola por debajo de sus propias afirmaciones.
//
// LO QUE ESTE WORKER AGREGA respecto del de ingesta: reintentos. Un fallo de
// entrega no es terminal —el destino externo puede estar caído— así que el
// evento vuelve a PENDING con su próximo turno en el futuro, y solo pasa a
// DEAD_LETTER al agotar los intentos. Toda esa decisión vive en
// outbox.service.ts; acá solo se recorre la cola.
// ---------------------------------------------------------------------------

export interface ResumenDeEntrega {
  entregados: number;
  reprogramados: number;
  muertos: number;
  // Eventos que no se pudieron resolver por un error de SISTEMA (no del
  // handler): la transacción se revirtió, quedaron como estaban, y se
  // reintentan en la próxima pasada.
  pospuestos: number;
}

export interface OpcionesDeDrenado {
  limite?: number;
  // Acota el drenado a una organización. Producción no lo usa; existe para que
  // un test drene de forma determinística sin depender de que el resto de la
  // tabla esté vacía. Mismo criterio que en el worker de ingesta.
  organizationId?: string;
  // Permite que un test corra con SU PROPIO registro de handlers en vez del
  // singleton de producción — ver outboxHandlers.ts.
  registro?: RegistroDeHandlers;
}

// Drena hasta `limite` eventos entregables. Cada evento va en SU PROPIA
// TRANSACCIÓN: no hay ninguna transacción compartida que un evento malo pueda
// abortar, así que un handler que revienta no arrastra a los demás.
export async function drenarOutbox(opciones: OpcionesDeDrenado = {}): Promise<ResumenDeEntrega> {
  const limite = opciones.limite ?? env.OUTBOX_WORKER_BATCH_SIZE;
  const registro = opciones.registro ?? registroDeHandlers;
  const resumen: ResumenDeEntrega = {
    entregados: 0,
    reprogramados: 0,
    muertos: 0,
    pospuestos: 0,
  };

  // Ids que fallaron por error de sistema en ESTA pasada. Sin esta lista el
  // siguiente reclamo volvería a elegir la misma fila —sigue en PENDING y sigue
  // siendo la de turno más viejo— y el drenado se quedaría girando sobre ella.
  const pospuestos: string[] = [];

  for (let i = 0; i < limite; i++) {
    let resultado: ResultadoDeEntrega | null;
    // Se captura FUERA de la transacción a propósito: si algo explota adentro,
    // la transacción se revierte y el evento ya no es alcanzable desde el
    // catch. Sin este id no habría a quién posponer.
    let idReclamado: string | undefined;

    try {
      resultado = await prisma.$transaction(
        async (tx) => {
          const evento = await claimNextClaimableEvent(tx, {
            organizationId: opciones.organizationId,
            excluir: pospuestos,
          });

          if (!evento) {
            return null;
          }

          idReclamado = evento.id;
          return await entregarEvento(evento, tx, { registro });
        },
        {
          // El default de Prisma son 5 s, y la entrega puede tardar lo que tarde
          // el handler. Se le da su tope más un margen para que el que corte sea
          // SIEMPRE el tope del handler —que falla adentro y deja el fallo
          // registrado— y nunca el de la transacción, que revertiría ese mismo
          // registro. Ver ejecutarConTope en outbox.service.ts.
          timeout: env.OUTBOX_HANDLER_TIMEOUT_MS + 5000,
        },
      );
    } catch (err) {
      // Un error acá NO es un handler que falló: eso ya se tradujo adentro a
      // REINTENTAR o DEAD_LETTER, sin lanzar. Lo que llega hasta este catch es
      // un problema de sistema —la base no responde, la transacción expiró— y
      // ya se revirtió, así que el evento quedó exactamente como estaba.
      //
      // Se pospone en vez de contarlo como fallo de entrega: gastarle un intento
      // a un evento por un corte de red del lado de la base lo acercaría a
      // DEAD_LETTER por algo que no tiene nada que ver con su destino.
      resumen.pospuestos++;
      if (idReclamado) {
        pospuestos.push(idReclamado);
      } else {
        // Falló antes de llegar a reclamar nada. No hay fila que posponer y
        // seguir iterando solo repetiría el mismo fallo: se corta la pasada.
        logger.error({ err }, "No se pudo reclamar un evento saliente");
        break;
      }
      logger.error(
        { err, eventoId: idReclamado },
        "Error de sistema entregando un evento saliente: queda como estaba para reintentar",
      );
      continue;
    }

    if (resultado === null) {
      break; // no queda nada entregable
    }

    if (resultado.estado === "PROCESSED") {
      resumen.entregados++;
    } else if (resultado.estado === "REINTENTAR") {
      resumen.reprogramados++;
    } else {
      resumen.muertos++;
    }
  }

  return resumen;
}

// SOLO PARA TESTS (M-12): el tick de producción no pasa nada y el
// comportamiento sin opciones es el de siempre. Permite arrancar el bucle con
// una cadencia corta y una pasada controlada por el test —una promesa que el
// test resuelve a mano— para probar que detener() espera al tick en curso sin
// base, sin timers reales y sin condiciones de carrera de timing.
export interface OpcionesDelWorker {
  pollMs?: number;
  drenar?: () => Promise<ResumenDeEntrega>;
}

// Devuelve el stop del worker. Es ASÍNCRONO (M-12 c): resuelve recién cuando
// no queda ninguna pasada en curso. Es el escenario literal del hallazgo:
// SIGTERM mientras entregarEvento está dentro del handler — el handler
// completa su efecto externo, y sin esta espera $disconnect() llegaba antes de
// markOutboxEventProcessed, la transacción se revertía y el evento se
// entregaba OTRA VEZ al reiniciar.
export function iniciarWorkerDeOutbox(opciones: OpcionesDelWorker = {}): () => Promise<void> {
  if (!env.OUTBOX_WORKER_ENABLED) {
    logger.info(
      "Worker de eventos salientes deshabilitado por OUTBOX_WORKER_ENABLED: los eventos quedan en PENDING",
    );
    return () => Promise.resolve();
  }

  const pollMs = opciones.pollMs ?? env.OUTBOX_WORKER_POLL_MS;
  const drenar = opciones.drenar ?? (() => drenarOutbox());

  let detenido = false;
  let timer: NodeJS.Timeout | undefined;
  // La promesa del tick que está corriendo ahora mismo, si hay uno. Es lo que
  // el stop espera.
  let tickEnCurso: Promise<void> | undefined;

  const tick = async () => {
    if (detenido) {
      return;
    }

    tickEnCurso = (async () => {
      try {
        const resumen = await drenar();
        if (resumen.entregados + resumen.reprogramados + resumen.muertos + resumen.pospuestos > 0) {
          logger.info(resumen, "Drenado de eventos salientes");
        }
        if (resumen.muertos > 0) {
          // Con nombre propio y en warn: un DEAD_LETTER es lo único de este
          // worker que NADIE va a reintentar. Si solo apareciera dentro del
          // resumen en info, se perdería entre los drenados normales.
          logger.warn(
            { muertos: resumen.muertos },
            "Eventos salientes que agotaron sus intentos o no tienen handler: requieren revisión manual",
          );
        }
      } catch (err) {
        // Red de seguridad del bucle: drenarOutbox ya atrapa por evento, así que
        // llegar acá significa que falló algo fuera de ese alcance. El bucle NO
        // puede morir por eso — si muere, la cola deja de drenarse en silencio.
        logger.error({ err }, "Fallo inesperado en el drenado de eventos salientes");
      }
    })();

    await tickEnCurso;

    if (!detenido) {
      timer = setTimeout(() => void tick(), pollMs);
    }
  };

  logger.info(
    {
      pollMs,
      batchSize: env.OUTBOX_WORKER_BATCH_SIZE,
      maxAttempts: env.OUTBOX_MAX_ATTEMPTS,
      // Qué tipos sabe atender ESTE proceso. Es lo primero que uno quiere saber
      // cuando un evento termina en DEAD_LETTER por handler ausente; hoy la
      // lista está vacía porque todavía no hay consumidores.
      handlers: registroDeHandlers.tiposRegistrados(),
    },
    "Worker de eventos salientes iniciado",
  );

  timer = setTimeout(() => void tick(), pollMs);

  return async () => {
    detenido = true;
    if (timer) {
      clearTimeout(timer);
    }
    // Si hay un tick corriendo AHORA MISMO, esto espera a que termine su `for`
    // completo (todas las transacciones de esta pasada) antes de resolver. Es lo
    // que cierra M-12 (c): sin esto, clearTimeout cancelaba el PRÓXIMO tick pero
    // nada esperaba al que estaba en curso, y $disconnect() podía llegar entre el
    // efecto externo de una pasada y el UPDATE que lo deja registrado — la
    // transacción se revertía y el trabajo se repetía al reiniciar. Se espera el
    // tick COMPLETO y no solo la transacción actual porque interrumpir a mitad
    // del bucle exigiría enhebrar una cancelación por todo el drenado, y el peor
    // caso de esperar está acotado por un lote (batch size × tiempo por evento).
    await tickEnCurso;
  };
}
