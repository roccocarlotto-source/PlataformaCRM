import { app } from "./app";
import { env } from "./config/env";
import { logger } from "./lib/logger";
import { prisma } from "./lib/prisma";
import { iniciarWorkerDeIngesta } from "./workers/ingestionWorker";
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

function shutdown(signal: string) {
  logger.info(`${signal} recibido, cerrando servidor...`);
  // Antes de cerrar el servidor: deja de agendar pasadas nuevas. Una pasada en
  // curso termina sola —cada evento va en su propia transacción y ninguna queda
  // a medias— y los eventos que no llegó a tocar siguen en PENDING, que es
  // exactamente donde tienen que estar para que los tome el próximo arranque.
  detenerWorker();
  detenerWorkerDeOutbox();

  server.close(() => {
    prisma
      .$disconnect()
      .catch((err) => logger.error({ err }, "Error al desconectar Prisma"))
      .finally(() => {
        logger.info("Servidor cerrado correctamente");
        process.exit(0);
      });
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
