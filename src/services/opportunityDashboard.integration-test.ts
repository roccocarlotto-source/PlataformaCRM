import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { OpportunityStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { getDashboardSummary } from "./opportunity.service";
import { createPipeline } from "./pipeline.service";
import { createStage } from "./stage.service";
import { desmontar, montar, type Escenario } from "./vehicle.test-helper";

// ---------------------------------------------------------------------------
// Resumen del Dashboard (§30 de docs/frontend-cambios-pendientes.md, con las
// ventanas por granularidad del §35) contra Postgres real: que el WHERE que
// arma el service —ventanas gte/lt sobre created_at (timestamp) y
// actual_close_date (date), status, moneda, soft delete— lo ejecute Prisma
// igual que la base en memoria de
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

// 15 de marzo de 2026, que además cae DOMINGO: "este mes" es marzo y "el
// anterior" febrero; la semana en curso arranca el lunes 9 y la anterior el
// lunes 2.
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

test("resumen end to end: conteos, montos en la moneda de la organización y ventanas de mes", async () => {
  const resumen = await getDashboardSummary(a.organizationId, {
    granularity: "month",
    now: AHORA,
  });

  assert.equal(resumen.currency, "UYU");
  assert.equal(resumen.granularity, "month");
  assert.equal(resumen.openCount, 3, "las tres abiertas, incluida la de USD");
  assert.equal(resumen.openValue, "1500.00", "solo las abiertas en UYU suman");

  // Creadas en marzo (UTC): la abierta del 2, la de USD del 5 (cuenta, no
  // suma) y NO la borrada del 3. La del 28/2 a las 23:59:59Z es de febrero.
  assert.deepEqual(resumen.createdThisPeriod, { count: 2, value: "1000.00" });
  assert.deepEqual(resumen.createdLastPeriod, { count: 4, value: "740.00" });

  // Cerradas por actualCloseDate.
  assert.deepEqual(resumen.wonThisPeriod, { count: 2, value: "500.00" });
  assert.equal(resumen.lostCountThisPeriod, 1);
  assert.deepEqual(resumen.wonLastPeriod, { count: 1, value: "50.00" });
  assert.equal(resumen.lostCountLastPeriod, 2);
});

// §35: el mismo escenario visto en semanal. AHORA (15/3/2026) es DOMINGO, así
// que la semana en curso va del lunes 9 al lunes 16 y la anterior del 2 al 9.
// Lo que se verifica contra Postgres real es que las ventanas de utcWindow.ts
// recorten igual que en la base en memoria de opportunity.service.test.ts.
test("resumen end to end: en semanal las ventanas son lunes-a-domingo", async () => {
  const resumen = await getDashboardSummary(a.organizationId, { granularity: "week", now: AHORA });

  assert.equal(resumen.granularity, "week");
  // Ninguna se creó entre el lunes 9 y hoy; las del 2 y el 5 son de la semana
  // anterior (la borrada del 3 sigue sin contar, y la de USD cuenta sin sumar).
  assert.deepEqual(resumen.createdThisPeriod, { count: 0, value: "0.00" });
  assert.deepEqual(resumen.createdLastPeriod, { count: 2, value: "1000.00" });
  // La perdida del 10 de marzo cae en la semana en curso; las ganadas del 1 y
  // del 20 quedan fuera de las dos ventanas.
  assert.deepEqual(resumen.wonThisPeriod, { count: 0, value: "0.00" });
  assert.equal(resumen.lostCountThisPeriod, 1);
  assert.equal(resumen.lostCountLastPeriod, 0);

  // El stock abierto no tiene ventana: es el mismo número que en el test
  // mensual de arriba, y mover el selector no puede cambiarlo.
  assert.equal(resumen.openValue, "1500.00");
});

test("aislamiento: la organización B no ve nada de A, y sin preferredCurrency suma en USD", async () => {
  const resumen = await getDashboardSummary(b.organizationId, {
    granularity: "month",
    now: AHORA,
  });

  assert.equal(resumen.currency, "USD");
  assert.equal(resumen.openCount, 2);
  assert.equal(
    resumen.openValue,
    "42.00",
    "la abierta en UYU no suma en una organización sin moneda",
  );
  assert.deepEqual(resumen.createdThisPeriod, { count: 2, value: "42.00" });
  assert.deepEqual(resumen.wonThisPeriod, { count: 0, value: "0.00" });

  // Ninguna ganada de A se cuela en ninguna de las tres granularidades.
  for (const granularity of ["month", "week", "day"] as const) {
    const otra = await getDashboardSummary(b.organizationId, { granularity, now: AHORA });
    assert.deepEqual(otra.wonThisPeriod, { count: 0, value: "0.00" }, `ganado en ${granularity}`);
    assert.deepEqual(otra.wonLastPeriod, { count: 0, value: "0.00" }, `anterior en ${granularity}`);
  }
});
