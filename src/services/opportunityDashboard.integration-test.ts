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
// Lo que se verifica contra Postgres real es que las ventanas (acá en UTC,
// la zona por defecto de la organización) recorten igual que en la base en memoria de opportunity.service.test.ts.
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

// ---------------------------------------------------------------------------
// T-01: las ventanas se cortan en la zona de la organización, contra Postgres
// real. Lo que solo se puede probar acá es la mezcla de columnas: created_at es
// timestamp (borde en instantes, 03:00Z en Buenos Aires) y actual_close_date es
// date (borde en fechas calendario). El reloj queda fijo en cada borde: nada
// depende de la hora en que corra el CI.
// ---------------------------------------------------------------------------

test("T-01: en Buenos Aires las ventanas de mes, semana y día se cortan a las 03:00Z, sobre timestamp y sobre date", async () => {
  const c = await montar("dash-tz");
  try {
    await prisma.organization.update({
      where: { id: c.organizationId },
      data: { preferredCurrency: "UYU", timezone: "America/Argentina/Buenos_Aires" },
    });
    const contextoC = await contextoDe(c);
    await Promise.all([
      // Ganada el 30/9 (lo que graba el cierre el 1/10 a las 02:01Z).
      insertar(c, contextoC, {
        status: "WON",
        amount: 500,
        createdAt: "2026-08-10T15:00:00.000Z",
        actualCloseDate: "2026-09-30T00:00:00.000Z",
      }),
      // Ganada el 1/10: guardada a las 00:00Z, antes del borde en instantes.
      insertar(c, contextoC, {
        status: "WON",
        amount: 40,
        createdAt: "2026-08-10T15:00:00.000Z",
        actualCloseDate: "2026-10-01T00:00:00.000Z",
      }),
      // Creada el 30/9 a las 22:00 en Buenos Aires.
      insertar(c, contextoC, { amount: 7, createdAt: "2026-10-01T01:00:00.000Z" }),
      // Creada el 1/10 a las 00:30 en Buenos Aires.
      insertar(c, contextoC, { amount: 9, createdAt: "2026-10-01T03:30:00.000Z" }),
    ]);

    // 1/10 a las 02:01Z: en Buenos Aires todavía es septiembre.
    const borde = new Date("2026-10-01T02:01:00.000Z");
    const septiembre = await getDashboardSummary(c.organizationId, {
      granularity: "month",
      now: borde,
    });
    assert.deepEqual(septiembre.wonThisPeriod, { count: 1, value: "500.00" }, "la del 30/9");
    assert.deepEqual(septiembre.createdThisPeriod, { count: 1, value: "7.00" }, "la de las 22:00");

    // 1/10 a las 03:00Z: ya es octubre; la del 30/9 pasa al mes anterior y la
    // del 1/10 (00:00Z en la columna date) entra en octubre.
    const octubre = await getDashboardSummary(c.organizationId, {
      granularity: "month",
      now: new Date("2026-10-01T03:00:00.000Z"),
    });
    assert.deepEqual(octubre.wonThisPeriod, { count: 1, value: "40.00" });
    assert.deepEqual(octubre.wonLastPeriod, { count: 1, value: "500.00" });
    // Octubre local arranca a las 03:00Z: la creada a las 03:30Z es de octubre
    // (la ventana es el período entero, no "hasta ahora") y la de las 01:00Z
    // es de septiembre.
    assert.deepEqual(octubre.createdThisPeriod, { count: 1, value: "9.00" });
    assert.deepEqual(octubre.createdLastPeriod, { count: 1, value: "7.00" });

    // Día: a las 02:01Z "hoy" es el 30/9 y "ayer" el 29/9.
    const dia = await getDashboardSummary(c.organizationId, { granularity: "day", now: borde });
    assert.deepEqual(dia.wonThisPeriod, { count: 1, value: "500.00" });
    assert.deepEqual(dia.createdThisPeriod, { count: 1, value: "7.00" });

    // Semana: el lunes 5/10 a las 02:00Z sigue siendo la semana del 28/9, que
    // contiene al 30/9 y al 1/10.
    const semana = await getDashboardSummary(c.organizationId, {
      granularity: "week",
      now: new Date("2026-10-05T02:00:00.000Z"),
    });
    assert.deepEqual(semana.wonThisPeriod, { count: 2, value: "540.00" });
    // Y a las 03:00Z ya es la semana del 5/10: las dos pasan a la anterior.
    const semanaNueva = await getDashboardSummary(c.organizationId, {
      granularity: "week",
      now: new Date("2026-10-05T03:00:00.000Z"),
    });
    assert.deepEqual(semanaNueva.wonThisPeriod, { count: 0, value: "0.00" });
    assert.deepEqual(semanaNueva.wonLastPeriod, { count: 2, value: "540.00" });
  } finally {
    await prisma.opportunity.deleteMany({ where: { organizationId: c.organizationId } });
    await prisma.stage.deleteMany({ where: { organizationId: c.organizationId } });
    await prisma.pipeline.deleteMany({ where: { organizationId: c.organizationId } });
    await prisma.company.deleteMany({ where: { organizationId: c.organizationId } });
    await desmontar(c);
  }
});
