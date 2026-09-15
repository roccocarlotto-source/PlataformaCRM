import assert from "node:assert/strict";
import { test } from "node:test";
import { Prisma } from "@prisma/client";
import type { Db } from "../lib/prisma";
import {
  getDashboardSummary,
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
// Resumen del Dashboard (§30 de docs/frontend-cambios-pendientes.md), sin
// base: una "base en memoria" mínima que aplica el WHERE que el service arma
// (organizationId, deletedAt, status, currency y las ventanas gte/lt sobre
// createdAt/actualCloseDate) sobre filas fijas. Lo que se prueba acá es la
// matemática de bordes y de monedas con `now` inyectado; que Prisma ejecute
// ese WHERE igual contra Postgres real lo prueba
// opportunityDashboard.integration-test.ts.
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
  const resumen = await getDashboardSummary(ORG, { now: AHORA, db });
  assert.equal(resumen.currency, "USD");
  assert.equal(resumen.openValue, "10.50", "solo la de USD suma; serializado con dos decimales");
  assert.equal(resumen.openCount, 2, "el conteo NO filtra por moneda");
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
  const resumen = await getDashboardSummary(ORG, { now: AHORA, db });
  assert.equal(resumen.currency, "UYU");
  assert.equal(resumen.openCount, 3);
  assert.equal(resumen.openValue, "1750.25");
  assert.equal(resumen.createdThisMonth.count, 3, "creadas este mes: conteo sin moneda");
  assert.equal(resumen.createdThisMonth.value, "1750.25", "creadas este mes: monto solo en UYU");
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
  const resumen = await getDashboardSummary(ORG, { now: AHORA, db });
  assert.deepEqual(resumen.createdThisMonth, { count: 1, value: "2.00" });
  assert.deepEqual(resumen.createdLastMonth, { count: 2, value: "9.00" });
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
      // Ganada sin fecha de cierre: no entra en ningún mes.
      fila({ status: "WON", actualCloseDate: null, amount: new Prisma.Decimal(999) }),
      // Ganada en otra moneda: cuenta para Win Rate, no suma en el monto.
      won(dia("2026-03-05T00:00:00.000Z"), 777, "USD"),
    ],
    "UYU",
  );
  const resumen = await getDashboardSummary(ORG, { now: AHORA, db });
  assert.deepEqual(resumen.wonThisMonth, { count: 3, value: "500.00" });
  assert.equal(resumen.lostCountThisMonth, 1);
  assert.deepEqual(resumen.wonLastMonth, { count: 1, value: "50.00" });
  assert.equal(resumen.lostCountLastMonth, 2);
});

test("getDashboardSummary: sin nada cerrado, los conteos de Win Rate quedan en 0 (el frontend muestra el guion, nunca divide por cero)", async () => {
  const db = baseEnMemoria([fila(), fila()], "UYU");
  const resumen = await getDashboardSummary(ORG, { now: AHORA, db });
  assert.equal(resumen.wonThisMonth.count, 0);
  assert.equal(resumen.lostCountThisMonth, 0);
  assert.equal(resumen.wonLastMonth.count, 0);
  assert.equal(resumen.lostCountLastMonth, 0);
  assert.equal(
    resumen.wonThisMonth.value,
    "0.00",
    "sin filas el SUM es null y se serializa como 0.00",
  );
});

test("getDashboardSummary: revenueByMonth trae exactamente 6 meses en orden cronológico, el actual al final", async () => {
  const won = (actualCloseDate: Date, amount: number) =>
    fila({ status: "WON", actualCloseDate, amount: new Prisma.Decimal(amount) });
  const db = baseEnMemoria(
    [
      won(dia("2025-10-01T00:00:00.000Z"), 10),
      // Septiembre 2025: séptimo mes hacia atrás, fuera de la serie.
      won(dia("2025-09-30T00:00:00.000Z"), 1_000),
      won(dia("2026-01-15T00:00:00.000Z"), 40),
      won(dia("2026-03-15T00:00:00.000Z"), 60),
      // Abierta con fecha de cierre cargada: no es ingreso.
      fila({
        status: "OPEN",
        actualCloseDate: dia("2026-03-15T00:00:00.000Z"),
        amount: new Prisma.Decimal(500),
      }),
    ],
    "UYU",
  );
  const resumen = await getDashboardSummary(ORG, { now: AHORA, db });
  assert.deepEqual(resumen.revenueByMonth, [
    { month: "2025-10", value: "10.00" },
    { month: "2025-11", value: "0.00" },
    { month: "2025-12", value: "0.00" },
    { month: "2026-01", value: "40.00" },
    { month: "2026-02", value: "0.00" },
    { month: "2026-03", value: "60.00" },
  ]);
  assert.equal(resumen.wonThisMonth.value, "60.00", "ganado este mes = última entrada de la serie");
  assert.equal(resumen.wonLastMonth.value, "0.00", "ganado el mes anterior = la anteúltima");
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
  const resumen = await getDashboardSummary(ORG, { now: AHORA, db });
  assert.equal(resumen.openCount, 1);
  assert.equal(resumen.openValue, "100.00");
  assert.deepEqual(resumen.createdThisMonth, { count: 1, value: "100.00" });
});
