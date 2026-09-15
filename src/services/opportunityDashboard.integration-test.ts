import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { OpportunityStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { getDashboardSummary } from "./opportunity.service";
import { createPipeline } from "./pipeline.service";
import { createStage } from "./stage.service";
import { desmontar, montar, type Escenario } from "./vehicle.test-helper";

// ---------------------------------------------------------------------------
// Resumen del Dashboard (§30 de docs/frontend-cambios-pendientes.md) contra
// Postgres real: que el WHERE que arma el service —ventanas gte/lt sobre
// created_at (timestamp) y actual_close_date (date), status, moneda, soft
// delete— lo ejecute Prisma igual que la base en memoria de
// opportunity.service.test.ts, y que una oportunidad de OTRA organización
// nunca sume acá. Dos organizaciones (vehicle.test-helper): una con moneda
// preferida configurada y otra sin (fallback USD).
//
// Las filas se insertan con prisma.opportunity.create y no con
// createOpportunity: el resumen mira createdAt y actualCloseDate en meses
// distintos, y el service no deja elegir createdAt.
// ---------------------------------------------------------------------------

let a: Escenario;
let b: Escenario;
let contextoA: { pipelineId: string; stageId: string; companyId: string };
let contextoB: { pipelineId: string; stageId: string; companyId: string };

// 15 de marzo de 2026: "este mes" es marzo, "el anterior" febrero, y la serie
// va de octubre 2025 a marzo 2026.
const AHORA = new Date("2026-03-15T15:00:00.000Z");

async function contextoDe(e: Escenario) {
  const pipeline = await createPipeline(e.organizationId, { name: "Ventas" });
  const stage = await createStage(e.organizationId, { pipelineId: pipeline.id, name: "Contacto" });
  const company = await prisma.company.create({
    data: { organizationId: e.organizationId, name: "Cliente" },
  });
  return { pipelineId: pipeline.id, stageId: stage.id, companyId: company.id };
}

interface FilaDeResumen {
  status?: OpportunityStatus;
  currency?: string;
  amount: number;
  createdAt: string;
  actualCloseDate?: string;
  deletedAt?: string;
}

function insertar(
  e: Escenario,
  contexto: { pipelineId: string; stageId: string; companyId: string },
  fila: FilaDeResumen,
) {
  return prisma.opportunity.create({
    data: {
      organizationId: e.organizationId,
      ownerId: e.userId,
      pipelineId: contexto.pipelineId,
      stageId: contexto.stageId,
      companyId: contexto.companyId,
      title: "Resumen",
      status: fila.status ?? "OPEN",
      currency: fila.currency ?? "UYU",
      amount: fila.amount,
      createdAt: new Date(fila.createdAt),
      actualCloseDate: fila.actualCloseDate ? new Date(fila.actualCloseDate) : null,
      deletedAt: fila.deletedAt ? new Date(fila.deletedAt) : null,
    },
  });
}

before(async () => {
  a = await montar("dash-a");
  b = await montar("dash-b");
  contextoA = await contextoDe(a);
  contextoB = await contextoDe(b);
  await prisma.organization.update({
    where: { id: a.organizationId },
    data: { preferredCurrency: "UYU" },
  });

  // Organización A.
  await Promise.all([
    // Abiertas ahora: dos en UYU (suman 1500), una en USD (cuenta, no suma).
    insertar(a, contextoA, { amount: 1000, createdAt: "2026-03-02T10:00:00.000Z" }),
    insertar(a, contextoA, { amount: 500, createdAt: "2026-02-28T23:59:59.000Z" }),
    insertar(a, contextoA, {
      amount: 9999,
      currency: "USD",
      createdAt: "2026-03-05T10:00:00.000Z",
    }),
    // Ganadas: dos en marzo (una en el primer instante del mes), una en
    // febrero, una en octubre 2025 (primer mes de la serie), una en
    // septiembre 2025 (fuera de la serie).
    insertar(a, contextoA, {
      status: "WON",
      amount: 300,
      createdAt: "2026-01-10T10:00:00.000Z",
      actualCloseDate: "2026-03-01T00:00:00.000Z",
    }),
    insertar(a, contextoA, {
      status: "WON",
      amount: 200,
      createdAt: "2026-01-11T10:00:00.000Z",
      actualCloseDate: "2026-03-20T00:00:00.000Z",
    }),
    insertar(a, contextoA, {
      status: "WON",
      amount: 50,
      createdAt: "2026-01-12T10:00:00.000Z",
      actualCloseDate: "2026-02-15T00:00:00.000Z",
    }),
    insertar(a, contextoA, {
      status: "WON",
      amount: 10,
      createdAt: "2025-09-01T10:00:00.000Z",
      actualCloseDate: "2025-10-31T00:00:00.000Z",
    }),
    insertar(a, contextoA, {
      status: "WON",
      amount: 7777,
      createdAt: "2025-09-01T10:00:00.000Z",
      actualCloseDate: "2025-09-30T00:00:00.000Z",
    }),
    // Perdidas: una en marzo, dos en febrero.
    insertar(a, contextoA, {
      status: "LOST",
      amount: 80,
      createdAt: "2026-02-01T10:00:00.000Z",
      actualCloseDate: "2026-03-10T00:00:00.000Z",
    }),
    insertar(a, contextoA, {
      status: "LOST",
      amount: 80,
      createdAt: "2026-02-01T10:00:00.000Z",
      actualCloseDate: "2026-02-10T00:00:00.000Z",
    }),
    insertar(a, contextoA, {
      status: "LOST",
      amount: 80,
      createdAt: "2026-02-02T10:00:00.000Z",
      actualCloseDate: "2026-02-11T00:00:00.000Z",
    }),
    // Borrada este mes: invisible para todo.
    insertar(a, contextoA, {
      amount: 100_000,
      createdAt: "2026-03-03T10:00:00.000Z",
      deletedAt: "2026-03-04T10:00:00.000Z",
    }),
  ]);

  // Organización B: sin moneda preferida, una abierta en USD y una en UYU.
  await Promise.all([
    insertar(b, contextoB, { amount: 42, currency: "USD", createdAt: "2026-03-02T10:00:00.000Z" }),
    insertar(b, contextoB, { amount: 5, currency: "UYU", createdAt: "2026-03-02T10:00:00.000Z" }),
  ]);
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

test("resumen end to end: conteos, montos en la moneda de la organización, ventanas de mes y serie de 6 meses", async () => {
  const resumen = await getDashboardSummary(a.organizationId, { now: AHORA });

  assert.equal(resumen.currency, "UYU");
  assert.equal(resumen.openCount, 3, "las tres abiertas, incluida la de USD");
  assert.equal(resumen.openValue, "1500.00", "solo las abiertas en UYU suman");

  // Creadas en marzo (UTC): la abierta del 2, la de USD del 5 (cuenta, no
  // suma) y NO la borrada del 3. La del 28/2 a las 23:59:59Z es de febrero.
  assert.deepEqual(resumen.createdThisMonth, { count: 2, value: "1000.00" });
  assert.deepEqual(resumen.createdLastMonth, { count: 4, value: "740.00" });

  // Cerradas por actualCloseDate.
  assert.deepEqual(resumen.wonThisMonth, { count: 2, value: "500.00" });
  assert.equal(resumen.lostCountThisMonth, 1);
  assert.deepEqual(resumen.wonLastMonth, { count: 1, value: "50.00" });
  assert.equal(resumen.lostCountLastMonth, 2);

  assert.deepEqual(resumen.revenueByMonth, [
    { month: "2025-10", value: "10.00" },
    { month: "2025-11", value: "0.00" },
    { month: "2025-12", value: "0.00" },
    { month: "2026-01", value: "0.00" },
    { month: "2026-02", value: "50.00" },
    { month: "2026-03", value: "500.00" },
  ]);
});

test("aislamiento: la organización B no ve nada de A, y sin preferredCurrency suma en USD", async () => {
  const resumen = await getDashboardSummary(b.organizationId, { now: AHORA });

  assert.equal(resumen.currency, "USD");
  assert.equal(resumen.openCount, 2);
  assert.equal(
    resumen.openValue,
    "42.00",
    "la abierta en UYU no suma en una organización sin moneda",
  );
  assert.deepEqual(resumen.createdThisMonth, { count: 2, value: "42.00" });
  assert.deepEqual(resumen.wonThisMonth, { count: 0, value: "0.00" });
  assert.ok(
    resumen.revenueByMonth.every((mes) => mes.value === "0.00"),
    "ninguna ganada de A se cuela en la serie de B",
  );
});

test("el reloj por defecto es el real: sin `now` la serie termina en el mes actual", async () => {
  const resumen = await getDashboardSummary(a.organizationId);
  const hoy = new Date();
  const mesActual = `${hoy.getUTCFullYear()}-${String(hoy.getUTCMonth() + 1).padStart(2, "0")}`;
  assert.equal(resumen.revenueByMonth.length, 6);
  assert.equal(resumen.revenueByMonth[5].month, mesActual);
});
