import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { after, before, test } from "node:test";
import { prisma } from "../lib/prisma";
import { createOpportunity, deleteOpportunity } from "./opportunity.service";
import { createPipeline } from "./pipeline.service";
import { createStage } from "./stage.service";
import { getVehicleChangeLog, listVehicles, updateVehicle } from "./vehicle.service";
import {
  assertAppError,
  borrador,
  capturar,
  desmontar,
  montar,
  type Escenario,
} from "./vehicle.test-helper";

// ---------------------------------------------------------------------------
// Permuta (§41) contra Postgres real: el vínculo Vehicle.tradeInOpportunityId.
// Lo que no se puede probar sin base: que la validación de la oportunidad
// (existe, es de esta organización, no está dada de baja) corra dentro de la
// transacción de createVehicle/updateVehicle y revierta el contador, que el
// filtro del listado use la columna real, y que la FK compuesta rechace un
// vínculo cruzado aunque se saltee el service.
//
// Dos organizaciones (vehicle.test-helper), cada una con el
// pipeline/stage/company que Opportunity exige.
// ---------------------------------------------------------------------------

interface ConVentas extends Escenario {
  pipelineId: string;
  stageId: string;
  companyId: string;
}

let a: ConVentas;
let b: ConVentas;

async function montarConVentas(etiqueta: string): Promise<ConVentas> {
  const e = await montar(etiqueta);
  const pipeline = await createPipeline(e.organizationId, { name: "Ventas" });
  const stage = await createStage(e.organizationId, { pipelineId: pipeline.id, name: "Contacto" });
  const company = await prisma.company.create({
    data: { organizationId: e.organizationId, name: "Cliente" },
  });
  return { ...e, pipelineId: pipeline.id, stageId: stage.id, companyId: company.id };
}

before(async () => {
  a = await montarConVentas("tia");
  b = await montarConVentas("tib");
});

after(async () => {
  for (const e of [a, b].filter(Boolean)) {
    // Las unidades referencian oportunidades (FK NO ACTION) desde §41: van
    // antes que las oportunidades, y su historial antes que ellas.
    await prisma.vehicleChangeLog.deleteMany({ where: { organizationId: e.organizationId } });
    await prisma.vehicle.deleteMany({ where: { organizationId: e.organizationId } });
    await prisma.delivery.deleteMany({ where: { organizationId: e.organizationId } });
    await prisma.opportunity.deleteMany({ where: { organizationId: e.organizationId } });
    await prisma.stage.deleteMany({ where: { organizationId: e.organizationId } });
    await prisma.pipeline.deleteMany({ where: { organizationId: e.organizationId } });
    await prisma.company.deleteMany({ where: { organizationId: e.organizationId } });
    await desmontar(e);
  }
});

function venta(e: ConVentas, extra: Record<string, unknown> = {}) {
  return createOpportunity(e.organizationId, e.userId, {
    title: "Venta con permuta",
    pipelineId: e.pipelineId,
    stageId: e.stageId,
    companyId: e.companyId,
    ...extra,
  });
}

const MENSAJE = "tradeInOpportunityId";

async function contador(e: Escenario) {
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: e.organizationId },
    select: { nextVehicleStockNumber: true },
  });
  return org.nextVehicleStockNumber;
}

// ---------------------------------------------------------------------------
// Crear
// ---------------------------------------------------------------------------

test("crear: una unidad TRADE_IN vinculada a una venta ABIERTA se guarda con el vínculo; ganada o perdida también valen", async () => {
  const abierta = await venta(a);
  const recibida = await borrador(a, { origin: "TRADE_IN", tradeInOpportunityId: abierta.id });
  assert.equal(recibida.tradeInOpportunityId, abierta.id);
  assert.equal(recibida.origin, "TRADE_IN");

  const ganada = await venta(a, { status: "WON" });
  const perdida = await venta(a, { status: "LOST", lostReason: "Precio" });
  for (const opp of [ganada, perdida]) {
    const v = await borrador(a, { origin: "TRADE_IN", tradeInOpportunityId: opp.id });
    assert.equal(v.tradeInOpportunityId, opp.id);
  }

  // Sin vínculo, TRADE_IN sigue siendo válido (datos anteriores a §41).
  const suelta = await borrador(a, { origin: "TRADE_IN" });
  assert.equal(suelta.tradeInOpportunityId, null);
});

test("crear: oportunidad inexistente, de otra organización o dada de baja es el mismo 400, y el contador no se quema", async () => {
  const ajena = await venta(b);
  const dadaDeBaja = await venta(a);
  await deleteOpportunity(a.organizationId, a.userId, dadaDeBaja.id);

  const antes = await contador(a);
  for (const id of [randomUUID(), ajena.id, dadaDeBaja.id]) {
    const err = await capturar(() => borrador(a, { origin: "TRADE_IN", tradeInOpportunityId: id }));
    assertAppError(err, 400, MENSAJE);
  }
  assert.equal(await contador(a), antes);
});

// ---------------------------------------------------------------------------
// Editar
// ---------------------------------------------------------------------------

test("editar: vincular queda en el historial; null desvincula; inexistente, ajena o dada de baja es 400 y no escribe", async () => {
  const opp = await venta(a);
  const v = await borrador(a, { origin: "TRADE_IN" });

  const vinculada = await updateVehicle(a.organizationId, a.userId, v.id, {
    tradeInOpportunityId: opp.id,
  });
  assert.equal(vinculada.tradeInOpportunityId, opp.id);
  const log = await getVehicleChangeLog(a.organizationId, v.id, { page: 1, pageSize: 10 });
  const fila = log.data.find((row) => row.fieldName === "tradeInOpportunityId");
  assert.ok(fila, "el vínculo queda en el historial de la ficha");
  assert.equal(fila.oldValue, null);
  assert.equal(fila.newValue, opp.id);

  const ajena = await venta(b);
  const dadaDeBaja = await venta(a);
  await deleteOpportunity(a.organizationId, a.userId, dadaDeBaja.id);
  for (const id of [randomUUID(), ajena.id, dadaDeBaja.id]) {
    const err = await capturar(() =>
      updateVehicle(a.organizationId, a.userId, v.id, { tradeInOpportunityId: id, mileage: 9 }),
    );
    assertAppError(err, 400, MENSAJE);
  }
  const intacta = await prisma.vehicle.findUniqueOrThrow({ where: { id: v.id } });
  assert.equal(intacta.tradeInOpportunityId, opp.id);
  assert.equal(intacta.mileage, null);

  const desvinculada = await updateVehicle(a.organizationId, a.userId, v.id, {
    tradeInOpportunityId: null,
  });
  assert.equal(desvinculada.tradeInOpportunityId, null);
});

test("editar: la venta se da de baja DESPUÉS de cargar la permuta — la unidad queda en stock con su vínculo y se sigue pudiendo editar", async () => {
  const opp = await venta(a);
  const v = await borrador(a, { origin: "TRADE_IN", tradeInOpportunityId: opp.id });
  await deleteOpportunity(a.organizationId, a.userId, opp.id);

  // Un PATCH que no toca el vínculo no lo revalida.
  const editada = await updateVehicle(a.organizationId, a.userId, v.id, { mileage: 80_000 });
  assert.equal(editada.mileage, 80_000);
  assert.equal(editada.tradeInOpportunityId, opp.id);
  assert.equal(editada.deletedAt, null);
});

test("editar: cambiar el origen no vacía el vínculo (no hay regla como la de consignación)", async () => {
  const opp = await venta(a);
  const v = await borrador(a, { origin: "TRADE_IN", tradeInOpportunityId: opp.id });
  const editada = await updateVehicle(a.organizationId, a.userId, v.id, {
    origin: "DIRECT_PURCHASE",
  });
  assert.equal(editada.origin, "DIRECT_PURCHASE");
  assert.equal(editada.tradeInOpportunityId, opp.id);
});

// ---------------------------------------------------------------------------
// Listar
// ---------------------------------------------------------------------------

test("listar: ?tradeInOpportunityId devuelve las unidades recibidas en ESA venta (cero, una o varias), nunca de otra organización ni dadas de baja", async () => {
  const base = { page: 1, pageSize: 20, sortBy: "createdAt" as const, sortOrder: "asc" as const };
  const opp = await venta(a);
  const otra = await venta(a);

  const vacia = await listVehicles(a.organizationId, { ...base, tradeInOpportunityId: opp.id });
  assert.equal(vacia.pagination.total, 0);

  const primera = await borrador(a, { origin: "TRADE_IN", tradeInOpportunityId: opp.id });
  const segunda = await borrador(a, { origin: "TRADE_IN", tradeInOpportunityId: opp.id });
  await borrador(a, { origin: "TRADE_IN", tradeInOpportunityId: otra.id });
  await borrador(a, { origin: "TRADE_IN" });
  const baja = await borrador(a, { origin: "TRADE_IN", tradeInOpportunityId: opp.id });
  await prisma.vehicle.update({ where: { id: baja.id }, data: { deletedAt: new Date() } });

  const dos = await listVehicles(a.organizationId, { ...base, tradeInOpportunityId: opp.id });
  assert.deepEqual(
    dos.data.map((v) => v.id),
    [primera.id, segunda.id],
  );

  // Desde otra organización, el mismo id no devuelve nada.
  const desdeB = await listVehicles(b.organizationId, { ...base, tradeInOpportunityId: opp.id });
  assert.equal(desdeB.pagination.total, 0);
});

// ---------------------------------------------------------------------------
// Aislamiento en la base: la escritura nueva no tiene función de repository
// propia (pasa por createVehicle/updateVehicle del repository, cuyo WHERE ya
// prueba tenant-isolation.integration-test.ts), así que lo que queda por
// probar es la constraint. Mismo molde que "ApiKey de Organization A
// apuntando a una Source de Organization B: la base la rechaza".
// ---------------------------------------------------------------------------

test("FK compuesta: una unidad de Organization A apuntando a una venta de Organization B la rechaza la base, aunque se saltee el service", async () => {
  const ajena = await venta(b);
  const propia = await venta(a);
  const v = await borrador(a, { origin: "TRADE_IN" });

  await assert.rejects(
    () => prisma.vehicle.update({ where: { id: v.id }, data: { tradeInOpportunityId: ajena.id } }),
    (err: unknown) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003",
  );

  const ok = await prisma.vehicle.update({
    where: { id: v.id },
    data: { tradeInOpportunityId: propia.id },
  });
  assert.equal(ok.tradeInOpportunityId, propia.id);
});
