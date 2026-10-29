import assert from "node:assert/strict";
import { test } from "node:test";
import { Prisma } from "@prisma/client";
import { crearEsperaDeLaBase, ESPERA_INICIAL_MS, ESPERA_MAXIMA_MS } from "./esperaDeLaBase";

// Sin base: la sonda y el programador son falsos, y cada sonda se corre a mano.

function baseCaida() {
  return new Prisma.PrismaClientKnownRequestError("Can't reach database server", {
    code: "P1001",
    clientVersion: "x",
  });
}

function armar(respuestasDeLaSonda: boolean[]) {
  const programadas: { fn: () => void; ms: number }[] = [];
  let sondas = 0;
  const espera = crearEsperaDeLaBase({
    sondear: () => {
      sondas++;
      return respuestasDeLaSonda.shift() ? Promise.resolve() : Promise.reject(new Error("no"));
    },
    programar: (fn, ms) => programadas.push({ fn, ms }),
  });
  // Corre la próxima sonda programada y espera a que termine.
  const correrSonda = async () => {
    const proxima = programadas.shift();
    assert.ok(proxima, "tenía que haber una sonda programada");
    proxima.fn();
    await new Promise((resolve) => setImmediate(resolve));
    return proxima.ms;
  };
  return { espera, programadas, correrSonda, sondas: () => sondas };
}

test("un error de conexión marca la base caída y programa UNA sonda, aunque llegue de varios workers", () => {
  const { espera, programadas } = armar([]);

  assert.equal(espera.estaCaida(), false);
  assert.equal(espera.anotarSiLaBaseNoResponde(baseCaida()), true);
  assert.equal(espera.anotarSiLaBaseNoResponde(baseCaida()), true);
  assert.equal(espera.anotarSiLaBaseNoResponde(baseCaida()), true);

  assert.equal(espera.estaCaida(), true);
  assert.equal(programadas.length, 1, "una sola sonda, no una por worker");
  assert.equal(programadas[0].ms, ESPERA_INICIAL_MS);
});

test("un error que no es de conexión no frena nada: el worker lo loguea como siempre", () => {
  const { espera, programadas } = armar([]);

  assert.equal(espera.anotarSiLaBaseNoResponde(new Error("bug")), false);
  assert.equal(espera.estaCaida(), false);
  assert.equal(programadas.length, 0);
});

test("mientras la sonda falla, la espera se duplica hasta el tope de 60 s", async () => {
  const { espera, correrSonda } = armar([false, false, false, false, false, false]);
  espera.anotarSiLaBaseNoResponde(baseCaida());

  const esperas = [];
  for (let i = 0; i < 6; i++) {
    esperas.push(await correrSonda());
  }

  assert.deepEqual(esperas, [5_000, 10_000, 20_000, 40_000, 60_000, 60_000]);
  assert.equal(esperas.at(-1), ESPERA_MAXIMA_MS);
  assert.equal(espera.estaCaida(), true);
});

test("cuando la sonda pasa, la base vuelve a estar sana y no se programa otra", async () => {
  const { espera, correrSonda, programadas } = armar([false, true]);
  espera.anotarSiLaBaseNoResponde(baseCaida());

  await correrSonda();
  assert.equal(espera.estaCaida(), true);
  await correrSonda();

  assert.equal(espera.estaCaida(), false);
  assert.equal(programadas.length, 0);
});

test("una caída nueva después de volver arranca otra vez desde 5 s", async () => {
  const { espera, correrSonda, programadas } = armar([false, false, true]);
  espera.anotarSiLaBaseNoResponde(baseCaida());
  await correrSonda();
  await correrSonda();
  await correrSonda();
  assert.equal(espera.estaCaida(), false);

  espera.anotarSiLaBaseNoResponde(baseCaida());

  assert.equal(programadas.length, 1);
  assert.equal(programadas[0].ms, ESPERA_INICIAL_MS);
});
