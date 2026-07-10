import { app } from "./app";
import { env } from "./config/env";
import { logger } from "./lib/logger";
import { prisma } from "./lib/prisma";

const server = app.listen(env.PORT, () => {
  logger.info(`Servidor escuchando en el puerto ${env.PORT} (${env.NODE_ENV})`);
});

function shutdown(signal: string) {
  logger.info(`${signal} recibido, cerrando servidor...`);
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
