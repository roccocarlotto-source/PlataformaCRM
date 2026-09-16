import assert from "node:assert/strict";
import { test } from "node:test";
import { Prisma } from "@prisma/client";
import type { Db } from "../lib/prisma";
import {
  getDashboardSummary,
  getRevenueSeries,
  priceFromVehicle,
  transicionaAGanada,
  vehicleStatusForOpportunityStatus,
} from "./opportunity.service";

// ---------------------------------------------------------------------------
// Las dos reglas puras del vínculo Vehicle ↔ Opportunity (Fase 2c), sin base:
// qué estado toma la unidad según el de la oportunidad, y qué precio toma la
// oportunidad de la unidad. Que el service las aplique sobre filas reales se
// prueba en opportunityVehicle.integration-test.ts.
// ---------------------------------------------------------------------------

test("vehicleStatusForOpportunityStatus: OPEN reserva, WON vende, LOST no reserva nada", () => {
  assert.equal(vehicleStatusForOpportunityStatus("OPEN"), "RESERVED");
  assert.equal(vehicleStatusForOpportunityStatus("WON"), "SOLD");
  assert.equal(vehicleStatusForOpportunityStatus("LOST"), "AVAILABLE");
});

test("priceFromVehicle: el precio en USD manda aunque haya precio local y moneda configurada", () => {
  const precio = priceFromVehicle(
    {
      priceListUsd: new Prisma.Decimal("25000.00"),
      priceListLocal: new Prisma.Decimal(30_000_000),
    },
    { preferredCurrency: "ARS" },
  );
  assert.deepEqual(precio, { amount: 25_000, currency: "USD" });
});

test("priceFromVehicle: solo precio local → moneda de preferencia de la organización", () => {
  const precio = priceFromVehicle(
    { priceListUsd: null, priceListLocal: new Prisma.Decimal("30000000.00") },
    { preferredCurrency: "ARS" },
  );
  assert.deepEqual(precio, { amount: 30_000_000, currency: "ARS" });
});

test("priceFromVehicle: solo precio local SIN moneda configurada → {} — no se inventa la moneda", () => {
  const precio = priceFromVehicle(
    { priceListUsd: null, priceListLocal: 30_000_000 },
    { preferredCurrency: null },
  );
  assert.deepEqual(precio, {});
});

test("priceFromVehicle: sin ningún precio → {}", () => {
  assert.deepEqual(
    priceFromVehicle({ priceListUsd: null, priceListLocal: null }, { preferredCurrency: "ARS" }),
    {},
  );
});

// ---------------------------------------------------------------------------
// Trigger opportunity.won (docs/automations-architecture.md §7): la detección
// de la transición, sin base. Que el service emita el evento de verdad —y solo
// en estos casos— se prueba en automationOpportunityWon.integration-test.ts.
// ---------------------------------------------------------------------------

test("transicionaAGanada: WON alcanzado desde cualquier otro estado dispara", () => {
  assert.equal(transicionaAGanada("OPEN", "WON"), true);
  assert.equal(transicionaAGanada("LOST", "WON"), true);
});

test("transicionaAGanada: WON → WON NO dispara — un PATCH sobre una ya ganada no es una transición", () => {
  assert.equal(transicionaAGanada("WON", "WON"), false);
});

test("transicionaAGanada: las transiciones que no terminan en WON no disparan", () => {
  assert.equal(transicionaAGanada("OPEN", "LOST"), false);
  assert.equal(transicionaAGanada("OPEN", "OPEN"), false);
  assert.equal(transicionaAGanada("WON", "OPEN"), false, "reabrir una ganada tampoco dispara");
  assert.equal(transicionaAGanada("WON", "LOST"), false);
});

// ---------------------------------------------------------------------------
// Resumen del Dashboard (§30 de docs/frontend-cambios-pendientes.md, con las
// ventanas por granularidad del §35), sin base: una "base en memoria" mínima
// que aplica el WHERE que el service arma (organizationId, deletedAt, status,
// currency y las ventanas gte/lt sobre createdAt/actualCloseDate) sobre filas
// fijas. Lo que se prueba acá es la matemática de bordes y de monedas con
// `now` inyectado; que Prisma ejecute ese WHERE igual contra Postgres real lo
// prueba opportunityDashboard.integration-test.ts.
// ---------------------------------------------------------------------------

interface FilaEnMemoria {
  organizationId: string;
  deletedAt: Date | null;
  status: "OPEN" | "WON" | "LOST";
  currency: string;
  amount: Prisma.Decimal;
  createdAt: Date;
  actualCloseDate: Date | null;
}

interface Ventana {
  gte?: Date;
  lt?: Date;
}

interface WhereEnMemoria {
  organizationId: string;
  deletedAt: null;
  status?: "OPEN" | "WON" | "LOST";
  currency?: string;
  createdAt?: Ventana;
  actualCloseDate?: Ventana;
}

function enVentana(valor: Date | null, ventana: Ventana | undefined): boolean {
  if (!ventana) return true;
  if (valor === null) return false;
  if (ventana.gte && valor.getTime() < ventana.gte.getTime()) return false;
  if (ventana.lt && valor.getTime() >= ventana.lt.getTime()) return false;
  return true;
}

function baseEnMemoria(filas: FilaEnMemoria[], preferredCurrency: string | null) {
  const filtrar = (where: WhereEnMemoria) =>
    filas.filter(
      (fila) =>
        fila.organizationId === where.organizationId &&
        fila.deletedAt === where.deletedAt &&
        (where.status === undefined || fila.status === where.status) &&
        (where.currency === undefined || fila.currency === where.currency) &&
        enVentana(fila.createdAt, where.createdAt) &&
        enVentana(fila.actualCloseDate, where.actualCloseDate),
    );
  return {
    organization: {
      findUnique: async () => ({ preferredCurrency }),
    },
    opportunity: {
      count: async ({ where }: { where: WhereEnMemoria }) => filtrar(where).length,
      aggregate: async ({ where }: { where: WhereEnMemoria }) => {
        const coincidentes = filtrar(where);
        const total = coincidentes.reduce(
          (acc, fila) => acc.plus(fila.amount),
          new Prisma.Decimal(0),
        );
        return { _sum: { amount: coincidentes.length === 0 ? null : total } };
      },
    },
  } as unknown as Db;
}

const ORG = "org-a";
// 15 de marzo de 2026, a media tarde UTC.
const AHORA = new Date("2026-03-15T15:00:00.000Z");

function fila(extra: Partial<FilaEnMemoria> = {}): FilaEnMemoria {
  return {
    organizationId: ORG,
    deletedAt: null,
    status: "OPEN",
    currency: "UYU",
    amount: new Prisma.Decimal(100),
    createdAt: new Date("2026-03-10T00:00:00.000Z"),
    actualCloseDate: null,
    ...extra,
  };
}

function dia(iso: string): Date {
  return new Date(iso);
}

test("getDashboardSummary: sin preferredCurrency suma en USD y lo dice en la respuesta", async () => {
  const db = baseEnMemoria(
    [fila({ currency: "USD", amount: new Prisma.Decimal("10.5") }), fila({ currency: "UYU" })],
    null,
  );
  const resumen = await getDashboardSummary(ORG, { granularity: "month", now: AHORA, db });
  assert.equal(resumen.currency, "USD");
  assert.equal(resumen.openValue, "10.50", "solo la de USD suma; serializado con dos decimales");
  assert.equal(resumen.openCount, 2, "el conteo NO filtra por moneda");
  assert.equal(resumen.granularity, "month", "el resumen dice con qué ventana se calculó (§35)");
});

test("getDashboardSummary: otras monedas quedan fuera de los montos pero no de openCount", async () => {
  const db = baseEnMemoria(
    [
      fila({ currency: "UYU", amount: new Prisma.Decimal(1500) }),
      fila({ currency: "USD", amount: new Prisma.Decimal(99_999) }),
      fila({ currency: "UYU", amount: new Prisma.Decimal("250.25") }),
    ],
    "UYU",
  );
  const resumen = await getDashboardSummary(ORG, { granularity: "month", now: AHORA, db });
  assert.equal(resumen.currency, "UYU");
  assert.equal(resumen.openCount, 3);
  assert.equal(resumen.openValue, "1750.25");
  assert.equal(resumen.createdThisPeriod.count, 3, "creadas en el mes: conteo sin moneda");
  assert.equal(resumen.createdThisPeriod.value, "1750.25", "creadas en el mes: monto solo en UYU");
});

test("getDashboardSummary: los bordes del mes son [inicio, inicio del siguiente) en UTC", async () => {
  const db = baseEnMemoria(
    [
      // Último instante de febrero: mes anterior.
      fila({ createdAt: dia("2026-02-28T23:59:59.999Z"), amount: new Prisma.Decimal(1) }),
      // Primer instante de marzo: este mes.
      fila({ createdAt: dia("2026-03-01T00:00:00.000Z"), amount: new Prisma.Decimal(2) }),
      // Primer instante de abril: todavía no existe para el resumen.
      fila({ createdAt: dia("2026-04-01T00:00:00.000Z"), amount: new Prisma.Decimal(4) }),
      // Primer instante de febrero: mes anterior, no dos meses atrás.
      fila({ createdAt: dia("2026-02-01T00:00:00.000Z"), amount: new Prisma.Decimal(8) }),
      // Último instante de enero: fuera de las dos ventanas.
      fila({ createdAt: dia("2026-01-31T23:59:59.999Z"), amount: new Prisma.Decimal(16) }),
    ],
    "UYU",
  );
  const resumen = await getDashboardSummary(ORG, { granularity: "month", now: AHORA, db });
  assert.deepEqual(resumen.createdThisPeriod, { count: 1, value: "2.00" });
  assert.deepEqual(resumen.createdLastPeriod, { count: 2, value: "9.00" });
});

test("getDashboardSummary: ganadas y perdidas se cuentan por actualCloseDate en cada mes; sin fecha de cierre no cuentan", async () => {
  const won = (actualCloseDate: Date, amount: number, currency = "UYU") =>
    fila({ status: "WON", actualCloseDate, amount: new Prisma.Decimal(amount), currency });
  const lost = (actualCloseDate: Date) => fila({ status: "LOST", actualCloseDate });
  const db = baseEnMemoria(
    [
      won(dia("2026-03-01T00:00:00.000Z"), 300),
      won(dia("2026-03-31T00:00:00.000Z"), 200),
      lost(dia("2026-03-20T00:00:00.000Z")),
      won(dia("2026-02-28T00:00:00.000Z"), 50),
      lost(dia("2026-02-10T00:00:00.000Z")),
      lost(dia("2026-02-11T00:00:00.000Z")),
      // Ganada sin fecha de cierre: no entra en ninguna ventana.
      fila({ status: "WON", actualCloseDate: null, amount: new Prisma.Decimal(999) }),
      // Ganada en otra moneda: cuenta para Win Rate, no suma en el monto.
      won(dia("2026-03-05T00:00:00.000Z"), 777, "USD"),
    ],
    "UYU",
  );
  const resumen = await getDashboardSummary(ORG, { granularity: "month", now: AHORA, db });
  assert.deepEqual(resumen.wonThisPeriod, { count: 3, value: "500.00" });
  assert.equal(resumen.lostCountThisPeriod, 1);
  assert.deepEqual(resumen.wonLastPeriod, { count: 1, value: "50.00" });
  assert.equal(resumen.lostCountLastPeriod, 2);
});

test("getDashboardSummary: sin nada cerrado, los conteos de Win Rate quedan en 0 (el frontend muestra el guion, nunca divide por cero)", async () => {
  const db = baseEnMemoria([fila(), fila()], "UYU");
  const resumen = await getDashboardSummary(ORG, { granularity: "month", now: AHORA, db });
  assert.equal(resumen.wonThisPeriod.count, 0);
  assert.equal(resumen.lostCountThisPeriod, 0);
  assert.equal(resumen.wonLastPeriod.count, 0);
  assert.equal(resumen.lostCountLastPeriod, 0);
  assert.equal(
    resumen.wonThisPeriod.value,
    "0.00",
    "sin filas el SUM es null y se serializa como 0.00",
  );
});

test("getDashboardSummary: ya NO trae revenueByMonth — la serie de 6 meses es getRevenueSeries (§35)", async () => {
  const db = baseEnMemoria([fila()], "UYU");
  const resumen = await getDashboardSummary(ORG, { granularity: "month", now: AHORA, db });
  assert.equal(
    "revenueByMonth" in resumen,
    false,
    "el campo se fue con el §35: nadie lo leía desde el §33",
  );
});

// ---------------------------------------------------------------------------
// §35: las tres cards del resumen usan la ventana de `granularity`. Desde el
// §36 ese es el ÚNICO juego de ventanas que devuelve el service: el par
// siempre mensual se fue con "Valor del pipeline".
// AHORA (15/3/2026) es DOMINGO, así que la semana en curso arranca el lunes 9
// y la anterior el lunes 2 — el caso interesante, porque el domingo es el
// último día de la semana y no el primero.
// ---------------------------------------------------------------------------

test("getDashboardSummary: con granularity=month las ventanas son el mes en curso y el anterior", async () => {
  const db = baseEnMemoria(
    [
      fila({ createdAt: dia("2026-03-10T00:00:00.000Z"), amount: new Prisma.Decimal(2) }),
      fila({ createdAt: dia("2026-02-20T00:00:00.000Z"), amount: new Prisma.Decimal(16) }),
    ],
    "UYU",
  );
  const resumen = await getDashboardSummary(ORG, { granularity: "month", now: AHORA, db });

  assert.deepEqual(resumen.createdThisPeriod, { count: 1, value: "2.00" });
  assert.deepEqual(resumen.createdLastPeriod, { count: 1, value: "16.00" });
});

test("getDashboardSummary: con granularity=week las ventanas son lunes-a-domingo", async () => {
  const db = baseEnMemoria(
    [
      // Martes 10: semana en curso (y marzo).
      fila({ createdAt: dia("2026-03-10T00:00:00.000Z"), amount: new Prisma.Decimal(2) }),
      // Jueves 5: semana anterior (y marzo).
      fila({ createdAt: dia("2026-03-05T00:00:00.000Z"), amount: new Prisma.Decimal(4) }),
      // Domingo 1: marzo, pero dos semanas atrás — fuera de las dos ventanas.
      fila({ createdAt: dia("2026-03-01T00:00:00.000Z"), amount: new Prisma.Decimal(8) }),
      // Febrero: mes anterior, y ninguna de las dos semanas.
      fila({ createdAt: dia("2026-02-20T00:00:00.000Z"), amount: new Prisma.Decimal(16) }),
      // Cerradas: una en la semana en curso, una en la anterior. Creadas en
      // enero a propósito, para que no se mezclen con los conteos de "creadas"
      // de arriba (el createdAt por defecto de fila() es el martes 10).
      fila({
        status: "WON",
        createdAt: dia("2026-01-05T00:00:00.000Z"),
        actualCloseDate: dia("2026-03-09T00:00:00.000Z"),
        amount: new Prisma.Decimal(100),
      }),
      fila({
        status: "LOST",
        createdAt: dia("2026-01-05T00:00:00.000Z"),
        actualCloseDate: dia("2026-03-08T23:59:59.999Z"),
        amount: new Prisma.Decimal(1),
      }),
    ],
    "UYU",
  );
  const resumen = await getDashboardSummary(ORG, { granularity: "week", now: AHORA, db });

  assert.equal(resumen.granularity, "week");
  assert.deepEqual(resumen.createdThisPeriod, { count: 1, value: "2.00" }, "solo el martes 10");
  assert.deepEqual(resumen.createdLastPeriod, { count: 1, value: "4.00" }, "solo el jueves 5");
  // El lunes 9 a las 00:00 abre la semana en curso; el domingo 8 a las
  // 23:59:59.999 todavía es la anterior.
  assert.deepEqual(resumen.wonThisPeriod, { count: 1, value: "100.00" });
  assert.equal(resumen.lostCountLastPeriod, 1);
  assert.equal(resumen.lostCountThisPeriod, 0);
});

test("getDashboardSummary: con granularity=day las ventanas son hoy y ayer en UTC", async () => {
  const db = baseEnMemoria(
    [
      fila({ createdAt: dia("2026-03-15T01:00:00.000Z"), amount: new Prisma.Decimal(3) }),
      // Último instante de ayer: sigue siendo ayer.
      fila({ createdAt: dia("2026-03-14T23:59:59.999Z"), amount: new Prisma.Decimal(5) }),
      // Primer instante de mañana: fuera de las dos ventanas.
      fila({ createdAt: dia("2026-03-16T00:00:00.000Z"), amount: new Prisma.Decimal(7) }),
      fila({
        status: "WON",
        actualCloseDate: dia("2026-03-15T12:00:00.000Z"),
        amount: new Prisma.Decimal(100),
      }),
      fila({
        status: "LOST",
        actualCloseDate: dia("2026-03-14T12:00:00.000Z"),
        amount: new Prisma.Decimal(1),
      }),
    ],
    "UYU",
  );
  const resumen = await getDashboardSummary(ORG, { granularity: "day", now: AHORA, db });

  assert.equal(resumen.granularity, "day");
  assert.deepEqual(resumen.createdThisPeriod, { count: 1, value: "3.00" });
  assert.deepEqual(resumen.createdLastPeriod, { count: 1, value: "5.00" });
  assert.deepEqual(resumen.wonThisPeriod, { count: 1, value: "100.00" });
  assert.deepEqual(resumen.wonLastPeriod, { count: 0, value: "0.00" });
  assert.equal(resumen.lostCountThisPeriod, 0);
  assert.equal(resumen.lostCountLastPeriod, 1);
});

test("getDashboardSummary: las borradas y las de otra organización nunca suman ni cuentan", async () => {
  const db = baseEnMemoria(
    [
      fila({ amount: new Prisma.Decimal(100) }),
      fila({ deletedAt: dia("2026-03-12T00:00:00.000Z"), amount: new Prisma.Decimal(1_000) }),
      fila({ organizationId: "org-b", amount: new Prisma.Decimal(10_000) }),
    ],
    "UYU",
  );
  const resumen = await getDashboardSummary(ORG, { granularity: "month", now: AHORA, db });
  assert.equal(resumen.openCount, 1);
  assert.equal(resumen.openValue, "100.00");
  assert.deepEqual(resumen.createdThisPeriod, { count: 1, value: "100.00" });
});

// ---------------------------------------------------------------------------
// getRevenueSeries (§33): la misma base en memoria, pero mirando las tres
// granularidades. AHORA (15/3/2026) es DOMINGO, así que la semana en curso es
// la que arranca el lunes 9 — el caso interesante, porque el domingo es el
// último día de la semana y no el primero.
// ---------------------------------------------------------------------------

function ganada(actualCloseDate: Date, amount: number, currency = "UYU"): FilaEnMemoria {
  return fila({ status: "WON", actualCloseDate, amount: new Prisma.Decimal(amount), currency });
}

test("getRevenueSeries: mensual devuelve los mismos 6 meses que el resumen, y lo dice en la respuesta", async () => {
  const db = baseEnMemoria(
    [
      ganada(dia("2025-10-01T00:00:00.000Z"), 10),
      // Septiembre 2025: séptimo mes hacia atrás, fuera de la serie.
      ganada(dia("2025-09-30T00:00:00.000Z"), 1_000),
      ganada(dia("2026-01-15T00:00:00.000Z"), 40),
      ganada(dia("2026-03-15T00:00:00.000Z"), 60),
    ],
    "UYU",
  );
  const serie = await getRevenueSeries(ORG, "month", { now: AHORA, db });

  assert.equal(serie.currency, "UYU");
  assert.equal(serie.granularity, "month");
  assert.deepEqual(serie.points, [
    { label: "2025-10", value: "10.00" },
    { label: "2025-11", value: "0.00" },
    { label: "2025-12", value: "0.00" },
    { label: "2026-01", value: "40.00" },
    { label: "2026-02", value: "0.00" },
    { label: "2026-03", value: "60.00" },
  ]);

  // Los dos endpoints miran lo mismo con la misma ventana: el último punto de
  // la serie mensual y el "ganado" del resumen mensual no pueden diferir (era
  // la razón por la que el resumen derivaba wonThisMonth de revenueByMonth
  // hasta el §35; ahora son dos consultas independientes que tienen que dar
  // igual).
  const resumen = await getDashboardSummary(ORG, { granularity: "month", now: AHORA, db });
  assert.equal(serie.points[serie.points.length - 1].value, resumen.wonThisPeriod.value);
  assert.equal(serie.points[serie.points.length - 2].value, resumen.wonLastPeriod.value);
});

test("getRevenueSeries: semanal devuelve 8 semanas lunes-a-domingo, la en curso al final", async () => {
  const db = baseEnMemoria(
    [
      // Lunes 9: primer día de la semana en curso.
      ganada(dia("2026-03-09T00:00:00.000Z"), 300),
      // Domingo 15: último día de la MISMA semana, no de la siguiente.
      ganada(dia("2026-03-15T00:00:00.000Z"), 200),
      // Domingo 8: último día de la semana anterior.
      ganada(dia("2026-03-08T00:00:00.000Z"), 50),
      // Lunes 19 de enero: primera semana de la serie.
      ganada(dia("2026-01-19T00:00:00.000Z"), 7),
      // Domingo 18 de enero: una semana antes del comienzo, fuera de la serie.
      ganada(dia("2026-01-18T00:00:00.000Z"), 9_999),
    ],
    "UYU",
  );
  const serie = await getRevenueSeries(ORG, "week", { now: AHORA, db });

  assert.equal(serie.granularity, "week");
  assert.deepEqual(serie.points, [
    { label: "2026-01-19", value: "7.00" },
    { label: "2026-01-26", value: "0.00" },
    { label: "2026-02-02", value: "0.00" },
    { label: "2026-02-09", value: "0.00" },
    { label: "2026-02-16", value: "0.00" },
    { label: "2026-02-23", value: "0.00" },
    { label: "2026-03-02", value: "50.00" },
    { label: "2026-03-09", value: "500.00" },
  ]);
});

test("getRevenueSeries: diaria devuelve 30 días calendario, el de hoy al final", async () => {
  const db = baseEnMemoria(
    [
      ganada(dia("2026-03-15T00:00:00.000Z"), 60),
      // Último instante del día anterior: el día de ayer, no el de hoy.
      ganada(dia("2026-03-14T23:59:59.999Z"), 40),
      // Primer día de la ventana de 30.
      ganada(dia("2026-02-14T00:00:00.000Z"), 5),
      // Un día antes del comienzo: afuera.
      ganada(dia("2026-02-13T23:59:59.999Z"), 9_999),
    ],
    "UYU",
  );
  const serie = await getRevenueSeries(ORG, "day", { now: AHORA, db });

  assert.equal(serie.granularity, "day");
  assert.equal(serie.points.length, 30);
  assert.deepEqual(serie.points[0], { label: "2026-02-14", value: "5.00" });
  assert.deepEqual(serie.points[28], { label: "2026-03-14", value: "40.00" });
  assert.deepEqual(serie.points[29], { label: "2026-03-15", value: "60.00" });
  assert.equal(
    serie.points.filter((punto) => punto.value !== "0.00").length,
    3,
    "ningún otro día suma",
  );
});

test("getRevenueSeries: solo suma WON en la moneda de reporte, y sin preferredCurrency esa moneda es USD", async () => {
  const db = baseEnMemoria(
    [
      ganada(dia("2026-03-15T00:00:00.000Z"), 60, "USD"),
      // Ganada en otra moneda: no suma.
      ganada(dia("2026-03-15T00:00:00.000Z"), 9_999, "UYU"),
      // Abierta con fecha de cierre cargada: no es ingreso.
      fila({
        status: "OPEN",
        actualCloseDate: dia("2026-03-15T00:00:00.000Z"),
        amount: new Prisma.Decimal(500),
        currency: "USD",
      }),
      // Borrada, y una de otra organización: invisibles para la serie.
      { ...ganada(dia("2026-03-15T00:00:00.000Z"), 111, "USD"), deletedAt: dia("2026-03-16") },
      { ...ganada(dia("2026-03-15T00:00:00.000Z"), 222, "USD"), organizationId: "org-b" },
    ],
    null,
  );
  const serie = await getRevenueSeries(ORG, "day", { now: AHORA, db });

  assert.equal(serie.currency, "USD");
  assert.deepEqual(serie.points[29], { label: "2026-03-15", value: "60.00" });
});
