import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { prisma } from "../lib/prisma";
import {
  borrarOrgDePrueba,
  crearOrgDePrueba,
  type OrgDePrueba,
} from "../routes/gateDeModulos.test-helper";
import { createBranch } from "../services/branch.service";
import { activarModulo, previaDeActivacion } from "../services/organizationModules.service";
import { barrerVehiculosVendidos } from "./vehiculosVendidos/barrido";

// ---------------------------------------------------------------------------
// S10 de docs/servicios.md (§5, §6.1 y §2.2.1): de la venta al vehículo del
// cliente, contra la base real.
//
//   - Una venta ganada con unidad y contacto es un vehículo de cliente, una
//     sola vez, con los datos de la unidad y la fecha de compra.
//   - El primer service (compra + firstServiceAfterMonths) solo para ventas
//     desde la primera activación, contada en la zona de la organización.
//   - Un vehículo vigente del mismo cliente con esa matrícula o ese chasis se
//     completa; uno de otro cliente no se toca.
//   - La venta que deja de estar ganada: se borra el vehículo que creó el
//     barrido; con órdenes queda, desvinculado y con una nota.
//   - Permuta: la unidad que entra al stock con la matrícula o el chasis de un
//     vehículo de cliente lo termina. Nunca la propia unidad ni una anterior.
//   - Sin el módulo, nada.
// ---------------------------------------------------------------------------

let taller: OrgDePrueba;
let sinModulo: OrgDePrueba;
const sucursal = new Map<string, string>();
const pipeline = new Map<string, { pipelineId: string; stageId: string }>();

// Activado el 15/10/2026 a la 01:00 UTC: en Montevideo, el 14/10 a las 22:00.
const ACTIVACION = new Date("2026-10-15T01:00:00.000Z");
const dia = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

async function cliente(org: OrgDePrueba, nombre = "Laura") {
  return prisma.contact.create({
    data: { organizationId: org.id, firstName: nombre, lastName: "Prueba" },
  });
}

let unidades = 0;

async function unidad(
  org: OrgDePrueba,
  datos: { licensePlate?: string | null; vin?: string | null; status?: "SOLD" | "AVAILABLE" } = {},
) {
  return prisma.vehicle.create({
    data: {
      organizationId: org.id,
      branchId: sucursal.get(org.id)!,
      internalCode: `U-${String(++unidades)}`,
      condition: "USED",
      make: "Toyota",
      model: "Hilux",
      year: 2022,
      mileage: 15000,
      licensePlate: datos.licensePlate === undefined ? "abc 1234" : datos.licensePlate,
      vin: datos.vin ?? null,
      status: datos.status ?? "SOLD",
    },
  });
}

async function venta(
  org: OrgDePrueba,
  contactId: string | null,
  vehicleId: string,
  fecha: string,
  status: "WON" | "OPEN" | "LOST" = "WON",
) {
  const { pipelineId, stageId } = pipeline.get(org.id)!;
  return prisma.opportunity.create({
    data: {
      organizationId: org.id,
      pipelineId,
      stageId,
      title: "Hilux",
      ownerId: org.authIds[0],
      contactId,
      vehicleId,
      status,
      actualCloseDate: status === "WON" ? dia(fecha) : null,
    },
  });
}

async function vehiculosDe(org: OrgDePrueba) {
  return prisma.customerVehicle.findMany({
    where: { organizationId: org.id },
    orderBy: { createdAt: "asc" },
  });
}

const barrer = () => barrerVehiculosVendidos({ organizationId: taller.id });

async function limpiar(org: OrgDePrueba) {
  const where = { organizationId: org.id };
  await prisma.activity.deleteMany({ where });
  await prisma.customerVehicleOwnerChange.deleteMany({ where });
  await prisma.serviceOrder.deleteMany({ where });
  await prisma.customerVehicle.deleteMany({ where });
  await prisma.opportunity.deleteMany({ where });
  await prisma.vehicle.deleteMany({ where });
  await prisma.contact.deleteMany({ where });
}

before(async () => {
  taller = await crearOrgDePrueba("servicios-ventas", "COMPLETA", "AUTOMOTORA", 1);
  sinModulo = await crearOrgDePrueba("servicios-ventas", "COMPLETA", "AUTOMOTORA", 1);
  for (const org of [taller, sinModulo]) {
    await prisma.organization.update({
      where: { id: org.id },
      data: { timezone: "America/Montevideo" },
    });
    sucursal.set(
      org.id,
      (await createBranch(org.id, { name: "Centro", timezone: "America/Montevideo" })).id,
    );
    const p = await prisma.pipeline.create({ data: { organizationId: org.id, name: "Ventas" } });
    const s = await prisma.stage.create({
      data: { organizationId: org.id, pipelineId: p.id, name: "Nuevo", order: 0 },
    });
    pipeline.set(org.id, { pipelineId: p.id, stageId: s.id });
  }
  await activarModulo(taller.id, "servicios", taller.authIds[0]);
  await prisma.organizationModule.update({
    where: { organizationId_module: { organizationId: taller.id, module: "servicios" } },
    data: { enabledAt: ACTIVACION },
  });
});

beforeEach(async () => {
  unidades = 0;
  for (const org of [taller, sinModulo]) await limpiar(org);
  await prisma.workshopSettings.update({
    where: { organizationId: taller.id },
    data: { firstServiceAfterMonths: 12 },
  });
});

after(async () => {
  for (const org of [taller, sinModulo]) {
    if (!org) continue;
    await limpiar(org);
    await borrarOrgDePrueba(org);
  }
});

test("una venta ganada es un vehículo de cliente con los datos de la unidad, una sola vez", async () => {
  const laura = await cliente(taller);
  const u = await unidad(taller, { vin: "9bw-zzz 377" });
  const o = await venta(taller, laura.id, u.id, "2026-10-14");

  const r = await barrer();
  assert.equal(r.creados, 1);
  const [v] = await vehiculosDe(taller);
  assert.equal(v.contactId, laura.id);
  assert.equal(v.branchId, sucursal.get(taller.id));
  assert.equal(v.make, "Toyota");
  assert.equal(v.model, "Hilux");
  assert.equal(v.year, 2022);
  assert.equal(v.mileage, 15000);
  assert.equal(v.licensePlate, "abc 1234");
  assert.equal(v.licensePlateNorm, "ABC1234");
  assert.equal(v.vin, "9BWZZZ377");
  assert.equal(iso(v.purchasedOn), "2026-10-14");
  assert.equal(v.sourceVehicleId, u.id);
  assert.equal(v.sourceOpportunityId, o.id);

  const r2 = await barrer();
  assert.equal(r2.creados + r2.completados, 0);
  assert.equal((await vehiculosDe(taller)).length, 1);
});

test("primer service: venta desde la activación (el día en Montevideo) a 12 meses; anterior, sin fecha", async () => {
  const laura = await cliente(taller, "Laura");
  const ana = await cliente(taller, "Ana");
  // El 14/10 es el día de la activación en Montevideo (en UTC ya era el 15).
  await venta(taller, laura.id, (await unidad(taller, { licensePlate: "AAA 1" })).id, "2026-10-14");
  await venta(taller, ana.id, (await unidad(taller, { licensePlate: "AAA 2" })).id, "2026-10-13");

  await barrer();
  const porContacto = new Map((await vehiculosDe(taller)).map((v) => [v.contactId, v]));
  // Sin correrse al 13/10/2027 por leer la fecha como instante en la zona.
  assert.equal(iso(porContacto.get(laura.id)!.nextServiceDueOn), "2027-10-14");
  assert.equal(porContacto.get(laura.id)!.nextServiceSetFromOrderId, null);
  // Anterior a la activación: entra (para el recambio), sin recordatorio.
  assert.equal(iso(porContacto.get(ana.id)!.purchasedOn), "2026-10-13");
  assert.equal(porContacto.get(ana.id)!.nextServiceDueOn, null);
});

test("primer service: fin de mes, y sin fecha si la configuración no la fija", async () => {
  await prisma.workshopSettings.update({
    where: { organizationId: taller.id },
    data: { firstServiceAfterMonths: 4 },
  });
  const laura = await cliente(taller);
  await venta(taller, laura.id, (await unidad(taller, { licensePlate: "AAA 1" })).id, "2026-10-31");
  await barrer();
  assert.equal(iso((await vehiculosDe(taller))[0].nextServiceDueOn), "2027-02-28");

  await limpiar(taller);
  await prisma.workshopSettings.update({
    where: { organizationId: taller.id },
    data: { firstServiceAfterMonths: null },
  });
  const ana = await cliente(taller, "Ana");
  await venta(taller, ana.id, (await unidad(taller, { licensePlate: "AAA 2" })).id, "2026-10-31");
  await barrer();
  assert.equal((await vehiculosDe(taller))[0].nextServiceDueOn, null);
});

test("el cliente ya traía el auto: se completa el vehículo por matrícula o por chasis, sin pisar su fecha", async () => {
  const laura = await cliente(taller, "Laura");
  const ana = await cliente(taller, "Ana");
  const deLaura = await prisma.customerVehicle.create({
    data: {
      organizationId: taller.id,
      contactId: laura.id,
      make: "Toyota",
      model: "Hilux",
      licensePlate: "ABC-1234",
      licensePlateNorm: "ABC1234",
    },
  });
  const deAna = await prisma.customerVehicle.create({
    data: {
      organizationId: taller.id,
      contactId: ana.id,
      make: "Fiat",
      model: "Uno",
      vin: "CHASIS1",
      nextServiceDueOn: dia("2027-01-10"),
    },
  });
  const u1 = await unidad(taller);
  const o1 = await venta(taller, laura.id, u1.id, "2026-10-14");
  const u2 = await unidad(taller, { licensePlate: null, vin: "chasis-1" });
  await venta(taller, ana.id, u2.id, "2026-10-14");

  const r = await barrer();
  assert.equal(r.creados, 0);
  assert.equal(r.completados, 2);
  const todos = await vehiculosDe(taller);
  assert.equal(todos.length, 2);
  const laura2 = todos.find((v) => v.id === deLaura.id)!;
  assert.equal(laura2.sourceVehicleId, u1.id);
  assert.equal(laura2.sourceOpportunityId, o1.id);
  assert.equal(iso(laura2.purchasedOn), "2026-10-14");
  assert.equal(iso(laura2.nextServiceDueOn), "2027-10-14");
  const ana2 = todos.find((v) => v.id === deAna.id)!;
  assert.equal(ana2.sourceVehicleId, u2.id);
  assert.equal(iso(ana2.nextServiceDueOn), "2027-01-10", "no pisa la fecha que ya tenía");

  assert.equal((await barrer()).completados, 0);
});

test("la matrícula ya es de un vehículo vigente de OTRO cliente: no se toca", async () => {
  const laura = await cliente(taller, "Laura");
  const ana = await cliente(taller, "Ana");
  await prisma.customerVehicle.create({
    data: {
      organizationId: taller.id,
      contactId: ana.id,
      make: "Toyota",
      model: "Hilux",
      licensePlate: "ABC 1234",
      licensePlateNorm: "ABC1234",
    },
  });
  // La unidad estaba en el stock antes que el vehículo de Ana: no es una
  // permuta de Ana, es una matrícula repetida que tiene que mirar una persona.
  const u = await unidad(taller);
  await prisma.vehicle.update({
    where: { id: u.id },
    data: { createdAt: new Date("2020-01-01T00:00:00Z") },
  });
  await venta(taller, laura.id, u.id, "2026-10-14");
  const r = await barrer();
  assert.equal(r.permutas, 0);
  assert.equal(r.conflictos, 1);
  assert.equal(r.creados + r.completados, 0);
  const [v] = await vehiculosDe(taller);
  assert.equal(v.contactId, ana.id);
  assert.equal(v.sourceOpportunityId, null);
});

test("una venta con el contacto borrado o sin ganar no se convierte", async () => {
  const borrado = await cliente(taller, "Borrado");
  await prisma.contact.update({ where: { id: borrado.id }, data: { deletedAt: new Date() } });
  const laura = await cliente(taller);
  await venta(
    taller,
    borrado.id,
    (await unidad(taller, { licensePlate: "AAA 2" })).id,
    "2026-10-14",
  );
  await venta(taller, laura.id, (await unidad(taller, { licensePlate: "AAA 3" })).id, "", "OPEN");
  await venta(taller, laura.id, (await unidad(taller, { licensePlate: "AAA 4" })).id, "", "LOST");
  const r = await barrer();
  assert.equal(r.creados, 0);
  assert.equal((await vehiculosDe(taller)).length, 0);
});

test("la venta deja de estar ganada: se borra el vehículo; con órdenes queda, desvinculado y con una nota", async () => {
  const laura = await cliente(taller, "Laura");
  const ana = await cliente(taller, "Ana");
  const o1 = await venta(
    taller,
    laura.id,
    (await unidad(taller, { licensePlate: "AAA 1" })).id,
    "2026-10-14",
  );
  const o2 = await venta(
    taller,
    ana.id,
    (await unidad(taller, { licensePlate: "AAA 2" })).id,
    "2026-10-14",
  );
  await barrer();
  const deAna = (await vehiculosDe(taller)).find((v) => v.contactId === ana.id)!;
  await prisma.serviceOrder.create({
    data: {
      organizationId: taller.id,
      number: 1,
      customerVehicleId: deAna.id,
      contactId: ana.id,
      branchId: sucursal.get(taller.id)!,
      status: "ENTREGADO",
      deliveredAt: new Date("2026-11-01T12:00:00Z"),
      createdById: taller.authIds[0],
    },
  });

  // Reabrir la venta deja actual_close_date en null (opportunity.service).
  await prisma.opportunity.update({
    where: { id: o1.id },
    data: { status: "OPEN", actualCloseDate: null },
  });
  await prisma.opportunity.update({
    where: { id: o2.id },
    data: { status: "LOST", actualCloseDate: dia("2026-10-25") },
  });
  const r = await barrer();
  assert.equal(r.borrados, 1);
  assert.equal(r.desvinculados, 1);

  const todos = await vehiculosDe(taller);
  const deLaura = todos.find((v) => v.contactId === laura.id)!;
  assert.ok(deLaura.deletedAt, "el de Laura (sin órdenes) se borra");
  const ana2 = todos.find((v) => v.id === deAna.id)!;
  assert.equal(ana2.deletedAt, null);
  assert.equal(ana2.sourceOpportunityId, null);
  assert.equal(ana2.sourceVehicleId, null);
  assert.equal(ana2.purchasedOn, null);
  const notas = await prisma.activity.findMany({
    where: { organizationId: taller.id, contactId: ana.id, type: "NOTE" },
  });
  assert.equal(notas.length, 1);
  assert.match(notas[0].subject, /^La venta de su Toyota Hilux \(AAA 2\) ya no está ganada/);
  assert.match(notas[0].body ?? "", /porque tiene órdenes del taller/);
  assert.ok(notas[0].completedAt, "la nota nace cerrada");

  // Una segunda pasada no repite la nota ni vuelve a crear nada.
  const r2 = await barrer();
  assert.equal(r2.borrados + r2.desvinculados + r2.creados, 0);
  assert.equal(
    await prisma.activity.count({ where: { organizationId: taller.id, type: "NOTE" } }),
    1,
  );

  // Ganada otra vez: vuelve el vehículo de Laura.
  await prisma.opportunity.update({
    where: { id: o1.id },
    data: { status: "WON", actualCloseDate: dia("2026-11-02") },
  });
  assert.equal((await barrer()).creados, 1);
});

test("un vehículo que ya estaba cargado y la venta solo completó no se borra al revertirla", async () => {
  const laura = await cliente(taller);
  const antes = await prisma.customerVehicle.create({
    data: {
      organizationId: taller.id,
      contactId: laura.id,
      make: "Toyota",
      model: "Hilux",
      licensePlate: "ABC 1234",
      licensePlateNorm: "ABC1234",
      purchasedOn: dia("2024-03-01"),
      createdAt: new Date("2025-01-10T12:00:00Z"),
    },
  });
  const o = await venta(taller, laura.id, (await unidad(taller)).id, "2026-10-14");
  assert.equal((await barrer()).completados, 1);
  await prisma.opportunity.update({
    where: { id: o.id },
    data: { status: "OPEN", actualCloseDate: null },
  });
  const r = await barrer();
  assert.equal(r.borrados, 0);
  assert.equal(r.desvinculados, 1);
  const v = await prisma.customerVehicle.findUniqueOrThrow({ where: { id: antes.id } });
  assert.equal(v.deletedAt, null);
  assert.equal(v.sourceOpportunityId, null);
  assert.equal(iso(v.purchasedOn), "2024-03-01", "la fecha de compra no la puso la venta");
});

test("permuta: la unidad que entra al stock termina el vehículo del cliente; la propia unidad y una anterior no cuentan", async () => {
  const laura = await cliente(taller, "Laura");
  // Una unidad vieja del mismo auto (una venta anterior, sigue en el stock como vendida).
  const vieja = await unidad(taller);
  await prisma.vehicle.update({
    where: { id: vieja.id },
    data: { createdAt: new Date("2020-01-01T00:00:00Z") },
  });
  const u1 = await unidad(taller);
  await venta(taller, laura.id, u1.id, "2026-10-14");
  await barrer();
  const [delCliente] = await vehiculosDe(taller);
  // Coincide con su propia unidad (u1) y con la vieja: ninguna es permuta.
  assert.equal((await barrer()).permutas, 0);

  // Laura entrega el auto como parte de pago: entra al stock otra vez.
  const parteDePago = await unidad(taller, { licensePlate: "ABC-1234", status: "AVAILABLE" });
  const r = await barrer();
  assert.equal(r.permutas, 1);
  const v = await prisma.customerVehicle.findUniqueOrThrow({ where: { id: delCliente.id } });
  assert.ok(v.ownershipEndedAt);
  assert.equal(v.ownershipEndReason, "PERMUTA");
  assert.equal(v.purchasedOn, null);
  const [cambio] = await prisma.customerVehicleOwnerChange.findMany({
    where: { organizationId: taller.id, customerVehicleId: v.id },
  });
  assert.equal(cambio.kind, "FIN");
  assert.equal(cambio.endReason, "PERMUTA");
  assert.equal(cambio.stockVehicleId, parteDePago.id);
  assert.equal(cambio.changedById, null);
  assert.equal(iso(cambio.previousPurchasedOn), "2026-10-14");
  const [nota] = await prisma.activity.findMany({
    where: { organizationId: taller.id, contactId: laura.id, type: "NOTE" },
  });
  assert.match(nota.body ?? "", /entró al stock \(unidad U-3\)/);
  assert.equal((await barrer()).permutas, 0, "una sola vez");

  // La unidad se vende a otro cliente: nace su vehículo, sin chocar ni ser permuta.
  const ana = await cliente(taller, "Ana");
  await venta(taller, ana.id, parteDePago.id, "2026-11-05");
  const r2 = await barrer();
  assert.equal(r2.creados, 1);
  assert.equal(r2.permutas, 0);
  const deAna = (await vehiculosDe(taller)).find((x) => x.contactId === ana.id)!;
  assert.equal(deAna.ownershipEndedAt, null);
  assert.equal((await barrer()).permutas, 0, "las unidades anteriores no terminan el de Ana");
});

test("permuta con una orden abierta: espera a que se entregue", async () => {
  const laura = await cliente(taller);
  await venta(taller, laura.id, (await unidad(taller)).id, "2026-10-14");
  await barrer();
  const [v] = await vehiculosDe(taller);
  const orden = await prisma.serviceOrder.create({
    data: {
      organizationId: taller.id,
      number: 1,
      customerVehicleId: v.id,
      contactId: laura.id,
      branchId: sucursal.get(taller.id)!,
      status: "EN_TRABAJO",
      createdById: taller.authIds[0],
    },
  });
  await unidad(taller, { status: "AVAILABLE" });
  assert.equal((await barrer()).permutas, 0);
  await prisma.serviceOrder.update({
    where: { id: orden.id },
    data: { status: "ENTREGADO", deliveredAt: new Date() },
  });
  assert.equal((await barrer()).permutas, 1);
});

test("sin el módulo no se convierte nada; la previa cuenta las ventas que se van a convertir", async () => {
  const laura = await cliente(sinModulo);
  await venta(
    sinModulo,
    laura.id,
    (await unidad(sinModulo, { licensePlate: "AAA 1" })).id,
    "2026-10-14",
  );
  await venta(
    sinModulo,
    laura.id,
    (await unidad(sinModulo, { licensePlate: "AAA 2" })).id,
    "2026-10-14",
  );
  await venta(
    sinModulo,
    laura.id,
    (await unidad(sinModulo, { licensePlate: "AAA 3" })).id,
    "",
    "OPEN",
  );

  const r = await barrerVehiculosVendidos({ organizationId: sinModulo.id });
  assert.equal(r.organizaciones, 0);
  assert.equal((await vehiculosDe(sinModulo)).length, 0);
  assert.equal((await previaDeActivacion(sinModulo.id, "servicios")).ventasAConvertir, 2);

  // En el taller, después de la pasada no queda nada por convertir.
  const ana = await cliente(taller);
  await venta(taller, ana.id, (await unidad(taller)).id, "2026-10-14");
  assert.equal((await previaDeActivacion(taller.id, "servicios")).ventasAConvertir, 1);
  await barrer();
  assert.equal((await previaDeActivacion(taller.id, "servicios")).ventasAConvertir, 0);
});
