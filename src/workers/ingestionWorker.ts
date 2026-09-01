import { env } from "../config/env";
import { logger } from "../lib/logger";
import { prisma, type Db } from "../lib/prisma";
import {
  claimNextPendingEvent,
  type EventoReclamado,
} from "../repositories/ingestionEvent.repository";
import { promoverEvento, type ResultadoPromocion } from "../services/promotion.service";

// ---------------------------------------------------------------------------
// Worker in-process con polling (§5 de docs/ingestion-architecture.md, "para R1
// puede ser un proceso in-process con polling").
//
// POR QUÉ POLLING Y NO OTRA COSA: no hay librería de colas en package.json y
// agregar una (BullMQ, pg-boss) traería Redis o un esquema propio para un
// volumen que hoy no existe. LISTEN/NOTIFY de Postgres sería la alternativa sin
// dependencias, pero pierde los avisos emitidos mientras el worker está caído —
// habría que combinarlo IGUAL con un polling de respaldo, así que el polling
// solo es la mitad simple del mismo resultado.
//
// EL PUNTO QUE §5 SUBRAYA Y ACÁ SE CUMPLE: "la promoción no vive en el ciclo del
// request". El endpoint responde 202 y termina; esto corre aparte, en su propio
// tiempo, y si tarda o falla no afecta a ningún emisor.
//
// DÓNDE ARRANCA: en server.ts, no en app.ts. La distinción importa —
// app.ts arma la instancia de Express y lo importan los tests de integración,
// que levantan sus propias apps. Si el worker arrancara ahí, cada test que
// importa una ruta encendería un timer que drena la cola por debajo de sus
// propias afirmaciones. Al vivir en server.ts, solo corre cuando corre el
// servidor de verdad.
//
// LO QUE ESTE WORKER NO ES: no es distribuido, pero tampoco necesita serlo para
// ser correcto con varias instancias. El reclamo usa FOR UPDATE SKIP LOCKED
// (ver claimNextPendingEvent), así que dos procesos nunca toman el mismo
// evento: se reparten la cola. Lo que NO tiene es coordinación de cadencia —
// con N instancias hay N pollings, o sea N veces más consultas vacías cuando la
// cola está vacía. Con el default de 5 segundos eso es despreciable; con una
// cadencia agresiva y muchas réplicas, no.
// ---------------------------------------------------------------------------

export interface ResumenDrenado {
  procesados: number;
  fallidos: number;
  // Eventos que no se pudieron procesar por un error de SISTEMA (no de datos):
  // quedaron en PENDING con su próximo turno programado por backoff (B-30) y
  // se reintentan cuando les toque.
  pospuestos: number;
  // Eventos que agotaron sus reintentos contra un error de sistema y pasaron a
  // DEAD_LETTER (B-30) — espejo de ResumenDeEntrega.muertos en outbox: es lo
  // único de esta cola que nadie va a reintentar solo.
  muertos: number;
}

export interface OpcionesDrenado {
  // Tope de eventos por pasada. Existe para que una cola enorme no monopolice
  // el proceso: se drena un tramo, se cede el control, y el siguiente tick
  // sigue donde quedó.
  limite?: number;
  // Acota el drenado a una organización. Producción no lo usa; ver
  // claimNextPendingEvent.
  organizationId?: string;
  // SOLO PARA TESTS (M-19 de docs/auditoria-2026-08-29.md): se ejecuta DENTRO
  // de la transacción del evento, después del reclamo con SKIP LOCKED y antes
  // de promoverlo. Es el único punto donde un test puede sostener un drenado a
  // mitad de camino —con su fila reclamada y su transacción abierta— y
  // confirmar contra pg_stat_activity que un segundo drenado está vivo AL
  // MISMO TIEMPO, en vez de inferir el solapamiento de un resultado que una
  // ejecución secuencial produciría igual. Producción no lo pasa nunca.
  antesDePromover?: (evento: EventoReclamado, tx: Db) => Promise<void>;
}

// Drena hasta `limite` eventos pendientes. Cada evento va en SU PROPIA
// TRANSACCIÓN, y eso es lo que hace estructural el requisito de §5 de que una
// fila mala no aborte el lote: no hay ninguna transacción compartida que una
// fila pueda abortar.
export async function drenarPendientes(opciones: OpcionesDrenado = {}): Promise<ResumenDrenado> {
  const limite = opciones.limite ?? env.INGEST_WORKER_BATCH_SIZE;
  const resumen: ResumenDrenado = { procesados: 0, fallidos: 0, pospuestos: 0, muertos: 0 };

  // Ids que fallaron por error de sistema en ESTA pasada. Sin esta lista el
  // siguiente reclamo volvería a elegir la misma fila —es la más vieja y sigue
  // en PENDING— y el drenado se quedaría girando sobre ella sin llegar nunca a
  // las siguientes. Es la mitad estructural de "una fila mala no aborta el
  // lote" para el error que NO es de datos.
  const pospuestos: string[] = [];

  for (let i = 0; i < limite; i++) {
    let resultado: ResultadoPromocion | null;
    // Se captura FUERA de la transacción a propósito: si algo explota adentro,
    // la transacción se revierte y el evento ya no es alcanzable desde el
    // catch. Sin esto no habría a quién posponer y el bucle volvería a elegir
    // la misma fila hasta agotar el límite de la pasada. Con B-30 se capturan
    // también organizationId y attempts: son lo que el catch necesita para
    // contabilizar el fallo en la propia fila.
    let reclamado: { id: string; organizationId: string; attempts: number } | undefined;

    try {
      resultado = await prisma.$transaction(async (tx) => {
        const evento = await claimNextPendingEvent(tx, {
          organizationId: opciones.organizationId,
          excluir: pospuestos,
        });

        if (!evento) {
          return null;
        }

        reclamado = {
          id: evento.id,
          organizationId: evento.organizationId,
          attempts: evento.attempts,
        };
        await opciones.antesDePromover?.(evento, tx);
        return await promoverEvento(evento, tx);
      });
    } catch (err) {
      // Un error acá NO es una fila mala: los payloads inválidos ya se
      // marcaron FAILED adentro, sin lanzar. Lo que llega hasta este catch es
      // un problema de sistema —la base no responde, una constraint que la
      // validación no anticipó— y la transacción ya se revirtió, así que el
      // evento sigue en PENDING.
      if (!reclamado) {
        // Falló antes de llegar a reclamar nada (la base no responde). No hay
        // fila que posponer y seguir iterando solo repetiría el mismo fallo:
        // se corta la pasada y se reintenta en el próximo tick.
        resumen.pospuestos++;
        logger.error({ err }, "No se pudo reclamar un evento de ingesta");
        break;
      }

      // B-30 de docs/auditoria-2026-08-29.md: el fallo se CONTABILIZA en la
      // fila. Antes solo se posponía en memoria y un error determinístico para
      // este contenido se repetía en cada tick, para siempre, sin que nada lo
      // detuviera ni lo señalara. Este catch es el ÚNICO lugar que puede
      // contarlo: a diferencia de outbox —donde el fallo del handler se
      // resuelve DENTRO de la transacción y el catch de afuera es solo
      // infraestructura—, acá promoverEvento ya resolvió la fila mala
      // internamente (FAILED, sin lanzar), así que lo que llega es por
      // descarte el error de sistema, transitorio o determinístico, y ninguna
      // otra capa lo distingue.
      //
      // La escritura va SUELTA con el prisma de nivel superior: la transacción
      // del reclamo ya se revirtió, y el updateMany con status: PENDING en el
      // WHERE es su propio compare-and-swap. Y va en su propio try: si la base
      // es justamente lo que está caído, registrar el intento también falla —
      // se loguea y la fila queda como quedaba antes de B-30 (PENDING, sin
      // contar), que es el mejor comportamiento disponible en ese estado.
      // MUTACIÓN 2 — NO MERGEAR: sin contabilización (comportamiento pre-B-30)
      resumen.pospuestos++;
      pospuestos.push(reclamado.id);
      logger.error(
        { err, eventoId: reclamado.id },
        "Error de sistema al promover un evento de ingesta: queda en PENDING para reintentar",
      );
      continue;
    }

    if (resultado === null) {
      break; // no queda nada pendiente
    }

    if (resultado.estado === "PROCESSED") {
      resumen.procesados++;
    } else {
      resumen.fallidos++;
    }
  }

  return resumen;
}

// Bucle de polling. setTimeout encadenado y NO setInterval: con setInterval un
// drenado que tarde más que el intervalo se solaparía con el siguiente, y dos
// pasadas concurrentes del mismo proceso competirían por los mismos locks.
// Encadenando, el próximo tick se agenda recién cuando el anterior terminó.
// SOLO PARA TESTS (M-12): el tick de producción no pasa nada y el
// comportamiento sin opciones es el de siempre. Permite arrancar el bucle con
// una cadencia corta y una pasada controlada por el test —una promesa que el
// test resuelve a mano— para probar que detener() espera al tick en curso sin
// base, sin timers reales y sin condiciones de carrera de timing.
export interface OpcionesDelWorker {
  pollMs?: number;
  drenar?: () => Promise<ResumenDrenado>;
}

// Devuelve el stop del worker. Es ASÍNCRONO (M-12 c): resuelve recién cuando
// no queda ninguna pasada en curso, para que el shutdown pueda desconectar
// Prisma sin cortar una transacción a medias.
export function iniciarWorkerDeIngesta(opciones: OpcionesDelWorker = {}): () => Promise<void> {
  if (!env.INGEST_WORKER_ENABLED) {
    logger.info(
      "Worker de ingesta deshabilitado por INGEST_WORKER_ENABLED: los eventos quedan en PENDING",
    );
    return () => Promise.resolve();
  }

  const pollMs = opciones.pollMs ?? env.INGEST_WORKER_POLL_MS;
  const drenar = opciones.drenar ?? (() => drenarPendientes());

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
        if (resumen.procesados + resumen.fallidos + resumen.pospuestos + resumen.muertos > 0) {
          logger.info(resumen, "Drenado de ingesta");
        }
        if (resumen.muertos > 0) {
          // Con nombre propio y en warn, igual que el worker de outbox: un
          // DEAD_LETTER es lo único de esta cola que NADIE va a reintentar. Si
          // solo apareciera dentro del resumen en info, se perdería entre los
          // drenados normales.
          logger.warn(
            { muertos: resumen.muertos },
            "Eventos de ingesta que agotaron sus reintentos por error de sistema: requieren revisión manual",
          );
        }
      } catch (err) {
        // Red de seguridad del bucle: drenarPendientes ya atrapa por evento, así
        // que llegar acá significa que falló algo fuera de ese alcance. El bucle
        // NO puede morir por eso — si muere, la cola deja de drenarse en silencio
        // y nada lo avisa hasta que alguien mira la tabla.
        logger.error({ err }, "Fallo inesperado en el drenado de ingesta");
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
      batchSize: env.INGEST_WORKER_BATCH_SIZE,
    },
    "Worker de ingesta iniciado",
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
