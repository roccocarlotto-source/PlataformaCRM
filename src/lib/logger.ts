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
// x-external-id NO es una credencial pero SÍ puede ser PII — B-20 de
// docs-privados/auditoria-2026-08-29.md (local, no está en GitHub) (B-3 del 21/08). Es el header por el que la
// fuente identifica al lead en la capa de ingesta (ingest.controller.ts), y
// ingestionEvent.repository.ts documenta que ese externalId "puede ser el
// email del lead". Sin redactarlo, cada request a /api/ingest —o cualquier
// error en esa ruta que pase por errorHandler— dejaba ese email en texto plano
// en req.headers. Mismo tratamiento que x-api-key: se tapa el header, el dato
// sigue entrando al sistema igual.
//
// LO QUE `redact` NO CUBRE: opera sobre rutas fijas del objeto ya
// serializado, y los serializers de pino-std-serializers escriben también
// req.url (con la query string) y req.query. Una credencial que viaja por
// querystring no se puede tapar con una ruta fija dentro de un string. Por eso
// la clave de ingesta va en un header y nunca en la URL (ver utils/apiKey.ts),
// y por eso existe serializarRequest más abajo para las que NO elegimos
// nosotros: el `code`/`state` de los callbacks OAuth (Meta, Google) y el
// `hub.verify_token` del handshake de Meta — E-08 de
// docs-privados/auditoria-2026-09-30-corta.md (local, no está en GitHub).
//
// La PII en la query (`GET /api/contacts?email=…`, B-20 del 29/08 / E-06 del
// 24/09) sigue fuera a propósito: decidir qué filtro es PII es otra lista, y
// esta cubre solo credenciales.
const REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  'req.headers["x-api-key"]',
  'req.headers["x-external-id"]',
  // El token de embed del widget (paso 5b): misma clase de credencial en
  // header que x-api-key, mismo tratamiento. Público por diseño, pero un log
  // no es el lugar donde tiene que vivir.
  'req.headers["x-embed-token"]',
  // El secreto compartido con el Worker de QR (requireInternalProxySecret.ts),
  // que llega en cada /qr/resolve y /vouchers/resolve — E-02 de
  // docs-privados/auditoria-2026-09-24-punta-a-punta.md (local). Con él se
  // saltea el rate limit del Worker.
  'req.headers["x-internal-proxy-secret"]',
  // El token del canal de push de Google Calendar
  // (googleCalendarWebhook.controller.ts): con él se falsifican notificaciones.
  'req.headers["x-goog-channel-token"]',
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

// ---------------------------------------------------------------------------
// Query params que son credenciales y que NO elegimos nosotros: los manda un
// tercero en la URL (Meta, Google) y no hay forma de moverlos a un header.
//   - code / state: la vuelta de los callbacks OAuth de Meta y de Google. Con
//     el `state` vigente (10 min) y un `code` propio, quien lea el log conecta
//     su página a la organización víctima (E-08).
//   - hub.verify_token: el handshake GET de los webhooks de Meta y WhatsApp.
//   - access_token / refresh_token / id_token / client_secret: ninguna ruta los
//     recibe hoy; están por si algún tercero los manda, que es más barato que
//     descubrirlo en un log.
// Se compara el nombre ya decodificado y en minúsculas.
const QUERY_PARAMS_SENSIBLES = new Set([
  "code",
  "state",
  "hub.verify_token",
  "access_token",
  "refresh_token",
  "id_token",
  "client_secret",
]);

function esParamSensible(nombre: string): boolean {
  return QUERY_PARAMS_SENSIBLES.has(nombre.toLowerCase());
}

function decodificar(valor: string): string {
  try {
    return decodeURIComponent(valor.replace(/\+/g, " "));
  } catch {
    return valor;
  }
}

// Tapa el VALOR de los params sensibles y deja el resto de la URL como llegó
// (mismo orden, misma codificación): el log sigue mostrando qué ruta fue y con
// qué parámetros, sin la credencial. Se arma a mano y no con URLSearchParams
// para no recodificar lo que no se toca. Un nombre con corchetes (`code[x]=`,
// que qs convierte en objeto) se tapa igual: se mira el nombre hasta el `[`.
export function redactarUrl(url: string): string {
  const inicioQuery = url.indexOf("?");
  if (inicioQuery === -1) return url;

  const ruta = url.slice(0, inicioQuery);
  const query = url.slice(inicioQuery + 1);
  const partes = query.split("&").map((parte) => {
    const igual = parte.indexOf("=");
    const nombreCrudo = igual === -1 ? parte : parte.slice(0, igual);
    const nombre = decodificar(nombreCrudo).split("[")[0];
    return esParamSensible(nombre) ? `${nombreCrudo}=${REDACT_CENSOR}` : parte;
  });
  return `${ruta}?${partes.join("&")}`;
}

function redactarQuery(query: unknown): unknown {
  if (!query || typeof query !== "object") return query;
  const copia: Record<string, unknown> = {};
  for (const [nombre, valor] of Object.entries(query)) {
    copia[nombre] = esParamSensible(nombre) ? REDACT_CENSOR : valor;
  }
  return copia;
}

// Serializer de `req` para pino-http. pino-http lo envuelve con
// wrapRequestSerializer, así que recibe el objeto que ya armó
// pino-std-serializers (con url, query, params y headers) y lo que devuelve es
// lo que se escribe — y DESPUÉS pasa por `redact`, que sigue tapando los
// headers de REDACT_PATHS. `query` es una referencia al req.query real de
// Express: se reemplaza por una copia, nunca se muta.
export function serializarRequest<T extends { url?: unknown; query?: unknown }>(req: T): T {
  if (typeof req.url === "string") req.url = redactarUrl(req.url);
  req.query = redactarQuery(req.query);
  return req;
}

// Las opciones con las que app.ts monta pino-http, exportadas para que
// logger.test.ts arme el mismo middleware contra un logger en memoria: si
// alguien saca el serializer de acá, el test lo ve. No se puede poner en
// loggerOptions.serializers: pino-http reemplaza el serializer de `req` del
// logger por el suyo (o por el que recibe en SUS opciones).
export const httpLoggerOptions = {
  serializers: { req: serializarRequest },
};
