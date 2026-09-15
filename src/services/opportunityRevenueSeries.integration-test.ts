import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { OpportunityStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { getRevenueSeries, type RevenueSeries } from "./opportunity.service";
import { createPipeline } from "./pipeline.service";
import { createStage } from "./stage.service";
import { desmontar, montar, type Escenario } from "./vehicle.test-helper";

// ---------------------------------------------------------------------------
// Serie de ingresos por período (§33 de docs/frontend-cambios-pendientes.md)
// contra Postgres real, al lado de opportunityDashboard.integration-test.ts y
// con el mismo patrón: que las ventanas gte/lt que arma el service sobre
// actual_close_date (una columna `date`) las ejecute Prisma igual que la base
// en memoria de opportunity.service.test.ts, y que una oportunidad de OTRA
// organización nunca sume acá.
//
// Archivo aparte y no una extensión del de dashboard-summary porque las filas
// que hacen interesante a esta serie son otras: los bordes que importan son
// los de semana (lunes/domingo) y los de día, y meterlas en el escenario del
// resumen cambiaría sus aserciones exactas sin aportarles nada.
//
// Las filas se insertan con prisma.opportunity.create y no con
// createOpportunity: el service no deja elegir createdAt ni actualCloseDate
// arbitrarios.
// ---------------------------------------------------------------------------

let a: Escenario;
let b: Escenario;
let contextoA: { pipelineId: string; stageId: string; companyId: string };
let contextoB: { pipelineId: string; stageId: string; companyId: string };

// Domingo 15 de marzo de 2026: la semana en curso es la que arranca el lunes
// 9, la ventana de 30 días va del 14/2 al 15/3, y la de 8 semanas del lunes
// 19/1 al lunes 9/3.
const AHORA = new Date("2026-03-15T15:00:00.000Z");

async function contextoDe(e: Escenario) {
  const pipeline = await createPipeline(e.organizationId, { name: "Ventas" });
  const stage = await createStage(e.organizationId, { pipelineId: pipeline.id, name: "Contacto" });
  const company = await prisma.company.create({
    data: { organizationId: e.organizationId, name: "Cliente" },
  });
  return { pipelineId: pipeline.id, stageId: stage.id, companyId: company.id };
}

interface FilaDeSerie {
  status?: OpportunityStatus;
  currency?: string;
  amount: number;
  actualCloseDate: string;
  deletedAt?: string;
}

function insertar(
  e: Escenario,
  contexto: { pipelineId: string; stageId: string; companyId: string },
  fila: FilaDeSerie,
) {
  return prisma.opportunity.create({
    data: {
      organizationId: e.organizationId,
      ownerId: e.userId,
      pipelineId: contexto.pipelineId,
      stageId: contexto.stageId,
      companyId: contexto.companyId,
      title: "Serie",
      status: fila.status ?? "WON",
      currency: fila.currency ?? "UYU",
      amount: fila.amount,
      createdAt: new Date("2026-01-02T10:00:00.000Z"),
      actualCloseDate: new Date(fila.actualCloseDate),
      deletedAt: fila.deletedAt ? new Date(fila.deletedAt) : null,
    },
  });
}

// Los puntos de una serie son muchos (30 con granularidad diaria): se
// consultan por rótulo en vez de por índice.
function valorDe(serie: RevenueSeries, label: string): string {
  const punto = serie.points.find((entry) => entry.label === label);
  assert.ok(punto, `la serie no tiene el bucket ${label}`);
  return punto.value;
}

function conIngresos(serie: RevenueSeries): Array<{ label: string; value: string }> {
  return serie.points.filter((punto) => punto.value !== "0.00");
}

before(async () => {
  a = await montar("rev-a");
  b = await montar("rev-b");
  contextoA = await contextoDe(a);
  contextoB = await contextoDe(b);
  await prisma.organization.update({
    where: { id: a.organizationId },
    data: { preferredCurrency: "UYU" },
  });

  await Promise.all([
    // Semana y día en curso: domingo 15 (último día de la semana del 9) y
    // lunes 9 (el primero).
    insertar(a, contextoA, { amount: 100, actualCloseDate: "2026-03-15T00:00:00.000Z" }),
    insertar(a, contextoA, { amount: 50, actualCloseDate: "2026-03-09T00:00:00.000Z" }),
    // Domingo 8: último día de la semana ANTERIOR, no de la en curso.
    insertar(a, contextoA, { amount: 25, actualCloseDate: "2026-03-08T00:00:00.000Z" }),
    // Sábado 14/2: primer día de la ventana de 30 días.
    insertar(a, contextoA, { amount: 7, actualCloseDate: "2026-02-14T00:00:00.000Z" }),
    // Viernes 13/2: un día antes de esa ventana (no entra en la diaria) pero
    // en la MISMA semana del 9/2 (sí entra en la semanal).
    insertar(a, contextoA, { amount: 9_999, actualCloseDate: "2026-02-13T00:00:00.000Z" }),
    // Lunes 19/1: primera semana de la ventana de 8.
    insertar(a, contextoA, { amount: 3, actualCloseDate: "2026-01-19T00:00:00.000Z" }),
    // Domingo 18/1: una semana antes (fuera de la semanal), pero dentro de
    // enero (sí entra en la mensual).
    insertar(a, contextoA, { amount: 8_888, actualCloseDate: "2026-01-18T00:00:00.000Z" }),
    // Ganada en otra moneda: no suma en ninguna granularidad.
    insertar(a, contextoA, {
      amount: 500,
      currency: "USD",
      actualCloseDate: "2026-03-15T00:00:00.000Z",
    }),
    // Abierta con fecha de cierre cargada: no es ingreso.
    insertar(a, contextoA, {
      status: "OPEN",
      amount: 400,
      actualCloseDate: "2026-03-15T00:00:00.000Z",
    }),
    // Ganada pero borrada: invisible.
    insertar(a, contextoA, {
      amount: 600,
      actualCloseDate: "2026-03-15T00:00:00.000Z",
      deletedAt: "2026-03-16T00:00:00.000Z",
    }),
  ]);

  // Organización B: sin moneda preferida y con una ganada el mismo día que A.
  await insertar(b, contextoB, {
    amount: 42,
    currency: "USD",
    actualCloseDate: "2026-03-15T00:00:00.000Z",
  });
});

after(async () => {
  for (const e of [a, b].filter(Boolean)) {
    await prisma.opportunity.deleteMany({ where: { organizationId: e.organizationId } });
    await prisma.stage.deleteMany({ where: { organizationId: e.organizationId } });
    await prisma.pipeline.deleteMany({ where: { organizationId: e.organizationId } });
    await prisma.company.deleteMany({ where: { organizationId: e.organizationId } });
  }
  await desmontar(...[a, b].filter(Boolean));
});

test("mensual: 6 meses calendario, el actual al final, en la moneda de la organización", async () => {
  const serie = await getRevenueSeries(a.organizationId, "month", { now: AHORA });

  assert.equal(serie.currency, "UYU");
  assert.equal(serie.granularity, "month");
  assert.deepEqual(serie.points, [
    { label: "2025-10", value: "0.00" },
    { label: "2025-11", value: "0.00" },
    { label: "2025-12", value: "0.00" },
    // 3 del 19/1 + 8888 del 18/1: los dos son de enero aunque caigan en
    // semanas distintas.
    { label: "2026-01", value: "8891.00" },
    { label: "2026-02", value: "10006.00" },
    // 100 + 50 + 25; ni la de USD, ni la abierta, ni la borrada.
    { label: "2026-03", value: "175.00" },
  ]);
});

test("semanal: 8 semanas lunes-a-domingo, y el domingo cae en la semana que arranca el lunes anterior", async () => {
  const serie = await getRevenueSeries(a.organizationId, "week", { now: AHORA });

  assert.equal(serie.granularity, "week");
  assert.deepEqual(serie.points, [
    { label: "2026-01-19", value: "3.00" },
    { label: "2026-01-26", value: "0.00" },
    { label: "2026-02-02", value: "0.00" },
    // Viernes 13 y sábado 14 de febrero: misma semana.
    { label: "2026-02-09", value: "10006.00" },
    { label: "2026-02-16", value: "0.00" },
    { label: "2026-02-23", value: "0.00" },
    // El domingo 8 pertenece a esta semana, no a la del 9.
    { label: "2026-03-02", value: "25.00" },
    // Semana en curso, sin cerrar: lunes 9 + domingo 15.
    { label: "2026-03-09", value: "150.00" },
  ]);
  assert.equal(
    serie.points.length,
    8,
    "la ganada del domingo 18 de enero queda una semana antes de la ventana",
  );
});

test("diaria: 30 días calendario, del 14/2 al 15/3, el de hoy al final", async () => {
  const serie = await getRevenueSeries(a.organizationId, "day", { now: AHORA });

  assert.equal(serie.granularity, "day");
  assert.equal(serie.points.length, 30);
  assert.equal(serie.points[0].label, "2026-02-14");
  assert.equal(serie.points[29].label, "2026-03-15");

  assert.equal(valorDe(serie, "2026-02-14"), "7.00");
  assert.equal(valorDe(serie, "2026-03-08"), "25.00");
  assert.equal(valorDe(serie, "2026-03-09"), "50.00");
  assert.equal(valorDe(serie, "2026-03-15"), "100.00");
  assert.deepEqual(
    conIngresos(serie).map((punto) => punto.label),
    ["2026-02-14", "2026-03-08", "2026-03-09", "2026-03-15"],
    "la del viernes 13 de febrero queda un día antes de la ventana",
  );
});

test("aislamiento: la organización B no ve nada de A, y sin preferredCurrency suma en USD", async () => {
  for (const granularity of ["month", "week", "day"] as const) {
    const serie = await getRevenueSeries(b.organizationId, granularity, { now: AHORA });
    assert.equal(serie.currency, "USD", `moneda de reporte en ${granularity}`);
    assert.deepEqual(
      conIngresos(serie).map((punto) => punto.value),
      ["42.00"],
      `en ${granularity}, B solo ve su propia ganada`,
    );
  }
});

test("el reloj por defecto es el real: sin `now` el último bucket es el período en curso", async () => {
  const hoy = new Date().toISOString().slice(0, 10);
  const diaria = await getRevenueSeries(a.organizationId, "day");
  assert.equal(diaria.points.length, 30);
  assert.equal(diaria.points[29].label, hoy);

  const semanal = await getRevenueSeries(a.organizationId, "week");
  assert.equal(semanal.points.length, 8);
  assert.ok(
    semanal.points[7].label <= hoy,
    "el lunes de la semana en curso nunca es posterior a hoy",
  );
});
