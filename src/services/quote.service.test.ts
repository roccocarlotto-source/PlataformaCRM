import assert from "node:assert/strict";
import { test } from "node:test";
import type { QuoteStatus } from "@prisma/client";
import { AppError } from "../utils/AppError";
import {
  assertCanCreateOver,
  assertSendable,
  COTIZACION_ACEPTADA_BLOQUEA,
  normalizeLines,
  todayInTimeZone,
  transitionConflictError,
  transitionSourceStatus,
  type QuoteTransitionTarget,
} from "./quote.service";

// ---------------------------------------------------------------------------
// Reglas puras de la cotización (§39 de docs/frontend-cambios-pendientes.md).
// Sin base ni mocks, mismo criterio que activity.service.test.ts. La
// aplicación real —filas, transacciones, carreras, aislamiento entre
// organizaciones— está en quote.service.integration-test.ts y en
// tenant-isolation.integration-test.ts.
// ---------------------------------------------------------------------------

const TODOS: QuoteStatus[] = ["DRAFT", "SENT", "ACCEPTED", "REJECTED", "EXPIRED", "SUPERSEDED"];

function assertAppError(fn: () => unknown, statusCode: number, messageIncludes: string) {
  assert.throws(fn, (err: unknown) => {
    assert.ok(err instanceof AppError, `debe ser AppError. Fue: ${String(err)}`);
    assert.equal(err.statusCode, statusCode);
    assert.ok(err.message.includes(messageIncludes), `"${err.message}"`);
    return true;
  });
}

// --- Crear sobre la activa --------------------------------------------------

test("crear sin ninguna activa: permitido", () => {
  assert.doesNotThrow(() => assertCanCreateOver(null));
});

test("crear con la activa en DRAFT, SENT, REJECTED o EXPIRED: permitido", () => {
  for (const status of ["DRAFT", "SENT", "REJECTED", "EXPIRED"] as const) {
    assert.doesNotThrow(() => assertCanCreateOver({ status }), status);
  }
});

test("crear con la activa ACCEPTED: bloqueado con 409", () => {
  assertAppError(
    () => assertCanCreateOver({ status: "ACCEPTED" }),
    409,
    COTIZACION_ACEPTADA_BLOQUEA,
  );
});

// --- Transiciones -----------------------------------------------------------

test("cada transición parte de un único estado: SENT desde DRAFT, ACCEPTED y REJECTED desde SENT", () => {
  assert.equal(transitionSourceStatus("SENT"), "DRAFT");
  assert.equal(transitionSourceStatus("ACCEPTED"), "SENT");
  assert.equal(transitionSourceStatus("REJECTED"), "SENT");
});

test("transición desde un estado que no corresponde: siempre 409, con un mensaje propio por estado", () => {
  const targets: QuoteTransitionTarget[] = ["SENT", "ACCEPTED", "REJECTED"];
  for (const target of targets) {
    for (const current of TODOS.filter((status) => status !== transitionSourceStatus(target))) {
      const err = transitionConflictError(target, current);
      assert.equal(err.statusCode, 409, `${current} -> ${target}`);
      assert.ok(err.message.length > 0);
    }
  }
  assert.match(transitionConflictError("ACCEPTED", "SUPERSEDED").message, /reemplazada/);
  assert.match(transitionConflictError("REJECTED", "EXPIRED").message, /venció/);
  assert.match(transitionConflictError("REJECTED", "ACCEPTED").message, /aceptada/);
  assert.match(transitionConflictError("ACCEPTED", "REJECTED").message, /rechazada/);
  assert.match(transitionConflictError("SENT", "SENT").message, /ya fue enviada/);
  assert.match(transitionConflictError("ACCEPTED", "DRAFT").message, /tiene que enviarse/);
});

// --- Enviar con la validez vencida -----------------------------------------

const HOY = new Date("2026-09-16T00:00:00.000Z");

test("enviar sin fecha de validez, o con validez hoy o después: permitido", () => {
  assert.doesNotThrow(() => assertSendable({ validUntil: null }, HOY));
  assert.doesNotThrow(() => assertSendable({ validUntil: HOY }, HOY));
  assert.doesNotThrow(() =>
    assertSendable({ validUntil: new Date("2026-09-30T00:00:00.000Z") }, HOY),
  );
});

test("enviar con la validez de ayer: 409, la cotización nacería vencida", () => {
  assertAppError(
    () => assertSendable({ validUntil: new Date("2026-09-15T00:00:00.000Z") }, HOY),
    409,
    "ya pasó",
  );
});

// --- Hoy en la zona de la organización -------------------------------------

test("todayInTimeZone: la fecha local, a medianoche UTC", () => {
  // 02:30 UTC del 17 es todavía el 16 en Montevideo (UTC-3)...
  const madrugadaUtc = new Date("2026-09-17T02:30:00.000Z");
  assert.equal(
    todayInTimeZone(madrugadaUtc, "America/Montevideo").toISOString(),
    "2026-09-16T00:00:00.000Z",
  );
  // ...y ya el 17 en UTC.
  assert.equal(todayInTimeZone(madrugadaUtc, "UTC").toISOString(), "2026-09-17T00:00:00.000Z");
});

test("todayInTimeZone: una zona inválida cae a UTC en vez de tirar", () => {
  const instante = new Date("2026-09-17T02:30:00.000Z");
  assert.equal(
    todayInTimeZone(instante, "Montevideo/Inventada").toISOString(),
    "2026-09-17T00:00:00.000Z",
  );
});

// --- Líneas -----------------------------------------------------------------

test("normalizeLines: importes como string de dos decimales, negativos incluidos, y descripción recortada", () => {
  assert.deepEqual(
    normalizeLines([
      { description: "  Polarizado ", amount: 350 },
      { description: "Descuento contado", amount: -1500.5 },
      { description: "Redondeo", amount: 0.1 + 0.2 },
    ]),
    [
      { description: "Polarizado", amount: "350.00" },
      { description: "Descuento contado", amount: "-1500.50" },
      { description: "Redondeo", amount: "0.30" },
    ],
  );
  assert.deepEqual(normalizeLines([]), []);
});
