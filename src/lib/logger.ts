import pino from "pino";
import { env } from "../config/env";

// redact es una opción de construcción: pino la resuelve una sola vez al
// crear el logger (vía fast-redact) y la heredan todos los child loggers
// que salgan de esta instancia — incluido el que arma pino-http en app.ts
// (pinoHttp({ logger })) para loguear cada request/response. Por eso tiene
// que vivir acá y no como opción de pinoHttp: sobre un logger ya construido
// no hay forma de agregar redact después.
//
// Cubre los únicos dos lugares donde un secreto equivalente a credencial
// puede aparecer en un log de esta app: el header Authorization (Bearer JWT)
// y cualquier cookie, tanto en el request entrante como en un eventual
// Set-Cookie de la respuesta. Los serializers por defecto de pino-http
// (req/res) escriben req.headers y res.headers completos si no se redactan
// explícitamente.
const REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  'res.headers["set-cookie"]',
];
const REDACT_CENSOR = "[REDACTED]";

// Exportado como objeto completo (no como paths/censor sueltos) para que
// logger.test.ts pueda pasarle este mismo objeto — no una reconstrucción —
// a su propio pino(loggerOptions, sink). Si el ensamblado de `redact` acá
// abajo se rompe (se borra la clave, un typo, una condición que la omite),
// el test lo ve porque usa este objeto real, no valores copiados a mano.
export const loggerOptions = {
  level: env.LOG_LEVEL,
  redact: {
    paths: REDACT_PATHS,
    censor: REDACT_CENSOR,
  },
  transport: env.isDevelopment
    ? {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:standard",
          ignore: "pid,hostname",
        },
      }
    : undefined,
};

export const logger = pino(loggerOptions);
