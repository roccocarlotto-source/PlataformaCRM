import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { test } from "node:test";
import pino from "pino";
import { logAccesoADatosPersonales } from "./accessLog";
import { loggerOptions } from "./logger";
import type { AuthContext } from "../types/auth";

// ---------------------------------------------------------------------------
// El registro de acceso que exige STD-LEG-002 (hallazgo D2-5).
//
// Mismo montaje que logger.test.ts: se construye pino con el `loggerOptions`
// REAL contra un stream en memoria, así lo que se afirma es la línea que
// realmente sale, no una reconstrucción de cómo debería ser.
// ---------------------------------------------------------------------------

function capturar() {
  const lines: string[] = [];
  const sink = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
  return { log: pino({ ...loggerOptions, transport: undefined }, sink), lines };
}

// AuthContext completo, con email y fullName poblados A PROPÓSITO: son los dos
// campos que el registro NO debe copiar, y sin ellos el test más importante de
// este archivo no probaría nada.
const AUTH: AuthContext = {
  userId: "11111111-1111-1111-1111-111111111111",
  organizationId: "22222222-2222-2222-2222-222222222222",
  role: "ADMIN",
  email: "admin@ejemplo.test",
  fullName: "Admin de Prueba",
};

test("registra quién, qué recurso y de qué clase", () => {
  const { log, lines } = capturar();

  logAccesoADatosPersonales(
    { auth: AUTH, recurso: "GET /api/ingestion-events", clase: "Sensitive" },
    log,
  );

  assert.equal(lines.length, 1);
  const linea = JSON.parse(lines[0]) as Record<string, unknown>;

  // `evento` con valor fijo es lo que hace que estos accesos sean filtrables
  // como conjunto, sin depender de matchear rutas en el log de pino-http.
  assert.equal(linea.evento, "acceso_datos_personales");
  assert.equal(linea.userId, AUTH.userId);
  assert.equal(linea.organizationId, AUTH.organizationId);
  assert.equal(linea.rol, "ADMIN");
  assert.equal(linea.recurso, "GET /api/ingestion-events");
  assert.equal(linea.clase, "Sensitive");
  assert.equal(linea.msg, "Acceso a datos personales");
});

test("el detalle se aplana en la línea, para poder filtrar por él", () => {
  const { log, lines } = capturar();

  logAccesoADatosPersonales(
    {
      auth: AUTH,
      recurso: "GET /api/imports/:batchId",
      clase: "Sensitive",
      detalle: { batchId: "33333333-3333-3333-3333-333333333333" },
    },
    log,
  );

  const linea = JSON.parse(lines[0]) as Record<string, unknown>;
  assert.equal(linea.batchId, "33333333-3333-3333-3333-333333333333");
});

// ---------------------------------------------------------------------------
// EL TEST QUE IMPORTA. Un log de accesos que copia los datos que audita
// duplica exactamente el problema que existe para controlar: pasaría a haber
// datos personales en un segundo lugar, con su propia retención y su propio
// borrado a pedido que nadie declaró.
// ---------------------------------------------------------------------------

test("NO escribe ningún dato personal: ni el email ni el nombre de quien accede", () => {
  const { log, lines } = capturar();

  logAccesoADatosPersonales(
    { auth: AUTH, recurso: "POST /api/ingestion-events/:id/retry", clase: "Sensitive" },
    log,
  );

  assert.ok(
    !lines[0].includes(AUTH.email),
    "el email de quien accede no debe aparecer en la línea de log",
  );
  assert.ok(
    !lines[0].includes(AUTH.fullName),
    "el nombre de quien accede no debe aparecer en la línea de log",
  );

  const linea = JSON.parse(lines[0]) as Record<string, unknown>;
  assert.equal(linea.email, undefined);
  assert.equal(linea.fullName, undefined);
});
