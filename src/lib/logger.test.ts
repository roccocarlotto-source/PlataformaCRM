import assert from "node:assert/strict";
import { test } from "node:test";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Writable } from "node:stream";
import express from "express";
import pino from "pino";
import pinoHttp from "pino-http";
import { httpLoggerOptions, loggerOptions, redactarUrl } from "./logger";

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

// B-20 (docs-privados/auditoria-2026-08-29.md (local, no está en GitHub); B-3 del 21/08): X-External-Id es el
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

// ---------------------------------------------------------------------------
// E-02 + E-08 de docs-privados/auditoria-2026-09-30-corta.md (local, no está
// en GitHub): credenciales que llegan en headers o en la query de rutas que no
// controlamos (callbacks OAuth, webhooks, el Worker de QR).
//
// Contra el middleware REAL: pinoHttp con httpLoggerOptions (lo mismo que monta
// app.ts) sobre el logger en memoria, y requests HTTP de verdad. Así se prueba
// la línea que escribe pino-http ("request completed") y también la de un
// error logueado con req.log, que lleva el mismo `req` serializado. Si alguien
// saca el serializer o un path de REDACT_PATHS, algún valor aparece en `lines`
// y el test falla.
// ---------------------------------------------------------------------------

const CREDENCIALES_FALSAS = {
  oauthCode: "FAKE-OAUTH-CODE-FOR-LOGGER-TEST",
  oauthState: "FAKE-OAUTH-STATE-FOR-LOGGER-TEST",
  verifyToken: "FAKE-VERIFY-TOKEN-FOR-LOGGER-TEST",
  proxySecret: "FAKE-PROXY-SECRET-FOR-LOGGER-TEST",
  googChannelToken: "FAKE-GOOG-CHANNEL-TOKEN-FOR-LOGGER-TEST",
};

async function conAppDePrueba(
  fn: (baseUrl: string, lines: string[]) => Promise<void>,
): Promise<void> {
  const { logger, lines } = createCapturingLogger();
  const app = express();
  app.use(pinoHttp({ logger, ...httpLoggerOptions }));
  // Un error logueado con req.log, como hace errorHandler: esa línea también
  // trae el `req` serializado.
  app.get("/con-error", (req, res) => {
    req.log.error({ err: new Error("boom") }, "Error no controlado");
    res.status(500).end();
  });
  app.use((_req, res) => {
    res.status(404).end();
  });

  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    const { port } = server.address() as AddressInfo;
    await fn(`http://127.0.0.1:${port}`, lines);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

function assertSinCredenciales(lines: string[]) {
  const todo = lines.join("\n");
  for (const [nombre, valor] of Object.entries(CREDENCIALES_FALSAS)) {
    assert.ok(!todo.includes(valor), `${nombre} apareció en el log:\n${todo}`);
  }
}

test("E-02/E-08 — ninguna credencial de callbacks, webhooks ni del Worker de QR aparece en los logs", async () => {
  const c = CREDENCIALES_FALSAS;
  await conAppDePrueba(async (baseUrl, lines) => {
    // Callbacks OAuth de Meta y de Google.
    await fetch(
      `${baseUrl}/api/integrations/meta/callback?code=${c.oauthCode}&state=${c.oauthState}`,
    );
    await fetch(
      `${baseUrl}/api/integrations/google-calendar/callback?state=${c.oauthState}&code=${c.oauthCode}&scope=calendar`,
    );
    // Handshake GET de los webhooks de Meta y WhatsApp.
    await fetch(
      `${baseUrl}/webhooks/meta?hub.mode=subscribe&hub.verify_token=${c.verifyToken}&hub.challenge=123`,
    );
    await fetch(
      `${baseUrl}/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${c.verifyToken}&hub.challenge=123`,
    );
    // El Worker de QR (QR y cupón) y las notificaciones de Google Calendar.
    await fetch(`${baseUrl}/qr/resolve/11111111-1111-1111-1111-111111111111`, {
      headers: { "x-internal-proxy-secret": c.proxySecret },
    });
    await fetch(`${baseUrl}/vouchers/resolve/11111111-1111-1111-1111-111111111111`, {
      headers: { "X-Internal-Proxy-Secret": c.proxySecret },
    });
    await fetch(`${baseUrl}/webhooks/google-calendar`, {
      method: "POST",
      headers: { "x-goog-channel-token": c.googChannelToken },
    });
    // Mismas credenciales en una línea de error.
    await fetch(`${baseUrl}/con-error?code=${c.oauthCode}&state=${c.oauthState}`, {
      headers: { "x-internal-proxy-secret": c.proxySecret },
    });

    assert.ok(lines.length >= 9, "cada request dejó al menos una línea");
    assertSinCredenciales(lines);

    // Control: el log sigue sirviendo para diagnosticar — la ruta y los
    // parámetros que no son credenciales se ven, y lo tapado dice que lo está.
    const meta = JSON.parse(lines.find((l) => l.includes("/api/integrations/meta/callback"))!);
    assert.equal(meta.req.url, "/api/integrations/meta/callback?code=[REDACTED]&state=[REDACTED]");
    assert.equal(meta.req.query.code, REDACT_CENSOR);
    const webhook = JSON.parse(lines.find((l) => l.includes("/webhooks/meta"))!);
    assert.match(webhook.req.url, /hub\.mode=subscribe/);
    assert.match(webhook.req.url, /hub\.challenge=123/);
    assert.equal(webhook.req.query["hub.verify_token"], REDACT_CENSOR);
    const qr = JSON.parse(lines.find((l) => l.includes("/qr/resolve/"))!);
    assert.equal(qr.req.headers["x-internal-proxy-secret"], REDACT_CENSOR);
  });
});

test("redactarUrl — tapa solo los params sensibles, sin importar mayúsculas, codificación ni corchetes", () => {
  assert.equal(redactarUrl("/a"), "/a");
  assert.equal(redactarUrl("/a?page=2&limit=10"), "/a?page=2&limit=10");
  assert.equal(redactarUrl("/a?CODE=x&page=2"), "/a?CODE=[REDACTED]&page=2");
  assert.equal(redactarUrl("/a?hub%2Everify_token=x"), "/a?hub%2Everify_token=[REDACTED]");
  assert.equal(redactarUrl("/a?code[a]=x"), "/a?code[a]=[REDACTED]");
  assert.equal(redactarUrl("/a?state"), "/a?state=[REDACTED]");
  // Un %-escape roto no tira: el nombre se compara tal cual.
  assert.equal(redactarUrl("/a?%E0%A4%A=1&code=x"), "/a?%E0%A4%A=1&code=[REDACTED]");
});
