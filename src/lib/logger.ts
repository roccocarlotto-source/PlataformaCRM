import pino from "pino";
import { env } from "../config/env";

// redact es una opción de construcción: pino la resuelve una sola vez al
// crear el logger (vía fast-redact) y la heredan todos los child loggers
// que salgan de esta instancia — incluido el que arma pino-http en app.ts
// (pinoHttp({ logger })) para loguear cada request/response. Por eso tiene
// que vivir acá y no como opción de pinoHttp: sobre un logger ya construido
// no hay forma de agregar redact después.
//
// Cubre los lugares donde un secreto equivalente a credencial puede aparecer
// en un log de esta app: el header Authorization (Bearer JWT), cualquier
// cookie —en el request entrante y en un eventual Set-Cookie de la respuesta—
// y el header X-API-Key de la capa de ingesta. Los serializers por defecto de
// pino-http (req/res) escriben req.headers y res.headers completos si no se
// redactan explícitamente.
//
// x-api-key se agrega ANTES de que exista authenticateApiKey (ítem 4), a
// propósito: es defensa de logging, no autenticación, así que no adelanta
// ninguna funcionalidad, y el costo de olvidarla es que el primer request de
// ingesta que llegue deje una credencial viva en el log.
//
// LO QUE ESTO NO CUBRE, y hay que tener presente: `redact` opera sobre el
// objeto ya serializado, y los serializers de pino-std-serializers escriben
// también req.url, req.query y req.params. Una clave que viaje por querystring
// NO se redacta — por eso la clave de ingesta va en un header y nunca en la
// URL (ver utils/apiKey.ts).
const REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  'req.headers["x-api-key"]',
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
