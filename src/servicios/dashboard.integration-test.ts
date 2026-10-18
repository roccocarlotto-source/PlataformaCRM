import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import type { ServiceOrderStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import {
  borrarOrgDePrueba,
  crearOrgDePrueba,
  crearPedir,
  levantarApp,
  type OrgDePrueba,
} from "../routes/gateDeModulos.test-helper";
import { createBranch } from "../services/branch.service";
import { activarModulo } from "../services/organizationModules.service";
import {
  LIMITE_POR_TARJETA,
  resumenDelTaller as resumenNuevo,
  resumenDelTallerConPrisma,
} from "./services/dashboard.service";

// La lectura nueva del resumen (SQL directo, pocas consultas) tiene que dar
// lo mismo que la de antes con Prisma, campo por campo, en cada escenario.
async function resumenDelTaller(...args: Parameters<typeof resumenNuevo>) {
  const [nuevo, conPrisma] = await Promise.all([
    resumenNuevo(...args),
    resumenDelTallerConPrisma(...args),
  ]);
  assert.deepStrictEqual(nuevo, conPrisma, "resumenDelTaller distinto de la lectura con Prisma");
  return nuevo;
}

// ---------------------------------------------------------------------------
// S11 de docs/servicios.md (§4.7): el resumen del taller contra la base real.
//
//   - Autos en el taller por estado; listos para retirar desde el más viejo;
//     esperando aprobación hace más de 24 h (desde su último paso a ese
//     estado); agendados con el turno cancelado.
//   - Services vencidos y en 30 días: "hoy" en la zona de la organización,
//     solo vehículos vigentes, sin orden abierta y sin "No recordar".
//   - Hasta LIMITE_POR_TARJETA por lista, con el total ("y N más").
//   - El filtro por sucursal, y el 403 del gate sin el módulo.
// ---------------------------------------------------------------------------

let taller: OrgDePrueba;
let sinModulo: OrgDePrueba;
let baseUrl: string;
let cerrar: () => Promise<void>;
const pedir = crearPedir(() => baseUrl);

let centro: string;
let norte: string;
let duena: string;
let numero = 0;
let patente = 0;

const ADMIN = { role: "ADMIN" as const };
// 15/10/2026 a las 22:00 en Montevideo: en UTC ya es el 16.
const AHORA = new Date("2026-10-16T01:00:00.000Z");
const dia = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

async function vehiculo(extra: Record<string, unknown> = {}) {
  return prisma.customerVehicle.create({
    data: {
      organizationId: taller.id,
      contactId: duena,
      branchId: centro,
      make: "Toyota",
      model: "Hilux",
      licensePlate: `DSH ${String(++patente)}`,
      licensePlateNorm: `DSH${String(patente)}`,
      ...extra,
    },
  });
}

async function orden(status: ServiceOrderStatus, extra: Record<string, unknown> = {}) {
  const v = await vehiculo({ branchId: (extra.branchId as string | undefined) ?? centro });
  return prisma.serviceOrder.create({
    data: {
      organizationId: taller.id,
      number: ++numero,
      customerVehicleId: v.id,
      contactId: duena,
      branchId: centro,
      status,
      createdById: taller.authIds[0],
      ...(status === "ENTREGADO" ? { deliveredAt: AHORA } : {}),
      ...(status === "CANCELADO" ? { cancelledAt: AHORA, cancelReason: "x" } : {}),
      ...extra,
    },
  });
}

async function limpiar() {
  const where = { organizationId: taller.id };
  await prisma.customerVehicle.updateMany({ where, data: { nextServiceSetFromOrderId: null } });
  await prisma.serviceOrderStatusChange.deleteMany({ where });
  await prisma.serviceOrder.deleteMany({ where });
  await prisma.booking.deleteMany({ where });
  await prisma.customerVehicle.deleteMany({ where });
}

before(async () => {
  ({ baseUrl, cerrar } = await levantarApp());
  taller = await crearOrgDePrueba("servicios-dashboard", "COMPLETA", "AUTOMOTORA", 1);
  sinModulo = await crearOrgDePrueba("servicios-dashboard", "COMPLETA", "AUTOMOTORA", 1);
  await prisma.organization.update({
    where: { id: taller.id },
    data: { timezone: "America/Montevideo" },
  });
  await activarModulo(taller.id, "servicios", taller.authIds[0]);
  centro = (await createBranch(taller.id, { name: "Centro", timezone: "America/Montevideo" })).id;
  norte = (await createBranch(taller.id, { name: "Norte", timezone: "America/Montevideo" })).id;
  duena = (
    await prisma.contact.create({
      data: { organizationId: taller.id, firstName: "Duena", lastName: "Prueba" },
    })
  ).id;
});

beforeEach(async () => {
  numero = 0;
  await limpiar();
});

after(async () => {
  if (cerrar) await cerrar();
  await limpiar();
  for (const org of [taller, sinModulo]) await borrarOrgDePrueba(org);
});

test("autos en el taller por estado, y los listos para retirar desde el más viejo", async () => {
  await orden("RECIBIDO");
  await orden("EN_TRABAJO");
  await orden("EN_TRABAJO");
  await orden("ESPERANDO_APROBACION");
  // No cuentan: agendada, entregada, cancelada.
  await orden("AGENDADO", { scheduledFor: AHORA });
  await orden("ENTREGADO");
  await orden("CANCELADO");
  const nueva = await orden("LISTO_PARA_RETIRAR", { readyAt: new Date("2026-10-15T12:00:00Z") });
  const vieja = await orden("LISTO_PARA_RETIRAR", { readyAt: new Date("2026-10-09T12:00:00Z") });

  const r = await resumenDelTaller(taller.id, ADMIN, undefined, AHORA);
  assert.equal(r.hoy, "2026-10-15", "el día de Montevideo, no el de UTC");
  assert.deepEqual(r.enElTaller, {
    total: 4,
    porEstado: { RECIBIDO: 1, EN_TRABAJO: 2, ESPERANDO_APROBACION: 1 },
  });
  assert.equal(r.listosParaRetirar.total, 2);
  assert.deepEqual(
    r.listosParaRetirar.items.map((o) => o.id),
    [vieja.id, nueva.id],
  );
  assert.match(r.listosParaRetirar.items[0].numero, /^OS-\d{4}$/);
  assert.equal(r.listosParaRetirar.items[0].cliente, "Duena Prueba");
  assert.match(r.listosParaRetirar.items[0].vehiculo, /^Toyota Hilux \(DSH \d+\)$/);
  assert.equal(r.listosParaRetirar.items[0].desde, "2026-10-09T12:00:00.000Z");
});

test("esperando aprobación hace más de 24 h, desde su último paso a ese estado", async () => {
  const colgada = await orden("ESPERANDO_APROBACION");
  const reciente = await orden("ESPERANDO_APROBACION");
  const volvio = await orden("ESPERANDO_APROBACION");
  const cambio = (serviceOrderId: string, changedAt: string) =>
    prisma.serviceOrderStatusChange.create({
      data: {
        organizationId: taller.id,
        serviceOrderId,
        fromStatus: "EN_TRABAJO",
        toStatus: "ESPERANDO_APROBACION",
        changedById: taller.authIds[0],
        changedAt: new Date(changedAt),
      },
    });
  await cambio(colgada.id, "2026-10-13T12:00:00Z");
  await cambio(reciente.id, "2026-10-15T20:00:00Z");
  // Pasó hace 3 días, volvió a trabajo y volvió a esperar hace 2 horas: cuenta el último.
  await cambio(volvio.id, "2026-10-12T12:00:00Z");
  await cambio(volvio.id, "2026-10-15T23:00:00Z");

  const r = await resumenDelTaller(taller.id, ADMIN, undefined, AHORA);
  assert.equal(r.esperandoAprobacion.total, 1);
  assert.equal(r.esperandoAprobacion.items[0].id, colgada.id);
  assert.equal(r.esperandoAprobacion.items[0].desde, "2026-10-13T12:00:00.000Z");
});

test("services vencidos y en 30 días: hoy de Montevideo, vigentes, sin orden abierta ni No recordar", async () => {
  const vencido = await vehiculo({ nextServiceDueOn: dia("2026-10-14") });
  const hoy = await vehiculo({ nextServiceDueOn: dia("2026-10-15") });
  const en30 = await vehiculo({ nextServiceDueOn: dia("2026-11-14") });
  await vehiculo({ nextServiceDueOn: dia("2026-11-15") }); // a 31 días: no
  await vehiculo({ nextServiceDueOn: dia("2026-10-01"), remindersOptOut: true });
  await vehiculo({ nextServiceDueOn: dia("2026-10-01"), deletedAt: AHORA });
  await vehiculo({
    nextServiceDueOn: dia("2026-10-01"),
    ownershipEndedAt: AHORA,
    ownershipEndReason: "OTRO",
  });
  // Con una orden abierta ya está en el taller: no es para llamar.
  const conOrden = await vehiculo({ nextServiceDueOn: dia("2026-10-01") });
  await prisma.serviceOrder.create({
    data: {
      organizationId: taller.id,
      number: ++numero,
      customerVehicleId: conOrden.id,
      contactId: duena,
      branchId: centro,
      status: "RECIBIDO",
      createdById: taller.authIds[0],
    },
  });

  const r = await resumenDelTaller(taller.id, ADMIN, undefined, AHORA);
  assert.deepEqual(r.servicesVencidos, {
    total: 1,
    items: [
      {
        id: vencido.id,
        cliente: "Duena Prueba",
        vehiculo: vencido.licensePlate ? `Toyota Hilux (${vencido.licensePlate})` : "",
        fecha: "2026-10-14",
      },
    ],
  });
  assert.deepEqual(
    r.servicesEn30Dias.items.map((v) => v.id),
    [hoy.id, en30.id],
  );
});

test("hasta 10 por lista, con el total para el 'y N más'", async () => {
  for (let i = 0; i < LIMITE_POR_TARJETA + 3; i++) {
    await vehiculo({ nextServiceDueOn: dia(`2026-09-${String(10 + i).padStart(2, "0")}`) });
  }
  const r = await resumenDelTaller(taller.id, ADMIN, undefined, AHORA);
  assert.equal(r.servicesVencidos.total, LIMITE_POR_TARJETA + 3);
  assert.equal(r.servicesVencidos.items.length, LIMITE_POR_TARJETA);
  assert.equal(r.servicesVencidos.items[0].fecha, "2026-09-10", "el más atrasado primero");
});

test("agendados con el turno cancelado", async () => {
  const recurso = await prisma.resource.create({
    data: { organizationId: taller.id, branchId: centro, name: "Elevador", type: "ROOM" },
  });
  const servicio = await prisma.serviceType.create({
    data: {
      organizationId: taller.id,
      branchId: centro,
      resourceId: recurso.id,
      name: "Service",
      durationMin: 60,
    },
  });
  try {
    const turno = (status: "CONFIRMED" | "CANCELLED") =>
      prisma.booking.create({
        data: {
          organizationId: taller.id,
          branchId: centro,
          serviceTypeId: servicio.id,
          resourceId: recurso.id,
          contactId: duena,
          startsAt: new Date("2026-10-20T13:00:00Z"),
          endsAt: new Date("2026-10-20T14:00:00Z"),
          status,
        },
      });
    const cancelada = await orden("AGENDADO", {
      scheduledFor: new Date("2026-10-20T13:00:00Z"),
      bookingId: (await turno("CANCELLED")).id,
    });
    await orden("AGENDADO", {
      scheduledFor: new Date("2026-10-20T13:00:00Z"),
      bookingId: (await turno("CONFIRMED")).id,
    });
    const r = await resumenDelTaller(taller.id, ADMIN, undefined, AHORA);
    assert.equal(r.turnosCancelados.total, 1);
    assert.equal(r.turnosCancelados.items[0].id, cancelada.id);
  } finally {
    await prisma.serviceOrder.deleteMany({ where: { organizationId: taller.id } });
    await prisma.booking.deleteMany({ where: { organizationId: taller.id } });
    await prisma.serviceType.deleteMany({ where: { id: servicio.id } });
    await prisma.resource.deleteMany({ where: { id: recurso.id } });
  }
});

test("el filtro por sucursal, y por HTTP: 200 con el módulo, 403 sin él", async () => {
  await orden("RECIBIDO");
  await orden("RECIBIDO", { branchId: norte });
  await vehiculo({ nextServiceDueOn: dia("2026-10-01"), branchId: norte });

  const deNorte = await resumenDelTaller(taller.id, ADMIN, norte, AHORA);
  assert.equal(deNorte.enElTaller.total, 1);
  assert.equal(deNorte.servicesVencidos.total, 1);
  assert.equal((await resumenDelTaller(taller.id, ADMIN, centro, AHORA)).servicesVencidos.total, 0);

  const ok = await pedir(taller, "GET", `/api/servicios/dashboard?branchId=${norte}`);
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal((ok.json as { enElTaller: { total: number } }).enElTaller.total, 1);
  const malo = await pedir(taller, "GET", "/api/servicios/dashboard?branchId=no-es-un-id");
  assert.equal(malo.status, 400);
  const sin = await pedir(sinModulo, "GET", "/api/servicios/dashboard");
  assert.equal(sin.status, 403);
});
