import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { prisma } from "../lib/prisma";
import { createBranch } from "./branch.service";
import { createKnowledgeBaseEntry } from "./knowledgeBaseEntry.service";
import {
  assertAppError,
  borrador,
  capturar,
  completoUsado,
  desmontar,
  fotoSinStorage,
  montar,
  type Escenario,
} from "./vehicle.test-helper";
import { createOpportunity } from "./opportunity.service";
import { createPipeline } from "./pipeline.service";
import { createStage } from "./stage.service";
import { deleteVehicle, updateVehicle } from "./vehicle.service";
import { sincronizarStockConBaseDeConocimiento } from "./vehicleKnowledgeBaseSync.service";

// ---------------------------------------------------------------------------
// La sincronización de stock con la base de conocimiento (§70) contra Postgres
// real: qué se crea, qué se actualiza, qué se da de baja y —sobre todo— qué no
// se toca nunca.
//
// Contra la base de verdad y no con dobles, porque lo que hace correcta a esta
// operación son dos cosas que solo existen en el motor: el UNIQUE
// (organization_id, source_vehicle_id) que la vuelve idempotente, y el soft
// delete que deja la fila ocupando ese par cuando la unidad deja de calificar.
// Un mock de Prisma afirmaría que llamamos a las funciones, no que la segunda
// corrida no duplica nada.
//
// El TEXTO que se escribe —la allowlist de campos, los rótulos, los recortes—
// se prueba aparte y sin base en vehicleKnowledgeBaseSync.service.test.ts.
//
// Organización propia, como todo archivo de integración de este repo: el
// runner corre los archivos en paralelo contra una base compartida.
// ---------------------------------------------------------------------------

let e: Escenario;

before(async () => {
  e = await montar("kbsync");
});

after(async () => {
  // Antes que desmontar: las entradas referencian la sucursal con RESTRICT, y
  // las oportunidades (ítem 152) referencian unidades.
  await prisma.knowledgeBaseEntry.deleteMany({ where: { organizationId: e.organizationId } });
  await prisma.opportunity.deleteMany({ where: { organizationId: e.organizationId } });
  await prisma.stage.deleteMany({ where: { organizationId: e.organizationId } });
  await prisma.pipeline.deleteMany({ where: { organizationId: e.organizationId } });
  await prisma.company.deleteMany({ where: { organizationId: e.organizationId } });
  await desmontar(e);
});

// Deja la organización sin entradas ni unidades para que cada caso empiece de
// cero y los conteos del resumen signifiquen algo.
async function limpiar() {
  const where = { organizationId: e.organizationId };
  await prisma.knowledgeBaseEntry.deleteMany({ where });
  // Ítem 152: los casos nuevos dejan fotos, historial y oportunidades.
  await prisma.opportunity.deleteMany({ where });
  await prisma.vehiclePhoto.deleteMany({ where });
  await prisma.vehicleChangeLog.deleteMany({ where });
  await prisma.vehicle.deleteMany({ where });
}

// Una unidad publicable y disponible. publishOnWebsite se pone por UPDATE
// directo y no por el service a propósito: `assertCompleteForPublish` exige la
// ficha completa y una foto, que es una regla del alta de vehículos y no tiene
// nada que ver con lo que prueba este archivo. A la sincronización solo le
// importa cómo quedó la fila.
async function unidadPublicada(overrides: Record<string, unknown> = {}) {
  const vehiculo = await borrador(e, { make: "Toyota", model: "Corolla", year: 2022 });
  return prisma.vehicle.update({
    where: { id: vehiculo.id },
    data: { publishOnWebsite: true, status: "AVAILABLE", ...overrides },
  });
}

function entradasDe(organizationId: string) {
  return prisma.knowledgeBaseEntry.findMany({
    where: { organizationId },
    orderBy: { createdAt: "asc" },
  });
}

test("una unidad publicada y disponible se crea como entrada, vinculada a la unidad", async () => {
  await limpiar();
  const vehiculo = await unidadPublicada({ priceListUsd: 24_900 });

  const resumen = await sincronizarStockConBaseDeConocimiento(e.organizationId, e.branchId);
  assert.deepEqual(resumen, { creadas: 1, actualizadas: 0, dadasDeBaja: 0 });

  const [entrada] = await entradasDe(e.organizationId);
  assert.equal(entrada.sourceVehicleId, vehiculo.id);
  assert.equal(entrada.branchId, e.branchId);
  assert.equal(entrada.isActive, true);
  assert.equal(entrada.deletedAt, null);
  assert.match(entrada.title, /^Stock: Toyota Corolla 2022 — /);
  assert.match(entrada.content, /^Precio de lista en USD: 24\.900$/m);
});

test("correrla de nuevo sin cambios no duplica y no reescribe nada", async () => {
  await limpiar();
  await unidadPublicada();

  await sincronizarStockConBaseDeConocimiento(e.organizationId, e.branchId);
  const [antes] = await entradasDe(e.organizationId);

  const resumen = await sincronizarStockConBaseDeConocimiento(e.organizationId, e.branchId);
  // Ni creadas ni actualizadas: el texto que el agente lee ya estaba al día, y
  // "0 actualizadas" es la forma de decirlo. El UNIQUE hace imposible el
  // duplicado, pero lo que se afirma acá es que ni siquiera se intentó.
  assert.deepEqual(resumen, { creadas: 0, actualizadas: 0, dadasDeBaja: 0 });

  const despues = await entradasDe(e.organizationId);
  assert.equal(despues.length, 1);
  assert.equal(despues[0].id, antes.id);
  // Sin escritura no hay updatedAt nuevo: no se tocan 200 filas por nada.
  assert.equal(despues[0].updatedAt.getTime(), antes.updatedAt.getTime());
});

test("un cambio en la ficha actualiza la entrada existente, no crea otra", async () => {
  await limpiar();
  const vehiculo = await unidadPublicada({ priceListUsd: 24_900 });
  await sincronizarStockConBaseDeConocimiento(e.organizationId, e.branchId);
  const [antes] = await entradasDe(e.organizationId);

  await prisma.vehicle.update({ where: { id: vehiculo.id }, data: { priceListUsd: 22_500 } });

  const resumen = await sincronizarStockConBaseDeConocimiento(e.organizationId, e.branchId);
  assert.deepEqual(resumen, { creadas: 0, actualizadas: 1, dadasDeBaja: 0 });

  const despues = await entradasDe(e.organizationId);
  assert.equal(despues.length, 1);
  assert.equal(despues[0].id, antes.id);
  assert.match(despues[0].content, /^Precio de lista en USD: 22\.500$/m);
  assert.ok(!despues[0].content.includes("24.900"));
});

test("una unidad vendida se da de baja en la corrida siguiente", async () => {
  await limpiar();
  const vehiculo = await unidadPublicada();
  await sincronizarStockConBaseDeConocimiento(e.organizationId, e.branchId);

  // SOLD sin tocar publishOnWebsite: es exactamente lo que hace
  // setVehicleStatusForOpportunityLink cuando la oportunidad se gana, y el
  // motivo por el que las dos condiciones se chequean por separado.
  await prisma.vehicle.update({ where: { id: vehiculo.id }, data: { status: "SOLD" } });

  const resumen = await sincronizarStockConBaseDeConocimiento(e.organizationId, e.branchId);
  assert.deepEqual(resumen, { creadas: 0, actualizadas: 0, dadasDeBaja: 1 });

  const [entrada] = await entradasDe(e.organizationId);
  assert.ok(entrada.deletedAt !== null, "la entrada tiene que quedar dada de baja");
  // La unidad sigue marcada como publicable: si se mirara solo esa bandera, el
  // agente seguiría ofreciendo un auto ya vendido.
  const despues = await prisma.vehicle.findUniqueOrThrow({ where: { id: vehiculo.id } });
  assert.equal(despues.publishOnWebsite, true);
});

test("una unidad despublicada se da de baja aunque siga disponible", async () => {
  await limpiar();
  const vehiculo = await unidadPublicada();
  await sincronizarStockConBaseDeConocimiento(e.organizationId, e.branchId);

  await prisma.vehicle.update({
    where: { id: vehiculo.id },
    data: { publishOnWebsite: false },
  });

  const resumen = await sincronizarStockConBaseDeConocimiento(e.organizationId, e.branchId);
  assert.deepEqual(resumen, { creadas: 0, actualizadas: 0, dadasDeBaja: 1 });
  const [entrada] = await entradasDe(e.organizationId);
  assert.ok(entrada.deletedAt !== null);
});

test("una unidad que vuelve a calificar revive SU entrada, no crea una segunda", async () => {
  await limpiar();
  const vehiculo = await unidadPublicada();
  await sincronizarStockConBaseDeConocimiento(e.organizationId, e.branchId);
  const [original] = await entradasDe(e.organizationId);

  await prisma.vehicle.update({ where: { id: vehiculo.id }, data: { status: "SOLD" } });
  await sincronizarStockConBaseDeConocimiento(e.organizationId, e.branchId);

  // Vuelve al stock (una venta que se cae).
  await prisma.vehicle.update({ where: { id: vehiculo.id }, data: { status: "AVAILABLE" } });
  const resumen = await sincronizarStockConBaseDeConocimiento(e.organizationId, e.branchId);

  // Para la pantalla la entrada "no estaba", así que se cuenta como creada —
  // pero la fila es la misma de antes, con su id. Insertar otra habría chocado
  // contra el UNIQUE, que no es parcial.
  assert.deepEqual(resumen, { creadas: 1, actualizadas: 0, dadasDeBaja: 0 });
  const entradas = await entradasDe(e.organizationId);
  assert.equal(entradas.length, 1);
  assert.equal(entradas[0].id, original.id);
  assert.equal(entradas[0].deletedAt, null);
});

test("una entrada escrita a mano no se toca, aunque hable del mismo auto", async () => {
  await limpiar();
  const vehiculo = await unidadPublicada();

  // Escrita por la pantalla: sin sourceVehicleId, y con un texto que se parece
  // deliberadamente al que genera la sincronización.
  const aMano = await createKnowledgeBaseEntry(e.organizationId, {
    branchId: e.branchId,
    title: "Stock: Toyota Corolla 2022 — escrita a mano",
    content: "Marca: Toyota\nModelo: Corolla\nAño: 2022",
  });

  await sincronizarStockConBaseDeConocimiento(e.organizationId, e.branchId);
  // Y otra corrida con la unidad ya fuera del stock, que es cuando el paso de
  // bajas recorre las entradas de la sucursal.
  await prisma.vehicle.update({ where: { id: vehiculo.id }, data: { status: "SOLD" } });
  const resumen = await sincronizarStockConBaseDeConocimiento(e.organizationId, e.branchId);

  // La baja es la de la entrada GENERADA, no la escrita a mano.
  assert.equal(resumen.dadasDeBaja, 1);
  const sigue = await prisma.knowledgeBaseEntry.findUniqueOrThrow({ where: { id: aMano.id } });
  assert.equal(sigue.sourceVehicleId, null);
  assert.equal(sigue.deletedAt, null);
  assert.equal(sigue.title, aMano.title);
  assert.equal(sigue.content, aMano.content);
  assert.equal(sigue.updatedAt.getTime(), aMano.updatedAt.getTime());
});

test("solo sincroniza la sucursal pedida", async () => {
  await limpiar();
  const otra = await createBranch(e.organizationId, {
    name: `Sucursal ${randomUUID().slice(0, 8)}`,
    timezone: "America/Montevideo",
  });
  await unidadPublicada();
  const deLaOtra = await borrador(e, { branchId: otra.id });
  await prisma.vehicle.update({
    where: { id: deLaOtra.id },
    data: { publishOnWebsite: true },
  });

  const resumen = await sincronizarStockConBaseDeConocimiento(e.organizationId, e.branchId);
  assert.deepEqual(resumen, { creadas: 1, actualizadas: 0, dadasDeBaja: 0 });

  const entradas = await entradasDe(e.organizationId);
  assert.equal(entradas.length, 1);
  assert.equal(entradas[0].branchId, e.branchId);

  // Limpieza: la sucursal extra tiene que irse antes del after() global.
  await prisma.knowledgeBaseEntry.deleteMany({ where: { organizationId: e.organizationId } });
  await prisma.vehicle.deleteMany({ where: { organizationId: e.organizationId } });
  await prisma.branch.delete({ where: { id: otra.id } });
});

test("una sucursal que no existe o es de otra organización es un 400", async () => {
  const err = await capturar(() =>
    sincronizarStockConBaseDeConocimiento(e.organizationId, randomUUID()),
  );
  assertAppError(err, 400, "La sucursal indicada no existe");
});

// ---------------------------------------------------------------------------
// Ítem 152: la baja NO espera al botón. Toda escritura que saca a una unidad
// de lo que califica da de baja su entrada en la misma transacción. Las altas
// siguen siendo solo de la sincronización.
// ---------------------------------------------------------------------------

// Acá SÍ la ficha completa y con foto: estos casos pasan por updateVehicle,
// que exige estar completa para seguir publicada.
async function sincronizadaYViva() {
  await limpiar();
  const vehiculo = await unidadPublicada({
    ...completoUsado,
    vin: `9BR${randomUUID().replace(/-/g, "").slice(0, 14)}`,
    licensePlate: randomUUID().slice(0, 7),
  });
  await fotoSinStorage(e, vehiculo.id);
  await sincronizarStockConBaseDeConocimiento(e.organizationId, e.branchId);
  const [entrada] = await entradasDe(e.organizationId);
  assert.equal(entrada.deletedAt, null);
  return vehiculo;
}

async function entradaViva(vehicleId: string) {
  const entrada = await prisma.knowledgeBaseEntry.findFirstOrThrow({
    where: { organizationId: e.organizationId, sourceVehicleId: vehicleId },
  });
  return entrada.deletedAt === null;
}

test("ítem 152: PATCH a SOLD, a RESERVED o despublicar da de baja la entrada en el momento", async () => {
  for (const cambio of [
    { status: "SOLD" as const },
    { status: "RESERVED" as const },
    { publishOnWebsite: false },
  ]) {
    const vehiculo = await sincronizadaYViva();
    await updateVehicle(e.organizationId, e.userId, vehiculo.id, cambio);
    assert.equal(await entradaViva(vehiculo.id), false, JSON.stringify(cambio));
  }
});

test("ítem 152: un PATCH que no la saca de lo que califica no toca la entrada", async () => {
  const vehiculo = await sincronizadaYViva();
  await updateVehicle(e.organizationId, e.userId, vehiculo.id, { exteriorColor: "Rojo" });
  assert.equal(await entradaViva(vehiculo.id), true);
});

test("ítem 152: dar de baja la unidad da de baja su entrada", async () => {
  const vehiculo = await sincronizadaYViva();
  await deleteVehicle(e.organizationId, vehiculo.id);
  assert.equal(await entradaViva(vehiculo.id), false);
});

test("ítem 152: vincularla a una oportunidad (RESERVED) la saca de la base en la misma transacción", async () => {
  const vehiculo = await sincronizadaYViva();
  const pipeline = await createPipeline(e.organizationId, { name: `Ventas ${randomUUID()}` });
  const stage = await createStage(e.organizationId, { pipelineId: pipeline.id, name: "Nuevo" });
  const company = await prisma.company.create({
    data: { organizationId: e.organizationId, name: "Cliente" },
  });
  await createOpportunity(e.organizationId, e.userId, {
    title: "Interesado",
    pipelineId: pipeline.id,
    stageId: stage.id,
    companyId: company.id,
    vehicleId: vehiculo.id,
  });
  assert.equal(await entradaViva(vehiculo.id), false);

  // Y la sincronización siguiente no la revive: no califica.
  await sincronizarStockConBaseDeConocimiento(e.organizationId, e.branchId);
  assert.equal(await entradaViva(vehiculo.id), false);
});
