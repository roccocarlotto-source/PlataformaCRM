import assert from "node:assert/strict";
import { test } from "node:test";
import {
  diaEnLaZona,
  fechaDelProximoService,
  mesesHastaElProximoService,
  proponerProximoService,
  sumarMesesAUnaFecha,
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

const fecha = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

test("primer service (S10): la fecha de la venta + N meses, sin correrse de día por la zona", () => {
  // La trampa: una @db.Date leída como instante en Montevideo es el día anterior.
  assert.equal(fechaDelProximoService(fecha("2026-10-15"), "America/Montevideo", 12), "2027-10-14");
  // Lo correcto para una fecha sin hora: el mismo día, un año después.
  assert.equal(iso(sumarMesesAUnaFecha(fecha("2026-10-15"), 12)), "2027-10-15");
  // Fin de mes: el último día del mes.
  assert.equal(iso(sumarMesesAUnaFecha(fecha("2026-01-31"), 1)), "2026-02-28");
  assert.equal(iso(sumarMesesAUnaFecha(fecha("2027-02-28"), 12)), "2028-02-28");
  assert.equal(iso(sumarMesesAUnaFecha(fecha("2028-02-29"), 12)), "2029-02-28");
  assert.equal(iso(sumarMesesAUnaFecha(fecha("2027-01-31"), 13)), "2028-02-29");
});

test("primer service (S10): el día de la activación es el de la zona de la organización", () => {
  // 15/10 01:00 UTC es el 14/10 a las 22:00 en Montevideo: una venta del 14/10
  // es posterior (o igual) a la activación.
  const activacion = new Date("2026-10-15T01:00:00.000Z");
  assert.equal(iso(diaEnLaZona(activacion, "America/Montevideo")), "2026-10-14");
  assert.equal(iso(diaEnLaZona(activacion, "UTC")), "2026-10-15");
  // Zona inválida: UTC.
  assert.equal(iso(diaEnLaZona(activacion, "No/Existe")), "2026-10-15");
});
