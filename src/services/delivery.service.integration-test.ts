import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Prisma } from "@prisma/client";
import { esperarBloqueadoPor, sostenerTransaccion } from "../lib/carreras.test-helper";
import { prisma } from "../lib/prisma";
import { lockOrganizationForUpdate } from "../repositories/organization.repository";
import {
  confirmDelivery,
  createDeliveryForSoldVehicle,
  ENTREGA_CONFIRMADA_INMUTABLE,
  ENTREGA_YA_CONFIRMADA,
  ENTREGA_CONFIRMADA_BLOQUEA_CAMBIOS,
  getDeliveryById,
  listDeliveriesByOpportunity,
  UNIDAD_NO_VENDIDA,
  updateDelivery,
} from "./delivery.service";
import { createOpportunity, deleteOpportunity, updateOpportunity } from "./opportunity.service";
import { createPipeline } from "./pipeline.service";
import { createStage } from "./stage.service";
import { getVehicleChangeLog, setVehicleStatusForOpportunityLink } from "./vehicle.service";
import {
  assertAppError,
  borrador,
  capturar,
  desmontar,
  montar,
  type Escenario,
} from "./vehicle.test-helper";

// ---------------------------------------------------------------------------
// Entrega contra Postgres real (§40 de docs/frontend-cambios-pendientes.md).
// Lo que no se puede probar sin base: que la entrega nazca de verdad en la
// misma transacción que deja la unidad SOLD —desde createOpportunity y desde
// updateOpportunity—, que "Confirmar entrega" mueva la unidad a DELIVERED con
// su historial, que las escrituras condicionadas no pisen una entrega ya
// confirmada, las carreras contra el lock de organización y el aislamiento
// entre organizaciones (service y FKs compuestas). Las reglas puras están en
// delivery.service.test.ts; el WHERE de cada escritura del repository, en
// tenant-isolation.integration-test.ts.
//
// Dos organizaciones con sucursal y ADMIN reales (vehicle.test-helper): A es
// la de trabajo, B solo existe para los casos cross-tenant.
// ---------------------------------------------------------------------------

let a: Escenario;
let b: Escenario;
let pipelineId: string;
let stageId: string;
let companyId: string;

before(async () => {
  a = await montar("delivery-a");
  b = await montar("delivery-b");

  const pipeline = await createPipeline(a.organizationId, { name: "Ventas" });
  const stage = await createStage(a.organizationId, { pipelineId: pipeline.id, name: "Contacto" });
  const company = await prisma.company.create({
    data: { organizationId: a.organizationId, name: "Cliente" },
  });
  pipelineId = pipeline.id;
  stageId = stage.id;
  companyId = company.id;
});

after(async () => {
  for (const e of [a, b]) {
    if (!e) continue;
    const where = { organizationId: e.organizationId };
    // Las entregas referencian oportunidad, unidad y usuario (RESTRICT / NO
    // ACTION): van primero, antes que desmontar borre unidades y usuarios.
    await prisma.delivery.deleteMany({ where });
    await prisma.opportunity.deleteMany({ where });
    await prisma.stage.deleteMany({ where });
    await prisma.pipeline.deleteMany({ where });
    await prisma.company.deleteMany({ where });
  }
  const escenarios = [a, b].filter(Boolean);
  if (escenarios.length > 0) await desmontar(...escenarios);
});

function oportunidad(extra: Record<string, unknown> = {}) {
  return createOpportunity(a.organizationId, a.userId, {
    title: "Interesado",
    pipelineId,
    stageId,
    companyId,
    ...extra,
  });
}

// Una oportunidad ganada con su unidad, y la entrega que nació con ella.
async function ganadaConUnidad() {
  const vehicle = await borrador(a);
  const opp = await oportunidad({ vehicleId: vehicle.id, status: "WON" });
  const delivery = await prisma.delivery.findFirstOrThrow({ where: { opportunityId: opp.id } });
  return { vehicle, opp, delivery };
}

async function estadoDeUnidad(vehicleId: string) {
  const vehicle = await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicleId } });
  return vehicle.status;
}

function entregasDe(opportunityId: string) {
  return prisma.delivery.findMany({ where: { opportunityId } });
}

// ---------------------------------------------------------------------------
// Creación automática
// ---------------------------------------------------------------------------

test("createOpportunity ya ganada con unidad: la unidad queda SOLD y nace la entrega PENDING con el checklist default", async () => {
  const { vehicle, opp, delivery } = await ganadaConUnidad();

  assert.equal(await estadoDeUnidad(vehicle.id), "SOLD");
  assert.equal(delivery.organizationId, a.organizationId);
  assert.equal(delivery.opportunityId, opp.id);
  assert.equal(delivery.vehicleId, vehicle.id);
  assert.equal(delivery.status, "PENDING");
  assert.equal(delivery.deliveredAt, null);
  assert.equal(delivery.deliveredById, null);
  assert.equal(delivery.scheduledAt, null);
  assert.deepEqual(delivery.checklist, [
    { label: "Documentación de transferencia", checked: false },
    { label: "Manual del vehículo", checked: false },
    { label: "Llave de repuesto", checked: false },
    { label: "Kit de herramientas / gato", checked: false },
    { label: "Service al día", checked: false },
  ]);
});

test("sin entrega: ganada sin unidad, o abierta con unidad", async () => {
  const sinUnidad = await oportunidad({ status: "WON" });
  assert.equal((await entregasDe(sinUnidad.id)).length, 0);

  const abierta = await oportunidad({ vehicleId: (await borrador(a)).id });
  assert.equal((await entregasDe(abierta.id)).length, 0);
});

test("updateOpportunity OPEN -> WON con unidad: la entrega nace junto con el SOLD", async () => {
  const vehicle = await borrador(a);
  const opp = await oportunidad({ vehicleId: vehicle.id });
  assert.equal((await entregasDe(opp.id)).length, 0);

  await updateOpportunity(a.organizationId, a.userId, opp.id, { status: "WON" });

  assert.equal(await estadoDeUnidad(vehicle.id), "SOLD");
  const entregas = await entregasDe(opp.id);
  assert.equal(entregas.length, 1);
  assert.equal(entregas[0].vehicleId, vehicle.id);
  assert.equal(entregas[0].status, "PENDING");
});

test("vincular una unidad a una oportunidad ya ganada sin unidad: la unidad pasa a SOLD y nace la entrega", async () => {
  const opp = await oportunidad({ status: "WON" });
  const vehicle = await borrador(a);

  await updateOpportunity(a.organizationId, a.userId, opp.id, { vehicleId: vehicle.id });

  assert.equal(await estadoDeUnidad(vehicle.id), "SOLD");
  const entregas = await entregasDe(opp.id);
  assert.equal(entregas.length, 1);
  assert.equal(entregas[0].vehicleId, vehicle.id);
});

test("PATCH que no produce la transición (status WON sobre una ganada, o sin tocar estado): no crea otra entrega ni falla", async () => {
  const { opp } = await ganadaConUnidad();

  await updateOpportunity(a.organizationId, a.userId, opp.id, { status: "WON" });
  await updateOpportunity(a.organizationId, a.userId, opp.id, { title: "Renombrada" });

  assert.equal((await entregasDe(opp.id)).length, 1);
});

// Límite conocido (§40, fuera de alcance): la reversión de una ganada. Volver
// a ganarla choca con el UNIQUE de la entrega. Lo que este test fija es que
// el choque es un 409 legible y que es ATÓMICO con el resto del PATCH: ni la
// oportunidad queda ganada, ni la unidad vendida, ni sale el evento
// opportunity.won — la entrega vive en la misma transacción que todo eso.
test("volver a ganar una oportunidad revertida: reusa la entrega PENDING (ítem 151), con lo que ya se había cargado", async () => {
  const { vehicle, opp, delivery } = await ganadaConUnidad();
  await updateDelivery(a.organizationId, delivery.id, {
    checklist: [{ label: "Documentación de transferencia", checked: true }],
  });
  await updateOpportunity(a.organizationId, a.userId, opp.id, { status: "OPEN" });
  assert.equal(await estadoDeUnidad(vehicle.id), "RESERVED");

  const ganada = await updateOpportunity(a.organizationId, a.userId, opp.id, { status: "WON" });

  assert.equal(ganada.status, "WON");
  assert.equal(await estadoDeUnidad(vehicle.id), "SOLD");
  const entregas = await entregasDe(opp.id);
  assert.equal(entregas.length, 1);
  assert.equal(entregas[0].id, delivery.id);
  assert.equal(entregas[0].status, "PENDING");
  assert.deepEqual(entregas[0].checklist, [
    { label: "Documentación de transferencia", checked: true },
  ]);
  // Y se puede confirmar: la unidad volvió a SOLD.
  const confirmada = await confirmDelivery(a.organizationId, a.userId, delivery.id);
  assert.equal(confirmada.status, "DELIVERED");
});

test("volver a ganar con OTRA unidad: la entrega PENDING se reasigna a la unidad nueva (ítem 151)", async () => {
  const { vehicle, opp, delivery } = await ganadaConUnidad();
  await updateOpportunity(a.organizationId, a.userId, opp.id, { status: "OPEN" });
  const otra = await borrador(a);

  await updateOpportunity(a.organizationId, a.userId, opp.id, {
    status: "WON",
    vehicleId: otra.id,
  });

  assert.equal(await estadoDeUnidad(vehicle.id), "AVAILABLE");
  assert.equal(await estadoDeUnidad(otra.id), "SOLD");
  const entregas = await entregasDe(opp.id);
  assert.equal(entregas.length, 1);
  assert.equal(entregas[0].id, delivery.id);
  assert.equal(entregas[0].vehicleId, otra.id);
});

test("entrega confirmada: la oportunidad no puede pasar a LOST ni a OPEN ni cambiar de unidad — 409 y nada se mueve (ítem 151)", async () => {
  const { vehicle, opp, delivery } = await ganadaConUnidad();
  await confirmDelivery(a.organizationId, a.userId, delivery.id);
  const otra = await borrador(a);

  for (const cambio of [
    { status: "LOST" as const },
    { status: "OPEN" as const },
    { vehicleId: otra.id },
    { vehicleId: null },
  ]) {
    assertAppError(
      await capturar(() => updateOpportunity(a.organizationId, a.userId, opp.id, cambio)),
      409,
      ENTREGA_CONFIRMADA_BLOQUEA_CAMBIOS,
    );
  }

  const releida = await prisma.opportunity.findUniqueOrThrow({ where: { id: opp.id } });
  assert.equal(releida.status, "WON");
  assert.equal(releida.vehicleId, vehicle.id);
  assert.equal(await estadoDeUnidad(vehicle.id), "DELIVERED");
  assert.equal(await estadoDeUnidad(otra.id), "AVAILABLE");

  // Lo que no toca ni el estado ni la unidad sigue permitido.
  const editada = await updateOpportunity(a.organizationId, a.userId, opp.id, {
    title: "Entregada",
  });
  assert.equal(editada.title, "Entregada");
});

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

test("listar por oportunidad: 0 o 1, con quién confirmó y la unidad; 404 si la oportunidad no existe", async () => {
  const abierta = await oportunidad();
  assert.deepEqual(await listDeliveriesByOpportunity(a.organizationId, abierta.id), { data: [] });

  const { vehicle, opp, delivery } = await ganadaConUnidad();
  const lista = await listDeliveriesByOpportunity(a.organizationId, opp.id);
  assert.equal(lista.data.length, 1);
  assert.equal(lista.data[0].id, delivery.id);
  assert.equal(lista.data[0].vehicle?.id, vehicle.id);
  assert.equal(lista.data[0].vehicle?.status, "SOLD");
  assert.equal(lista.data[0].deliveredBy, null);

  const err = await capturar(() =>
    listDeliveriesByOpportunity(a.organizationId, "00000000-0000-4000-8000-000000000000"),
  );
  assertAppError(err, 404, "Oportunidad no encontrada");
});

test("oportunidad eliminada: su entrega deja de ser alcanzable (404) por listado, id, edición y confirmación", async () => {
  const { opp, delivery } = await ganadaConUnidad();
  await deleteOpportunity(a.organizationId, a.userId, opp.id);

  for (const fn of [
    () => listDeliveriesByOpportunity(a.organizationId, opp.id),
    () => getDeliveryById(a.organizationId, delivery.id),
    () => updateDelivery(a.organizationId, delivery.id, { scheduledAt: null }),
    () => confirmDelivery(a.organizationId, a.userId, delivery.id),
  ]) {
    const err = await capturar(fn);
    assert.ok(err instanceof Error);
    assert.equal((err as { statusCode?: number }).statusCode, 404);
  }
  const intacta = await prisma.delivery.findUniqueOrThrow({ where: { id: delivery.id } });
  assert.equal(intacta.status, "PENDING");
});

// ---------------------------------------------------------------------------
// Edición mientras está PENDING
// ---------------------------------------------------------------------------

test("editar: tildar, agregar y quitar ítems y fijar/limpiar la fecha, solo sobre ESTA entrega", async () => {
  const una = await ganadaConUnidad();
  const otra = await ganadaConUnidad();

  const editada = await updateDelivery(a.organizationId, una.delivery.id, {
    checklist: [
      { label: "Documentación de transferencia", checked: true },
      { label: "Llave de repuesto", checked: false },
      { label: "Patente provisoria", checked: true },
    ],
    scheduledAt: new Date("2026-09-30T00:00:00.000Z"),
  });
  assert.deepEqual(editada.checklist, [
    { label: "Documentación de transferencia", checked: true },
    { label: "Llave de repuesto", checked: false },
    { label: "Patente provisoria", checked: true },
  ]);
  assert.equal(editada.scheduledAt?.toISOString(), "2026-09-30T00:00:00.000Z");
  assert.equal(editada.status, "PENDING");

  const sinFecha = await updateDelivery(a.organizationId, una.delivery.id, { scheduledAt: null });
  assert.equal(sinFecha.scheduledAt, null);
  // Mandar solo la fecha no toca el checklist.
  assert.equal((sinFecha.checklist as unknown[]).length, 3);

  const intacta = await prisma.delivery.findUniqueOrThrow({ where: { id: otra.delivery.id } });
  assert.equal((intacta.checklist as unknown[]).length, 5);
});

// ---------------------------------------------------------------------------
// Confirmar entrega
// ---------------------------------------------------------------------------

test("confirmar con ítems sin tildar: DELIVERED con quién y cuándo, la unidad pasa a DELIVERED y va al historial", async () => {
  const { vehicle, delivery } = await ganadaConUnidad();
  const antes = new Date();

  const confirmada = await confirmDelivery(a.organizationId, a.userId, delivery.id);

  assert.equal(confirmada.status, "DELIVERED");
  assert.equal(confirmada.deliveredById, a.userId);
  assert.equal(confirmada.deliveredBy?.id, a.userId);
  assert.ok(confirmada.deliveredAt && confirmada.deliveredAt >= new Date(antes.getTime() - 1000));
  // El checklist es informativo: sigue todo sin tildar y se confirmó igual.
  assert.ok((confirmada.checklist as { checked: boolean }[]).every((item) => !item.checked));
  assert.equal(await estadoDeUnidad(vehicle.id), "DELIVERED");

  const log = await getVehicleChangeLog(a.organizationId, vehicle.id, { page: 1, pageSize: 10 });
  const ultimo = log.data.find((row) => row.fieldName === "status");
  assert.equal(ultimo?.oldValue, "SOLD");
  assert.equal(ultimo?.newValue, "DELIVERED");
  assert.equal(ultimo?.changedById, a.userId);
});

test("una entrega confirmada es inmutable: confirmar otra vez y editar son 409 y no cambia nada", async () => {
  const { delivery } = await ganadaConUnidad();
  const confirmada = await confirmDelivery(a.organizationId, a.userId, delivery.id);

  const otraVez = await capturar(() => confirmDelivery(a.organizationId, a.userId, delivery.id));
  assertAppError(otraVez, 409, ENTREGA_YA_CONFIRMADA);

  const editar = await capturar(() =>
    updateDelivery(a.organizationId, delivery.id, {
      checklist: [{ label: "Otra cosa", checked: true }],
    }),
  );
  assertAppError(editar, 409, ENTREGA_CONFIRMADA_INMUTABLE);

  const releida = await prisma.delivery.findUniqueOrThrow({ where: { id: delivery.id } });
  assert.deepEqual(releida.checklist, confirmada.checklist);
  assert.equal(releida.deliveredAt?.toISOString(), confirmada.deliveredAt?.toISOString());
});

test("confirmar con la oportunidad revertida (unidad RESERVED o AVAILABLE): 409 y ni la entrega ni la unidad cambian", async () => {
  const reabierta = await ganadaConUnidad();
  await updateOpportunity(a.organizationId, a.userId, reabierta.opp.id, { status: "OPEN" });
  assertAppError(
    await capturar(() => confirmDelivery(a.organizationId, a.userId, reabierta.delivery.id)),
    409,
    UNIDAD_NO_VENDIDA,
  );
  assert.equal(await estadoDeUnidad(reabierta.vehicle.id), "RESERVED");

  const perdida = await ganadaConUnidad();
  await updateOpportunity(a.organizationId, a.userId, perdida.opp.id, { status: "LOST" });
  assertAppError(
    await capturar(() => confirmDelivery(a.organizationId, a.userId, perdida.delivery.id)),
    409,
    UNIDAD_NO_VENDIDA,
  );
  assert.equal(await estadoDeUnidad(perdida.vehicle.id), "AVAILABLE");

  const estados = await prisma.delivery.findMany({
    where: { id: { in: [reabierta.delivery.id, perdida.delivery.id] } },
  });
  assert.ok(estados.every((d) => d.status === "PENDING" && d.deliveredAt === null));
});

test("dos 'Confirmar entrega' a la vez: exactamente uno confirma, el otro es 409", async () => {
  const { vehicle, delivery } = await ganadaConUnidad();

  const resultados = await Promise.allSettled([
    confirmDelivery(a.organizationId, a.userId, delivery.id),
    confirmDelivery(a.organizationId, a.userId, delivery.id),
  ]);

  const ok = resultados.filter((r) => r.status === "fulfilled");
  const fallidos = resultados.filter((r) => r.status === "rejected");
  assert.equal(ok.length, 1);
  assert.equal(fallidos.length, 1);
  assertAppError((fallidos[0] as PromiseRejectedResult).reason, 409, ENTREGA_YA_CONFIRMADA);
  assert.equal(await estadoDeUnidad(vehicle.id), "DELIVERED");

  // Un solo SOLD -> DELIVERED en el historial, no dos.
  const log = await getVehicleChangeLog(a.organizationId, vehicle.id, { page: 1, pageSize: 10 });
  assert.equal(log.data.filter((row) => row.newValue === "DELIVERED").length, 1);
});

// ---------------------------------------------------------------------------
// Carreras forzadas (carreras.test-helper.ts): la transacción A toma el MISMO
// lockOrganizationForUpdate que usan los services y aplica el efecto de la
// operación rival; B es la llamada real.
// ---------------------------------------------------------------------------

// La carrera que justifica pasaAWon en vez de "el destino de la unidad es
// SOLD". B lee la oportunidad OPEN sin lock (A no comiteó), así que decide
// sincronizar la unidad y entra al bloque de la entrega; recién ahí, con la
// fila bloqueada, ve que ya está ganada. Con la regla ingenua B reventaría el
// UNIQUE y el segundo "Marcar ganada" —hoy un no-op— daría 409.
test("carrera ganar vs ganar: el segundo PATCH espera el lock, ve la oportunidad ya ganada y no crea otra entrega", async () => {
  const vehicle = await borrador(a);
  const opp = await oportunidad({ vehicleId: vehicle.id });

  // A: el efecto de un "Marcar ganada" rival, bajo el lock real.
  const rival = await sostenerTransaccion(async (tx) => {
    await lockOrganizationForUpdate(a.organizationId, tx);
    await tx.opportunity.update({ where: { id: opp.id }, data: { status: "WON" } });
    await setVehicleStatusForOpportunityLink(a.organizationId, a.userId, vehicle.id, "SOLD", tx);
    await createDeliveryForSoldVehicle(a.organizationId, opp.id, vehicle.id, tx);
  });

  const b1 = updateOpportunity(a.organizationId, a.userId, opp.id, { status: "WON" });
  await esperarBloqueadoPor(rival, b1, "ganar vs ganar");
  rival.liberar();
  await rival.terminada;

  await b1;
  assert.equal((await entregasDe(opp.id)).length, 1);
  assert.equal(await estadoDeUnidad(vehicle.id), "SOLD");
});

// La carrera que justifica el lock de organización en confirmDelivery. A es
// una reversión de la oportunidad (lo que hace updateOpportunity bajo el mismo
// lock). Sin el lock en confirmDelivery, B leería la unidad todavía SOLD, su
// CAS sobre la entrega pasaría (A no la tocó), y el UPDATE de la unidad —que
// no está condicionado al estado— esperaría la fila de A y después pisaría el
// RESERVED con DELIVERED: una unidad "entregada" de una oportunidad abierta.
test("carrera confirmar vs reabrir la oportunidad: confirmar espera el lock, ve la unidad RESERVED y da 409", async () => {
  const { vehicle, opp, delivery } = await ganadaConUnidad();

  const rival = await sostenerTransaccion(async (tx) => {
    await lockOrganizationForUpdate(a.organizationId, tx);
    await tx.opportunity.update({ where: { id: opp.id }, data: { status: "OPEN" } });
    await setVehicleStatusForOpportunityLink(
      a.organizationId,
      a.userId,
      vehicle.id,
      "RESERVED",
      tx,
    );
  });

  const b1 = confirmDelivery(a.organizationId, a.userId, delivery.id);
  await esperarBloqueadoPor(rival, b1, "confirmar vs reabrir");
  rival.liberar();
  await rival.terminada;

  assertAppError(await capturar(() => b1), 409, UNIDAD_NO_VENDIDA);
  assert.equal(await estadoDeUnidad(vehicle.id), "RESERVED");
  const releida = await prisma.delivery.findUniqueOrThrow({ where: { id: delivery.id } });
  assert.equal(releida.status, "PENDING");
  assert.equal(releida.deliveredAt, null);
});

// ---------------------------------------------------------------------------
// Aislamiento entre organizaciones
// ---------------------------------------------------------------------------

test("otra organización: listar, leer, editar y confirmar la entrega de A desde B dan 404 — nunca se toca la fila", async () => {
  const { vehicle, opp, delivery } = await ganadaConUnidad();

  for (const fn of [
    () => listDeliveriesByOpportunity(b.organizationId, opp.id),
    () => getDeliveryById(b.organizationId, delivery.id),
    () =>
      updateDelivery(b.organizationId, delivery.id, {
        checklist: [{ label: "hijacked", checked: true }],
      }),
    () => confirmDelivery(b.organizationId, b.userId, delivery.id),
  ]) {
    const err = await capturar(fn);
    assert.equal((err as { statusCode?: number }).statusCode, 404);
  }

  const intacta = await prisma.delivery.findUniqueOrThrow({ where: { id: delivery.id } });
  assert.equal(intacta.status, "PENDING");
  assert.equal((intacta.checklist as unknown[]).length, 5);
  assert.equal(await estadoDeUnidad(vehicle.id), "SOLD");
});

async function assertViolaFk(write: () => Promise<unknown>, label: string) {
  await assert.rejects(
    write,
    (err: unknown) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003",
    `${label}: la base debe rechazar la referencia cross-tenant con una violación de FK`,
  );
}

test("FKs compuestas: una entrega de A con la oportunidad, la unidad o el usuario de B es rechazada por la base", async () => {
  const vehicleA = await borrador(a);
  const vehicleB = await borrador(b);
  // Cada caso con su propia oportunidad de A sin entrega: si repitieran la
  // misma, el UNIQUE (organization_id, opportunity_id) saltaría antes que la
  // FK y el test no probaría la FK.
  const base = async () => ({
    organizationId: a.organizationId,
    opportunityId: (await oportunidad()).id,
    vehicleId: vehicleA.id,
  });

  // Caso legítimo primero: la fila está bien armada y entra.
  const ok = await prisma.delivery.create({ data: { ...(await base()), deliveredById: a.userId } });
  assert.equal(ok.organizationId, a.organizationId);

  const oppA = await base();
  await assertViolaFk(
    () =>
      prisma.delivery.create({
        data: { ...oppA, organizationId: b.organizationId, vehicleId: null },
      }),
    "deliveries -> opportunities",
  );
  const conUnidadB = await base();
  await assertViolaFk(
    () => prisma.delivery.create({ data: { ...conUnidadB, vehicleId: vehicleB.id } }),
    "deliveries -> vehicles",
  );
  const conUsuarioB = await base();
  await assertViolaFk(
    () => prisma.delivery.create({ data: { ...conUsuarioB, deliveredById: b.userId } }),
    "deliveries -> users",
  );
});
