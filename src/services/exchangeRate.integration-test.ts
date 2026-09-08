import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { prisma } from "../lib/prisma";
import { findLatestExchangeRates } from "../repositories/organization.repository";
import { fetchAndStoreExchangeRates, rateDateDeHoy } from "./exchangeRate.service";

// ---------------------------------------------------------------------------
// Un ciclo completo del worker de cotizaciones contra Postgres real (Fase
// 2c), con la fuente inyectada (sin red, mismo criterio que `cliente` en el
// worker de Google): escribe una fila por moneda configurada, corrido dos
// veces el mismo día actualiza en vez de duplicar (el upsert sobre la unique
// compuesta), y una moneda que la fuente no trae no corta a las demás.
//
// exchange_rates ES GLOBAL y la suite corre archivos en paralelo contra una
// base compartida: otros tests configuran monedas reales (ARS, UYU) en sus
// organizaciones y el barrido las incluye. Por eso este archivo usa códigos
// que ninguna otra parte usa (ZZ*), afirma sobre SUS filas y usa >= sobre los
// contadores, que pueden sumar monedas ajenas.
// ---------------------------------------------------------------------------

const MONEDAS = { preferida: "ZZA", alternativa: "ZZB", sinFuente: "ZZC" };

let orgA: string;
let orgB: string;

before(async () => {
  const a = await prisma.organization.create({
    data: {
      name: `FX ${randomUUID()}`,
      slug: `fx-a-${Date.now()}-${randomUUID().slice(0, 8)}`,
      preferredCurrency: MONEDAS.preferida,
      alternateCurrency: MONEDAS.alternativa,
    },
  });
  // Repite la preferida de A y suma USD: ni una ni otra generan fila de más.
  const b = await prisma.organization.create({
    data: {
      name: `FX ${randomUUID()}`,
      slug: `fx-b-${Date.now()}-${randomUUID().slice(0, 8)}`,
      preferredCurrency: "USD",
      alternateCurrency: MONEDAS.preferida,
    },
  });
  orgA = a.id;
  orgB = b.id;
  await prisma.exchangeRate.deleteMany({
    where: { targetCurrency: { in: Object.values(MONEDAS) } },
  });
});

after(async () => {
  await prisma.exchangeRate.deleteMany({
    where: { targetCurrency: { in: Object.values(MONEDAS) } },
  });
  await prisma.organization.deleteMany({ where: { id: { in: [orgA, orgB].filter(Boolean) } } });
});

function filasDe(...monedas: string[]) {
  return prisma.exchangeRate.findMany({
    where: { targetCurrency: { in: monedas } },
    orderBy: { targetCurrency: "asc" },
  });
}

test("una pasada escribe una fila USD→X por moneda configurada, sin USD→USD y sin repetir la que comparten dos organizaciones", async () => {
  const resumen = await fetchAndStoreExchangeRates({
    fetchRates: async () => ({ ZZA: 1480.5, ZZB: 40.123456, USD: 1 }),
  });
  assert.ok(resumen.actualizadas >= 2, `actualizadas: ${resumen.actualizadas}`);

  const filas = await filasDe(MONEDAS.preferida, MONEDAS.alternativa);
  assert.deepEqual(
    filas.map((f) => [f.baseCurrency, f.targetCurrency, f.rate.toString()]),
    [
      ["USD", "ZZA", "1480.5"],
      ["USD", "ZZB", "40.123456"],
    ],
  );
  assert.equal(
    filas[0].rateDate.toISOString().slice(0, 10),
    rateDateDeHoy().toISOString().slice(0, 10),
  );

  const usdUsd = await prisma.exchangeRate.count({
    where: { baseCurrency: "USD", targetCurrency: "USD" },
  });
  assert.equal(usdUsd, 0);
});

test("dos pasadas el mismo día actualizan rate y fetchedAt en vez de duplicar la fila", async () => {
  await fetchAndStoreExchangeRates({ fetchRates: async () => ({ ZZA: 1480.5, ZZB: 40 }) });
  const [antes] = await filasDe(MONEDAS.preferida);

  await new Promise((r) => setTimeout(r, 5));
  await fetchAndStoreExchangeRates({ fetchRates: async () => ({ ZZA: 1500, ZZB: 40 }) });

  const filas = await filasDe(MONEDAS.preferida);
  assert.equal(filas.length, 1, "una sola fila por (base, destino, día)");
  assert.equal(filas[0].id, antes.id);
  assert.equal(filas[0].rate.toString(), "1500");
  assert.ok(filas[0].fetchedAt > antes.fetchedAt);

  // Y es lo que GET /organization va a servir: la última por moneda.
  const ultimas = await findLatestExchangeRates([MONEDAS.preferida]);
  assert.equal(ultimas.length, 1);
  assert.equal(ultimas[0].rate.toString(), "1500");
});

test("una moneda que la fuente no trae (o trae inválida) cuenta como fallida y no corta a las demás", async () => {
  await prisma.organization.update({
    where: { id: orgB },
    data: { alternateCurrency: MONEDAS.sinFuente },
  });
  await prisma.exchangeRate.deleteMany({
    where: { targetCurrency: { in: Object.values(MONEDAS) } },
  });

  const resumen = await fetchAndStoreExchangeRates({
    fetchRates: async () => ({ ZZA: 1480.5, ZZB: -3 }),
  });
  assert.ok(resumen.actualizadas >= 1);
  assert.ok(resumen.fallidas >= 2, "ZZB inválida y ZZC ausente");

  const filas = await filasDe(...Object.values(MONEDAS));
  assert.deepEqual(
    filas.map((f) => f.targetCurrency),
    [MONEDAS.preferida],
  );
});

test("si la fuente entera falla, todas las monedas cuentan como fallidas y no se escribe nada", async () => {
  await prisma.exchangeRate.deleteMany({
    where: { targetCurrency: { in: Object.values(MONEDAS) } },
  });

  const resumen = await fetchAndStoreExchangeRates({
    fetchRates: async () => {
      throw new Error("red caída");
    },
  });
  assert.equal(resumen.actualizadas, 0);
  assert.ok(resumen.fallidas >= 3);
  assert.equal((await filasDe(...Object.values(MONEDAS))).length, 0);
});
