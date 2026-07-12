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
