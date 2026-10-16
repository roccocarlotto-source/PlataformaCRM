import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import type { OutboxEvent, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { findRoleByName } from "../repositories/role.repository";
import {
  borrarOrgDePrueba,
  crearOrgDePrueba,
  crearPedir,
  levantarApp,
  type OrgDePrueba,
} from "../routes/gateDeModulos.test-helper";
import { crearRegistroDeAcciones } from "../services/automationActions";
import { accionCrearActividadDeSeguimiento } from "../services/automationActions/createFollowUpActivity";
import { despacharAutomatizaciones } from "../services/automationDispatch.service";
import { eventoAEntregar } from "../services/automation.test-helper";
import { createBranch } from "../services/branch.service";
import { activarModulo } from "../services/organizationModules.service";
import { TRIGGER_RECAMBIO } from "./recambio/config";
import { barrerRecambios } from "./recambio/barrido";
import { listarRecambiosVencidos } from "./recambio/lista.service";
import { resumenDelTaller } from "./services/dashboard.service";

// ---------------------------------------------------------------------------
// S13 de docs/servicios.md (§7): el aviso de recambio contra la base real.
//
//   - El barrido: la fecha de aviso (compra + 48 meses − 60 días) en
//     [hoy − 7, hoy] de la zona de la organización, desde las 10:00; las
//     exclusiones (oportunidad abierta, sin interés, sin compra, no vigente);
//     un aviso previo automático o manual no se repite.
//   - La tarea: vendedor del contacto → de la venta de origen → responsable de
//     la sucursal → ADMIN más antiguo.
//   - La lista de vencidos sin contactar, sus criterios y sus dos acciones.
//   - Las tarjetas del resumen, y el 403 sin el módulo.
// ---------------------------------------------------------------------------

let taller: OrgDePrueba; // 0 ADMIN (el más antiguo), 1 USER (vendedor), 2 USER (otro)
let sinModulo: OrgDePrueba;
let baseUrl: string;
let cerrar: () => Promise<void>;
const pedir = crearPedir(() => baseUrl);

let sucursal: string;
let pipelineId: string;
let stageId: string;
let patente = 0;

// 16/08/2026, 13:00 en Montevideo: el aviso de una compra del 15/10/2022 es hoy.
const AHORA = new Date("2026-08-16T16:00:00.000Z");
const dia = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

async function regla(config: Prisma.InputJsonObject = {}) {
  return prisma.automation.create({
    data: {
      organizationId: taller.id,
      name: `Recambio ${randomUUID().slice(0, 6)}`,
      triggerType: TRIGGER_RECAMBIO,
      triggerConfig: config,
      actionType: "activity.create_follow_up",
      actionConfig: { subject: "Llamar por el recambio", daysUntilDue: 2 },
    },
  });
}

async function cliente(extra: Record<string, unknown> = {}) {
  return prisma.contact.create({
    data: { organizationId: taller.id, firstName: "Ana", lastName: "Prueba", ...extra },
  });
}

async function vehiculo(
  contactId: string,
  compra: string | null,
  extra: Record<string, unknown> = {},
) {
  return prisma.customerVehicle.create({
    data: {
      organizationId: taller.id,
      contactId,
      branchId: sucursal,
      make: "Fiat",
      model: "Uno",
      licensePlate: `REC ${String(++patente)}`,
      licensePlateNorm: `REC${String(patente)}`,
      purchasedOn: compra ? dia(compra) : null,
      ...extra,
    },
  });
}

async function oportunidad(contactId: string, status: "OPEN" | "WON", createdAt?: Date) {
  return prisma.opportunity.create({
    data: {
      organizationId: taller.id,
      pipelineId,
      stageId,
      title: "Venta",
      ownerId: taller.authIds[0],
      contactId,
      status,
      ...(createdAt ? { createdAt } : {}),
    },
  });
}

const eventos = (): Promise<OutboxEvent[]> =>
  prisma.outboxEvent.findMany({
    where: { organizationId: taller.id, eventType: TRIGGER_RECAMBIO },
    orderBy: { createdAt: "asc" },
  });

async function despachar(lista: OutboxEvent[]) {
  const registro = crearRegistroDeAcciones();
  registro.registrar(accionCrearActividadDeSeguimiento);
  for (const e of lista) {
    await despacharAutomatizaciones(eventoAEntregar(e), e.eventType, { registro });
  }
}

const ADMIN = { role: "ADMIN" as const };

async function limpiar() {
  const where = { organizationId: taller.id };
  await prisma.activity.deleteMany({ where });
  await prisma.automationExecution.deleteMany({ where });
  await prisma.outboxEvent.deleteMany({ where });
  await prisma.customerVehicleNotice.deleteMany({ where });
  await prisma.customerVehicle.deleteMany({ where });
  await prisma.opportunity.deleteMany({ where });
  await prisma.automation.deleteMany({ where });
  await prisma.contact.deleteMany({ where });
}

before(async () => {
  ({ baseUrl, cerrar } = await levantarApp());
  taller = await crearOrgDePrueba("servicios-recambio", "COMPLETA", "AUTOMOTORA", 3);
  sinModulo = await crearOrgDePrueba("servicios-recambio", "COMPLETA", "AUTOMOTORA", 1);
  const user = await findRoleByName("USER");
  for (const id of [taller.authIds[1], taller.authIds[2]]) {
    await prisma.user.update({ where: { id }, data: { roleId: user!.id } });
  }
  await prisma.organization.update({
    where: { id: taller.id },
    data: { timezone: "America/Montevideo" },
  });
  await activarModulo(taller.id, "servicios", taller.authIds[0]);
  sucursal = (await createBranch(taller.id, { name: "Centro", timezone: "America/Montevideo" })).id;
  pipelineId = (
    await prisma.pipeline.create({ data: { organizationId: taller.id, name: "Ventas" } })
  ).id;
  stageId = (
    await prisma.stage.create({
      data: { organizationId: taller.id, pipelineId, name: "Nuevo", order: 0 },
    })
  ).id;
});

beforeEach(async () => {
  patente = 0;
  await limpiar();
  await prisma.branch.update({ where: { id: sucursal }, data: { defaultOwnerId: null } });
});

after(async () => {
  if (cerrar) await cerrar();
  await limpiar();
  await prisma.stage.deleteMany({ where: { organizationId: taller.id } });
  await prisma.pipeline.deleteMany({ where: { organizationId: taller.id } });
  for (const org of [taller, sinModulo]) await borrarOrgDePrueba(org);
});

test("barrido: el aviso en la ventana, una vez; las exclusiones; antes de las 10 nada", async () => {
  const r = await regla();
  const ana = await cliente();
  const hoy = await vehiculo(ana.id, "2022-10-15"); // aviso: hoy
  const haceSiete = await vehiculo(ana.id, "2022-10-08"); // aviso: hace 7 días
  await vehiculo(ana.id, "2022-10-07"); // hace 8: afuera
  await vehiculo(ana.id, "2022-10-16"); // mañana: afuera
  await vehiculo(ana.id, null); // sin compra
  await vehiculo(ana.id, "2022-10-15", { ownershipEndedAt: AHORA, ownershipEndReason: "OTRO" });
  // Cliente con una oportunidad abierta: ya está comprando.
  const comprando = await cliente({ firstName: "Comprando" });
  await vehiculo(comprando.id, "2022-10-15");
  await oportunidad(comprando.id, "OPEN");
  // Cliente sin interés.
  const sinInteres = await cliente({ firstName: "Sin", noInterestAt: AHORA });
  await vehiculo(sinInteres.id, "2022-10-15");

  // Antes de las 10:00 en Montevideo, nada.
  assert.equal(
    (await barrerRecambios({ ahora: new Date("2026-08-16T12:00:00Z"), organizationId: taller.id }))
      .avisos,
    0,
  );

  const res = await barrerRecambios({ ahora: AHORA, organizationId: taller.id });
  assert.equal(res.avisos, 2);
  const avisos = await prisma.customerVehicleNotice.findMany({
    where: { organizationId: taller.id },
  });
  assert.deepEqual(avisos.map((a) => a.customerVehicleId).sort(), [hoy.id, haceSiete.id].sort());
  for (const a of avisos) {
    assert.equal(a.kind, "REPLACEMENT");
    assert.equal(a.source, "AUTOMATICO");
    assert.equal(a.automationId, r.id);
  }
  const [evento] = (await eventos()).filter(
    (e) => (e.payload as { customerVehicleId: string }).customerVehicleId === hoy.id,
  );
  assert.deepEqual(evento.payload, {
    automationId: r.id,
    noticeId: avisos.find((a) => a.customerVehicleId === hoy.id)!.id,
    customerVehicleId: hoy.id,
    contactId: ana.id,
    branchId: sucursal,
    purchasedOn: "2022-10-15",
    replacementDueOn: "2026-10-15",
  });

  // Una segunda pasada no repite.
  assert.equal((await barrerRecambios({ ahora: AHORA, organizationId: taller.id })).avisos, 0);
});

test("un aviso MANUAL previo para esa fecha de recambio frena el automático", async () => {
  await regla();
  const ana = await cliente();
  const v = await vehiculo(ana.id, "2022-10-15");
  await prisma.customerVehicleNotice.create({
    data: {
      organizationId: taller.id,
      customerVehicleId: v.id,
      kind: "REPLACEMENT",
      dueOn: dia("2026-10-15"),
      source: "MANUAL",
      createdById: taller.authIds[0],
    },
  });
  assert.equal((await barrerRecambios({ ahora: AHORA, organizationId: taller.id })).avisos, 0);
});

test("la tarea: vendedor del contacto → de la venta de origen → responsable → ADMIN más antiguo", async () => {
  await regla();
  const asignadoDe = async (
    contactoExtra: Record<string, unknown>,
    vehiculoExtra: Record<string, unknown>,
  ) => {
    await limpiarAvisos();
    const c = await cliente(contactoExtra);
    const v = await vehiculo(c.id, "2022-10-15", vehiculoExtra);
    await barrerRecambios({ ahora: AHORA, organizationId: taller.id });
    await despachar(await eventos());
    const [tarea] = await prisma.activity.findMany({
      where: { organizationId: taller.id, contactId: c.id, type: "TASK" },
    });
    await prisma.customerVehicle.update({
      where: { id: v.id },
      data: { deletedAt: new Date() },
    });
    return tarea;
  };
  const limpiarAvisos = async () => {
    await prisma.automationExecution.deleteMany({ where: { organizationId: taller.id } });
    await prisma.outboxEvent.deleteMany({ where: { organizationId: taller.id } });
  };

  const t1 = await asignadoDe({ ownerId: taller.authIds[1] }, {});
  assert.equal(t1.assigneeId, taller.authIds[1], "el vendedor del contacto");
  assert.equal(t1.subject, "Llamar por el recambio");
  assert.ok(t1.sourceNoticeId);

  const venta = await oportunidad((await cliente()).id, "WON");
  await prisma.opportunity.update({
    where: { id: venta.id },
    data: { ownerId: taller.authIds[2] },
  });
  const t2 = await asignadoDe({}, { sourceOpportunityId: venta.id });
  assert.equal(t2.assigneeId, taller.authIds[2], "el vendedor de la venta de origen");

  await prisma.branch.update({
    where: { id: sucursal },
    data: { defaultOwnerId: taller.authIds[1] },
  });
  const t3 = await asignadoDe({}, {});
  assert.equal(t3.assigneeId, taller.authIds[1], "el responsable de la sucursal");

  await prisma.branch.update({ where: { id: sucursal }, data: { defaultOwnerId: null } });
  const t4 = await asignadoDe({}, {});
  assert.equal(t4.assigneeId, taller.authIds[0], "el ADMIN más antiguo");
});

test("vencidos sin contactar: los cuatro criterios, de la más vieja a la más nueva", async () => {
  const ana = await cliente({ ownerId: taller.authIds[1] });
  const viejo = await vehiculo(ana.id, "2018-03-01"); // aviso en 2021: vencido
  const menosViejo = await vehiculo(ana.id, "2021-01-10"); // aviso en 2024: vencido
  await vehiculo(ana.id, "2022-10-15"); // aviso hoy: está en la ventana, no vencido
  await vehiculo(ana.id, null); // sin compra
  // Ya avisado (manual) para esa fecha de recambio.
  const avisado = await vehiculo(ana.id, "2019-05-05");
  await prisma.customerVehicleNotice.create({
    data: {
      organizationId: taller.id,
      customerVehicleId: avisado.id,
      kind: "REPLACEMENT",
      dueOn: dia("2023-05-05"),
      source: "MANUAL",
      createdById: taller.authIds[0],
    },
  });
  // Cliente con una oportunidad creada después de la fecha de aviso.
  const conVenta = await cliente({ firstName: "ConVenta" });
  await vehiculo(conVenta.id, "2018-03-01");
  await oportunidad(conVenta.id, "WON", new Date("2025-01-01T12:00:00Z"));
  // Cliente con una oportunidad vieja (antes del aviso): cuenta igual.
  const conVieja = await cliente({ firstName: "ConVieja" });
  const deConVieja = await vehiculo(conVieja.id, "2018-03-01");
  await oportunidad(conVieja.id, "WON", new Date("2018-02-01T12:00:00Z"));

  const r = await listarRecambiosVencidos(taller.id, ADMIN, { page: 1, pageSize: 50 }, AHORA);
  assert.deepEqual(r.data.map((v) => v.id).sort(), [viejo.id, deConVieja.id, menosViejo.id].sort());
  assert.equal(r.data.at(-1)!.id, menosViejo.id, "el más nuevo al final");
  const fila = r.data.find((v) => v.id === viejo.id)!;
  assert.equal(fila.compra, "2018-03-01");
  assert.equal(fila.recambio, "2022-03-01");
  assert.equal(fila.aviso, "2021-12-31");
  assert.equal(fila.cliente, "Ana Prueba");
  assert.match(fila.vehiculo, /^Fiat Uno \(REC \d+\)$/);
  assert.ok(fila.vendedor, "el vendedor del contacto");
  assert.ok(fila.vencidoHace > 1000);
  assert.equal(r.pagination.total, 3);
});

test("las acciones de la lista: tarea al vendedor y contactado, una o varias; el vehículo sale", async () => {
  const ana = await cliente({ ownerId: taller.authIds[1] });
  const a = await vehiculo(ana.id, "2018-03-01");
  const b = await vehiculo(ana.id, "2018-04-01");
  const c = await vehiculo(ana.id, "2018-05-01");

  const tarea = await pedir(taller, "POST", `/api/servicios/vehiculos/${a.id}/avisos`, {
    accion: "TAREA",
  });
  assert.equal(tarea.status, 201, JSON.stringify(tarea.json));
  const [t] = await prisma.activity.findMany({
    where: { organizationId: taller.id, type: "TASK" },
  });
  assert.equal(t.assigneeId, taller.authIds[1]);
  assert.match(
    t.subject,
    /^Contactar a Ana Prueba: se acerca el recambio de su Fiat Uno \(REC \d+\) \(comprado el 01\/03\/2018\)$/,
  );
  const [aviso] = await prisma.customerVehicleNotice.findMany({
    where: { customerVehicleId: a.id },
  });
  assert.equal(aviso.source, "MANUAL");
  assert.equal(aviso.createdById, taller.authIds[0]);

  // Repetir da 409.
  assert.equal(
    (
      await pedir(taller, "POST", `/api/servicios/vehiculos/${a.id}/avisos`, {
        accion: "CONTACTADO",
      })
    ).status,
    409,
  );

  const varios = await pedir(taller, "POST", "/api/servicios/recambios/avisos", {
    vehiculoIds: [b.id, c.id, a.id],
    accion: "CONTACTADO",
  });
  assert.equal(varios.status, 200);
  assert.deepEqual(
    (varios.json as { resultados: { id: string; ok: boolean }[] }).resultados.map((x) => [
      x.id,
      x.ok,
    ]),
    [
      [b.id, true],
      [c.id, true],
      [a.id, false],
    ],
  );
  assert.equal(
    await prisma.activity.count({ where: { organizationId: taller.id, type: "TASK" } }),
    1,
    "contactado no crea tarea",
  );
  const lista = await pedir(taller, "GET", "/api/servicios/recambios?estado=vencidos");
  assert.equal(lista.status, 200);
  assert.equal((lista.json as { pagination: { total: number } }).pagination.total, 0);
});

test("las tarjetas del resumen, el filtro de vehículos sin compra y el 403 sin el módulo", async () => {
  const ana = await cliente();
  await vehiculo(ana.id, "2022-11-01"); // recambio el 01/11/2026: en 90 días
  await vehiculo(ana.id, "2023-03-01"); // 01/03/2027: más de 90
  await vehiculo(ana.id, "2018-03-01"); // vencido sin contactar
  await vehiculo(ana.id, null);
  await vehiculo(ana.id, null);

  const r = await resumenDelTaller(taller.id, ADMIN, undefined, AHORA);
  assert.deepEqual(r.recambiosProximos, { total: 1, sinFechaDeCompra: 2 });
  assert.deepEqual(r.recambiosVencidos, { total: 1 });

  const sin = await pedir(taller, "GET", "/api/servicios/vehiculos?sinFechaDeCompra=true");
  assert.equal(sin.status, 200);
  assert.equal((sin.json as { pagination: { total: number } }).pagination.total, 2);

  for (const ruta of ["/api/servicios/recambios?estado=vencidos"]) {
    assert.equal((await pedir(sinModulo, "GET", ruta)).status, 403);
  }
  assert.equal((await pedir(taller, "GET", "/api/servicios/recambios?estado=otro")).status, 400);
});
