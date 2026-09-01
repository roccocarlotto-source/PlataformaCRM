import assert from "node:assert/strict";
import { test } from "node:test";
import { Writable } from "node:stream";
import pino from "pino";
import { loggerOptions } from "./logger";

const REDACT_CENSOR = "[REDACTED]";

// Usa loggerOptions completo — el mismo objeto con el que se construye el
// `logger` real exportado por logger.ts, no una reconstrucción manual de
// paths/censor — contra un stream en memoria en vez de stdout. Si el
// ensamblado real de `redact` se rompe (se borra la clave, un typo, una
// condición que la omite), este test lo ve directamente porque consume ese
// mismo objeto. Solo se pisa `transport`: no es parte de lo que se prueba
// (pino-pretty corre en un worker thread aparte, no capturable con un stream
// simple) y combinar `transport` con un destino explícito no es válido en
// pino — la redacción ocurre antes de la serialización, así que da igual.
function createCapturingLogger() {
  const lines: string[] = [];
  const sink = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });

  const logger = pino({ ...loggerOptions, transport: undefined }, sink);

  return { logger, lines };
}

test("redacta req.headers.authorization en logs", () => {
  const { logger, lines } = createCapturingLogger();
  const fakeToken = "Bearer FAKE-TOKEN-FOR-LOGGER-TEST-DO-NOT-REUSE";

  logger.info({ req: { headers: { authorization: fakeToken } } }, "request completed");

  assert.equal(lines.length, 1);
  const logged = JSON.parse(lines[0]);
  assert.equal(logged.req.headers.authorization, REDACT_CENSOR);
  assert.ok(
    !lines[0].includes(fakeToken),
    "el token crudo no debe aparecer en ningún lugar de la línea de log",
  );
});

test("redacta req.headers.cookie en logs", () => {
  const { logger, lines } = createCapturingLogger();
  const fakeCookie = "session=FAKE-COOKIE-FOR-LOGGER-TEST";

  logger.info({ req: { headers: { cookie: fakeCookie } } }, "request completed");

  const logged = JSON.parse(lines[0]);
  assert.equal(logged.req.headers.cookie, REDACT_CENSOR);
  assert.ok(!lines[0].includes(fakeCookie));
});

test('redacta res.headers["set-cookie"] en logs', () => {
  const { logger, lines } = createCapturingLogger();
  const fakeSetCookie = "session=FAKE-SET-COOKIE-FOR-LOGGER-TEST; HttpOnly";

  logger.info({ res: { headers: { "set-cookie": fakeSetCookie } } }, "request completed");

  const logged = JSON.parse(lines[0]);
  assert.equal(logged.res.headers["set-cookie"], REDACT_CENSOR);
  assert.ok(!lines[0].includes(fakeSetCookie));
});

test("no redacta ni oculta el resto del log (control negativo)", () => {
  const { logger, lines } = createCapturingLogger();

  logger.info({ req: { method: "GET", url: "/api/companies" } }, "request completed");

  const logged = JSON.parse(lines[0]);
  assert.equal(logged.msg, "request completed");
  assert.equal(logged.req.method, "GET");
  assert.equal(logged.req.url, "/api/companies");
});

// La clave de ingesta viaja en X-API-Key (docs/ingestion-architecture.md §3).
// Se redacta desde el ítem 3, antes de que exista authenticateApiKey: es
// defensa de logging, no autenticación, y el costo de agregarla recién con el
// ítem 4 es que el primer request de ingesta deje una credencial viva en el log.
test('redacta req.headers["x-api-key"] en logs', () => {
  const { logger, lines } = createCapturingLogger();
  const fakeApiKey = "crm_FAKE-API-KEY-FOR-LOGGER-TEST-DO-NOT-REUSE";

  logger.info({ req: { headers: { "x-api-key": fakeApiKey } } }, "request completed");

  const logged = JSON.parse(lines[0]);
  assert.equal(logged.req.headers["x-api-key"], REDACT_CENSOR);
  assert.ok(
    !lines[0].includes(fakeApiKey),
    "la clave cruda no debe aparecer en ningún lugar de la línea de log",
  );
});

// B-20 (docs/auditoria-2026-08-29.md; B-3 del 21/08): X-External-Id es el
// header por el que la fuente identifica al lead, y "puede ser el email del
// lead" (ingestionEvent.repository.ts). No es credencial, es PII, y sin
// redactarlo cada request a /api/ingest lo dejaba en texto plano en
// req.headers. Mismo patrón que x-api-key.
test('redacta req.headers["x-external-id"] en logs — puede ser el email del lead', () => {
  const { logger, lines } = createCapturingLogger();
  const fakeExternalId = "lead-FAKE-FOR-LOGGER-TEST@example.test";

  logger.info({ req: { headers: { "x-external-id": fakeExternalId } } }, "request completed");

  const logged = JSON.parse(lines[0]);
  assert.equal(logged.req.headers["x-external-id"], REDACT_CENSOR);
  assert.ok(
    !lines[0].includes(fakeExternalId),
    "el email crudo no debe aparecer en ningún lugar de la línea de log",
  );
});

// Control negativo que documenta el límite real de `redact`: opera sobre el
// objeto serializado, y los serializers de pino-std-serializers escriben
// req.url/req.query/req.params. Una clave que viajara por querystring NO se
// redactaría. Este test existe para que esa limitación sea visible en la suite
// y no una nota al pie que nadie lee: es la razón por la que la clave va en un
// header y el ítem 4 no puede aceptarla por URL.
test("redact NO cubre la URL ni el query string — la clave nunca puede viajar por ahí", () => {
  const { logger, lines } = createCapturingLogger();

  logger.info(
    { req: { url: "/api/ingest?apiKey=crm_SI-ESTO-PASARA-SERIA-UN-LEAK" } },
    "request completed",
  );

  const logged = JSON.parse(lines[0]);
  assert.equal(
    logged.req.url,
    "/api/ingest?apiKey=crm_SI-ESTO-PASARA-SERIA-UN-LEAK",
    "queda sin redactar a propósito: por eso la clave va en un header, no en la URL",
  );
});
