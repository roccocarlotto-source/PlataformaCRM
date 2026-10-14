import assert from "node:assert/strict";
import { test } from "node:test";
import {
  fechaDelProximoService,
  mesesHastaElProximoService,
  proponerProximoService,
} from "./proximoService";

test("manda el intervalo menor entre los tipos; sin tipos con intervalo, el default", () => {
  assert.equal(mesesHastaElProximoService([12, 6, null], 24), 6);
  assert.equal(mesesHastaElProximoService([null, null], 12), 12);
  assert.equal(mesesHastaElProximoService([], 12), 12);
  assert.equal(mesesHastaElProximoService([], null), null);
});

test("fin de mes: si el día no existe, el último del mes", () => {
  const z = "America/Montevideo";
  assert.equal(fechaDelProximoService(new Date("2026-01-31T15:00:00Z"), z, 1), "2026-02-28");
  assert.equal(fechaDelProximoService(new Date("2027-01-31T15:00:00Z"), z, 13), "2028-02-29");
  assert.equal(fechaDelProximoService(new Date("2026-03-15T15:00:00Z"), z, 12), "2027-03-15");
});

test("la fecha de entrega se toma en la zona de la organización, no en UTC", () => {
  // 1 de marzo 01:30 UTC es todavía 28 de febrero en Montevideo (UTC-3).
  const entrega = new Date("2026-03-01T01:30:00Z");
  assert.equal(fechaDelProximoService(entrega, "America/Montevideo", 6), "2026-08-28");
  assert.equal(fechaDelProximoService(entrega, "UTC", 6), "2026-09-01");
  // Una zona inválida cae a UTC, como el resto del sistema.
  assert.equal(fechaDelProximoService(entrega, "No/Existe", 6), "2026-09-01");
});

test("sin intervalo no se propone fecha", () => {
  assert.deepEqual(proponerProximoService(new Date(), "UTC", [null], null), {
    meses: null,
    fecha: null,
  });
});
