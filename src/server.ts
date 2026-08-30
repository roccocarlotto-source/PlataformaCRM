import { app } from "./app";
import { env } from "./config/env";
import { logger } from "./lib/logger";
import { prisma } from "./lib/prisma";
import { crearShutdown } from "./shutdown";
import { iniciarWorkerDeIngesta } from "./workers/ingestionWorker";
import { iniciarWorkerDeCanales } from "./workers/googleCalendarChannelWorker";
import { iniciarWorkerDeOutbox } from "./workers/outboxWorker";

const server = app.listen(env.PORT, () => {
  logger.info(`Servidor escuchando en el puerto ${env.PORT} (${env.NODE_ENV})`);
});

// El worker de ingesta arranca ACÁ y no en app.ts, y la distinción no es
// estilística: app.ts arma la instancia de Express y lo importan los tests de
// integración, que levantan sus propias apps. Un worker que arrancara ahí
// encendería un timer en cada test que importe una ruta, drenando la cola por
// debajo de las afirmaciones del propio test. Vive con el proceso servidor, que
// es lo único que de verdad tiene que drenarla.
const detenerWorker = iniciarWorkerDeIngesta();

// El worker de eventos salientes, por el mismo motivo y con el mismo criterio:
// vive con el proceso servidor, no con la instancia de Express. Son dos timers
// independientes a propósito — la cola de entrada y la de salida no comparten
// cadencia, ni lote, ni razones para estar caídas.
const detenerWorkerDeOutbox = iniciarWorkerDeOutbox();

// El worker de canales de Google Calendar (paso 4 del módulo de agenda), por el
// mismo motivo que los otros dos: vive con el proceso servidor, no con la
// instancia de Express. Su cadencia es de UNA HORA y no de cinco segundos —
// vigila canales que duran siete días, no una cola— así que es el único de los
// tres cuyo tick normal no hace nada.
const detenerWorkerDeCanales = iniciarWorkerDeCanales();

// El apagado ordenado (M-12 de docs/auditoria-2026-08-29.md). La orquestación
// vive en shutdown.ts, sin efectos de lado y con todo inyectado, para poder
// probarla sin señales reales; acá solo se cablean los efectos de verdad.
const shutdown = crearShutdown({
  cerrarServidor: () =>
    new Promise<void>((resolve) => {
      server.close(() => resolve());
      // server.close() espera a TODAS las conexiones, incluidas las keep-alive
      // inactivas que un cliente puede sostener para siempre. Esto cierra ahora
      // mismo las que no tienen un request en vuelo; las que sí lo tienen se
      // dejan terminar solas, que es lo correcto.
      server.closeIdleConnections();
    }),
  // Los tres stops esperan a la pasada en curso de su worker (M-12 c): cada
  // evento va en su propia transacción y ninguna queda a medias, y los que no
  // llegó a tocar siguen en PENDING para el próximo arranque.
  detenerWorkers: async () => {
    await Promise.all([detenerWorker(), detenerWorkerDeOutbox(), detenerWorkerDeCanales()]);
  },
  desconectarPrisma: () => prisma.$disconnect(),
  salir: (codigo) => process.exit(codigo),
  logger,
  timeoutMs: env.SHUTDOWN_TIMEOUT_MS,
});

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

// Node ≥ 15 termina el proceso ante un unhandledRejection SIN pasar por ningún
// handler de señal: sin esto no había $disconnect(), ni log estructurado de qué
// pasó, ni chance de que un worker terminara su pasada (M-12 b).
process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "unhandledRejection no manejado: iniciando shutdown");
  void shutdown("unhandledRejection");
});
