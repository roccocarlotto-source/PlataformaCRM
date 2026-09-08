import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { prisma } from "../lib/prisma";
import { findVehicleById } from "../repositories/vehicle.repository";
import {
  createOpportunity,
  deleteOpportunity,
  UNIDAD_NO_DISPONIBLE,
  updateOpportunity,
} from "./opportunity.service";
import { createPipeline } from "./pipeline.service";
import { createStage } from "./stage.service";
import { getVehicleChangeLog, updateVehicle } from "./vehicle.service";
import {
  assertAppError,
  borrador,
  capturar,
  desmontar,
  montar,
  type Escenario,
} from "./vehicle.test-helper";

// ---------------------------------------------------------------------------
// Vínculo Vehicle ↔ Opportunity contra Postgres real (Fase 2c). Lo que no se
// puede probar sin base: que el estado de la unidad se mueva de verdad con
// el vínculo y quede en su historial, que la exclusión aguante dos
// oportunidades a la vez (el lock de organización), y que un estado tocado a
// mano no se pise.
//
// Las reglas puras (qué estado, qué precio) están en
// opportunity.service.test.ts. Una organización con su sucursal y su ADMIN
// (vehicle.test-helper), más el pipeline/stage/company que Opportunity exige.
// ---------------------------------------------------------------------------

let e: Escenario;
let pipelineId: string;
let stageId: string;
let companyId: string;

before(async () => {
  e = await montar("opp");
  const pipeline = await createPipeline(e.organizationId, { name: "Ventas" });
  const stage = await createStage(e.organizationId, { pipelineId: pipeline.id, name: "Contacto" });
  const company = await prisma.company.create({
    data: { organizationId: e.organizationId, name: "Cliente" },
  });
  pipelineId = pipeline.id;
  stageId = stage.id;
  companyId = company.id;
  await prisma.organization.update({
    where: { id: e.organizationId },
    data: { preferredCurrency: "ARS" },
  });
});

after(async () => {
  if (!e) return;
  // Las oportunidades referencian unidades (FK NO ACTION): van primero.
  await prisma.opportunity.deleteMany({ where: { organizationId: e.organizationId } });
  await prisma.stage.deleteMany({ where: { organizationId: e.organizationId } });
  await prisma.pipeline.deleteMany({ where: { organizationId: e.organizationId } });
  await prisma.company.deleteMany({ where: { organizationId: e.organizationId } });
  await desmontar(e);
});

function oportunidad(extra: Record<string, unknown> = {}) {
  return createOpportunity(e.organizationId, e.userId, {
    title: "Interesado",
    pipelineId,
    stageId,
    companyId,
    ...extra,
  });
}

async function estadoDe(vehicleId: string) {
  const vehicle = await findVehicleById(vehicleId, e.organizationId);
  assert.ok(vehicle);
  return vehicle.status;
}

// ---------------------------------------------------------------------------
// Vincular
// ---------------------------------------------------------------------------

test("crear vinculada: la unidad AVAILABLE queda RESERVED, la oportunidad toma precio y moneda, y el cambio va al historial", async () => {
  const vehicle = await borrador(e, { priceListUsd: 25_000 });

  const opp = await oportunidad({ vehicleId: vehicle.id, financingType: "OWN_FINANCING" });

  assert.equal(opp.vehicleId, vehicle.id);
  assert.equal(opp.financingType, "OWN_FINANCING");
  assert.equal(Number(opp.amount), 25_000);
  assert.equal(opp.currency, "USD");
  assert.equal(await estadoDe(vehicle.id), "RESERVED");

  const log = await getVehicleChangeLog(e.organizationId, vehicle.id, { page: 1, pageSize: 10 });
  const cambio = log.data.find((row) => row.fieldName === "status");
  assert.ok(cambio, "el cambio de estado por el vínculo está en el historial");
  assert.equal(cambio.oldValue, "AVAILABLE");
  assert.equal(cambio.newValue, "RESERVED");
  assert.equal(cambio.changedById, e.userId);
});

test("crear vinculada: el body explícito gana sobre el precio de la unidad; solo precio local → moneda de preferencia", async () => {
  const vehicle = await borrador(e, { priceListUsd: 25_000 });
  const explicita = await oportunidad({ vehicleId: vehicle.id, amount: 24_000, currency: "EUR" });
  assert.equal(Number(explicita.amount), 24_000);
  assert.equal(explicita.currency, "EUR");

  const local = await borrador(e, { priceListLocal: 30_000_000 });
  const enPesos = await oportunidad({ vehicleId: local.id });
  assert.equal(Number(enPesos.amount), 30_000_000);
  assert.equal(enPesos.currency, "ARS");
});

test("exclusión: una segunda oportunidad sobre una unidad ya reservada es 409, y la primera no se pisa", async () => {
  const vehicle = await borrador(e);
  const primera = await oportunidad({ vehicleId: vehicle.id });

  const err = await capturar(() => oportunidad({ vehicleId: vehicle.id }));
  assertAppError(err, 409, UNIDAD_NO_DISPONIBLE);

  const vinculadas = await prisma.opportunity.findMany({
    where: { organizationId: e.organizationId, vehicleId: vehicle.id, deletedAt: null },
  });
  assert.deepEqual(
    vinculadas.map((o) => o.id),
    [primera.id],
  );
  assert.equal(await estadoDe(vehicle.id), "RESERVED");
});

test("exclusión en carrera: dos oportunidades creándose A LA VEZ sobre la misma unidad — exactamente una gana", async () => {
  const vehicle = await borrador(e);

  const resultados = await Promise.allSettled([
    oportunidad({ vehicleId: vehicle.id, title: "A" }),
    oportunidad({ vehicleId: vehicle.id, title: "B" }),
  ]);

  const ganadoras = resultados.filter((r) => r.status === "fulfilled");
  const perdedoras = resultados.filter((r) => r.status === "rejected");
  assert.equal(ganadoras.length, 1, "exactamente una oportunidad se creó");
  assert.equal(perdedoras.length, 1);
  assertAppError((perdedoras[0] as PromiseRejectedResult).reason, 409, UNIDAD_NO_DISPONIBLE);

  const vinculadas = await prisma.opportunity.count({
    where: { organizationId: e.organizationId, vehicleId: vehicle.id, deletedAt: null },
  });
  assert.equal(vinculadas, 1);
  assert.equal(await estadoDe(vehicle.id), "RESERVED");
});

test("una unidad ajena o dada de baja es 400 sin confirmar que exista", async () => {
  const otra = await montar("opp-b");
  try {
    const ajena = await borrador(otra);
    const opp = await oportunidad();

    const porAjena = await capturar(() =>
      updateOpportunity(e.organizationId, e.userId, opp.id, { vehicleId: ajena.id }),
    );
    assertAppError(porAjena, 400, "El vehicleId indicado no existe");
    const intacta = await prisma.vehicle.findUniqueOrThrow({ where: { id: ajena.id } });
    assert.equal(intacta.status, "AVAILABLE");

    const dadaDeBaja = await borrador(e);
    await prisma.vehicle.update({ where: { id: dadaDeBaja.id }, data: { deletedAt: new Date() } });
    const porBaja = await capturar(() => oportunidad({ vehicleId: dadaDeBaja.id }));
    assertAppError(porBaja, 400, "El vehicleId indicado no existe");
  } finally {
    await desmontar(otra);
  }
});

// ---------------------------------------------------------------------------
// Estado de la oportunidad → estado de la unidad
// ---------------------------------------------------------------------------

test("WON deja la unidad SOLD; volver a OPEN la reserva de nuevo, no la libera; LOST la libera", async () => {
  const vehicle = await borrador(e);
  const opp = await oportunidad({ vehicleId: vehicle.id });

  await updateOpportunity(e.organizationId, e.userId, opp.id, { status: "WON" });
  assert.equal(await estadoDe(vehicle.id), "SOLD");

  // Reabrir no "revierte" nada hacia AVAILABLE: la oportunidad vuelve a
  // estar abierta sobre la misma unidad, y la unidad vuelve a estar
  // reservada por ella — la única regla es "estado de la oportunidad →
  // estado de la unidad", sin casos especiales.
  await updateOpportunity(e.organizationId, e.userId, opp.id, { status: "OPEN" });
  assert.equal(await estadoDe(vehicle.id), "RESERVED");

  await updateOpportunity(e.organizationId, e.userId, opp.id, { status: "LOST" });
  assert.equal(await estadoDe(vehicle.id), "AVAILABLE");

  // Y el historial de la ficha tiene los cuatro movimientos, con quién los hizo.
  const log = await getVehicleChangeLog(e.organizationId, vehicle.id, { page: 1, pageSize: 10 });
  assert.deepEqual(
    log.data.filter((row) => row.fieldName === "status").map((row) => row.newValue),
    ["AVAILABLE", "RESERVED", "SOLD", "RESERVED"],
  );
});

test("un PATCH sin tocar unidad ni estado no sincroniza nada (camino sin transacción)", async () => {
  const vehicle = await borrador(e);
  const opp = await oportunidad({ vehicleId: vehicle.id });
  await updateVehicle(e.organizationId, e.userId, vehicle.id, { status: "IN_PREPARATION" });

  const actualizada = await updateOpportunity(e.organizationId, e.userId, opp.id, {
    title: "Renombrada",
  });
  assert.equal(actualizada.title, "Renombrada");
  assert.equal(actualizada.vehicleId, vehicle.id);
  assert.equal(await estadoDe(vehicle.id), "IN_PREPARATION");
});

// ---------------------------------------------------------------------------
// Desvincular, reemplazar, borrar
// ---------------------------------------------------------------------------

test("desvincular (vehicleId: null) libera la unidad si sigue RESERVED", async () => {
  const vehicle = await borrador(e);
  const opp = await oportunidad({ vehicleId: vehicle.id });
  assert.equal(await estadoDe(vehicle.id), "RESERVED");

  const actualizada = await updateOpportunity(e.organizationId, e.userId, opp.id, {
    vehicleId: null,
  });
  assert.equal(actualizada.vehicleId, null);
  assert.equal(await estadoDe(vehicle.id), "AVAILABLE");

  // Liberada, otra oportunidad puede tomarla.
  const segunda = await oportunidad({ vehicleId: vehicle.id });
  assert.equal(segunda.vehicleId, vehicle.id);
  assert.equal(await estadoDe(vehicle.id), "RESERVED");
});

test("desvincular NO pisa un estado tocado a mano (IN_PREPARATION desde el PATCH de /vehicles/:id)", async () => {
  const vehicle = await borrador(e);
  const opp = await oportunidad({ vehicleId: vehicle.id });
  await updateVehicle(e.organizationId, e.userId, vehicle.id, { status: "IN_PREPARATION" });

  await updateOpportunity(e.organizationId, e.userId, opp.id, { vehicleId: null });
  assert.equal(await estadoDe(vehicle.id), "IN_PREPARATION");
});

test("reemplazar la unidad: libera la anterior, reserva la nueva y toma su precio si el body no trae monto", async () => {
  const primera = await borrador(e, { priceListUsd: 10_000 });
  const segunda = await borrador(e, { priceListUsd: 20_000 });
  const opp = await oportunidad({ vehicleId: primera.id });
  assert.equal(Number(opp.amount), 10_000);

  const actualizada = await updateOpportunity(e.organizationId, e.userId, opp.id, {
    vehicleId: segunda.id,
  });
  assert.equal(actualizada.vehicleId, segunda.id);
  assert.equal(Number(actualizada.amount), 20_000);
  assert.equal(actualizada.currency, "USD");
  assert.equal(await estadoDe(primera.id), "AVAILABLE");
  assert.equal(await estadoDe(segunda.id), "RESERVED");
});

test("reemplazar por una unidad no disponible es 409 y no cambia nada", async () => {
  const mia = await borrador(e);
  const ocupada = await borrador(e);
  const opp = await oportunidad({ vehicleId: mia.id });
  await oportunidad({ vehicleId: ocupada.id });

  const err = await capturar(() =>
    updateOpportunity(e.organizationId, e.userId, opp.id, { vehicleId: ocupada.id }),
  );
  assertAppError(err, 409, UNIDAD_NO_DISPONIBLE);

  const sinCambios = await prisma.opportunity.findUniqueOrThrow({ where: { id: opp.id } });
  assert.equal(sinCambios.vehicleId, mia.id);
  // La transacción entera se revirtió: la anterior sigue reservada.
  assert.equal(await estadoDe(mia.id), "RESERVED");
  assert.equal(await estadoDe(ocupada.id), "RESERVED");
});

test("borrar una oportunidad libera la unidad si sigue RESERVED, y no la toca si ya está SOLD", async () => {
  const reservada = await borrador(e);
  const opp1 = await oportunidad({ vehicleId: reservada.id });
  await deleteOpportunity(e.organizationId, e.userId, opp1.id);
  assert.equal(await estadoDe(reservada.id), "AVAILABLE");

  const vendida = await borrador(e);
  const opp2 = await oportunidad({ vehicleId: vendida.id, status: "WON" });
  assert.equal(await estadoDe(vendida.id), "SOLD");
  await deleteOpportunity(e.organizationId, e.userId, opp2.id);
  assert.equal(await estadoDe(vendida.id), "SOLD");

  const borradas = await prisma.opportunity.findMany({
    where: { id: { in: [opp1.id, opp2.id] } },
  });
  assert.ok(borradas.every((o) => o.deletedAt !== null));
});
