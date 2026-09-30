import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { prisma } from "../lib/prisma";
import { createBranch, deleteBranch } from "./branch.service";
import {
  getBusinessHours,
  proximaAperturaDeLaSucursal,
  replaceBusinessHoursForBranch,
} from "./branchBusinessHours.service";
import { assertAppError, capturar, desmontar, montar, type Escenario } from "./vehicle.test-helper";

// ---------------------------------------------------------------------------
// Horario de atención de la sucursal — G-07 de
// docs-privados/auditoria-2026-09-30-corta.md (local, no está en GitHub) —
// contra Postgres real: lectura con el default, reemplazo de la semana
// entera, `[]` que vuelve al default, validación de superposición, aislamiento
// entre organizaciones y la próxima apertura con el horario guardado.
//
// Que sea solo ADMIN está en src/routes/branch.routes.test.ts; que el agente
// responda 24/7 aunque la sucursal esté cerrada, en
// whatsappWebhook.controller.integration-test.ts.
// ---------------------------------------------------------------------------

let a: Escenario;
let b: Escenario;

before(async () => {
  a = await montar("horario-a");
  b = await montar("horario-b");
});

after(async () => {
  for (const e of [a, b]) {
    if (e)
      await prisma.branchBusinessHours.deleteMany({ where: { organizationId: e.organizationId } });
  }
  await desmontar(a, b);
});

const LUNES_A_VIERNES_10_A_18 = (
  ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"] as const
).map((weekday) => ({ weekday, startMinute: 600, endMinute: 1080 }));

test("sin horario cargado: configured false, businessHours vacío y el default lunes a sábado de 9 a 20", async () => {
  const horario = await getBusinessHours(a.organizationId, a.branchId);
  assert.equal(horario.configured, false);
  assert.deepEqual(horario.businessHours, []);
  assert.equal(horario.defaultBusinessHours.length, 6);
  assert.deepEqual(horario.defaultBusinessHours[0], {
    weekday: "MONDAY",
    startTime: "09:00",
    endTime: "20:00",
  });
});

test("reemplazar guarda la semana entera, la devuelve en HH:MM y un segundo reemplazo la pisa (no suma)", async () => {
  const guardado = await replaceBusinessHoursForBranch(
    a.organizationId,
    a.branchId,
    LUNES_A_VIERNES_10_A_18,
  );
  assert.equal(guardado.configured, true);
  assert.equal(guardado.businessHours.length, 5);
  assert.deepEqual(guardado.businessHours[0], {
    weekday: "MONDAY",
    startTime: "10:00",
    endTime: "18:00",
  });

  const pisado = await replaceBusinessHoursForBranch(a.organizationId, a.branchId, [
    { weekday: "SATURDAY", startMinute: 540, endMinute: 780 },
  ]);
  assert.deepEqual(pisado.businessHours, [
    { weekday: "SATURDAY", startTime: "09:00", endTime: "13:00" },
  ]);
  assert.equal(
    await prisma.branchBusinessHours.count({ where: { organizationId: a.organizationId } }),
    1,
  );
});

test("[] borra el horario propio: vuelve al default", async () => {
  await replaceBusinessHoursForBranch(a.organizationId, a.branchId, LUNES_A_VIERNES_10_A_18);
  const vacio = await replaceBusinessHoursForBranch(a.organizationId, a.branchId, []);
  assert.equal(vacio.configured, false);
  assert.deepEqual(vacio.businessHours, []);
});

test("franjas superpuestas el mismo día → 400 y no se escribe nada", async () => {
  await replaceBusinessHoursForBranch(a.organizationId, a.branchId, []);
  const err = await capturar(() =>
    replaceBusinessHoursForBranch(a.organizationId, a.branchId, [
      { weekday: "MONDAY", startMinute: 540, endMinute: 780 },
      { weekday: "MONDAY", startMinute: 720, endMinute: 1200 },
    ]),
  );
  assertAppError(err, 400, "superpuestas");
  assert.equal(
    await prisma.branchBusinessHours.count({ where: { organizationId: a.organizationId } }),
    0,
  );
});

test("la sucursal de OTRA organización es 404 al leer y al escribir, y su horario no cambia", async () => {
  await replaceBusinessHoursForBranch(b.organizationId, b.branchId, LUNES_A_VIERNES_10_A_18);

  assertAppError(
    await capturar(() => getBusinessHours(a.organizationId, b.branchId)),
    404,
    "sucursal",
  );
  assertAppError(
    await capturar(() => replaceBusinessHoursForBranch(a.organizationId, b.branchId, [])),
    404,
    "sucursal",
  );
  assert.equal(
    await prisma.branchBusinessHours.count({ where: { organizationId: b.organizationId } }),
    5,
  );
});

test("la próxima apertura usa el horario guardado en la zona de la sucursal", async () => {
  // Cerrado todo el día salvo el sábado de 9 a 13; desde un lunes, la próxima
  // apertura es el sábado a las 9 locales. vehicle.test-helper crea la
  // sucursal en America/Argentina/Buenos_Aires (UTC-3 sin horario de verano).
  await replaceBusinessHoursForBranch(a.organizationId, a.branchId, [
    { weekday: "SATURDAY", startMinute: 540, endMinute: 780 },
  ]);
  const lunes = new Date("2026-10-05T12:00:00-03:00");
  const apertura = await proximaAperturaDeLaSucursal(a.organizationId, a.branchId, lunes);
  assert.equal(apertura.toISOString(), new Date("2026-10-10T09:00:00-03:00").toISOString());
});

test("una sucursal borrada es 404 para el horario", async () => {
  // El horario de la sucursal no bloquea su borrado (no está en los RESTRICT de
  // deleteBranch): es configuración de la sucursal, no un dato vivo.
  await replaceBusinessHoursForBranch(b.organizationId, b.branchId, []);
  const temporal = await createBranch(b.organizationId, {
    name: "Temporal",
    timezone: "America/Montevideo",
  });
  await replaceBusinessHoursForBranch(b.organizationId, temporal.id, LUNES_A_VIERNES_10_A_18);
  await deleteBranch(b.organizationId, temporal.id);
  assertAppError(
    await capturar(() => getBusinessHours(b.organizationId, temporal.id)),
    404,
    "sucursal",
  );
});
