import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Prisma } from "@prisma/client";
import { esperarBloqueadoPor, sostenerTransaccion } from "../lib/carreras.test-helper";
import { prisma } from "../lib/prisma";
import { lockOpportunityForUpdate } from "../repositories/opportunity.repository";
import { createOpportunity, deleteOpportunity, updateOpportunity } from "./opportunity.service";
import { createPipeline } from "./pipeline.service";
import {
  COTIZACION_ACEPTADA_BLOQUEA,
  createQuote,
  getActiveQuote,
  getQuoteById,
  listQuotesByOpportunity,
  SOLO_BORRADOR_EDITABLE,
  updateQuoteContent,
  updateQuoteStatus,
} from "./quote.service";
import { createStage } from "./stage.service";
import {
  assertAppError,
  borrador,
  capturar,
  desmontar,
  montar,
  type Escenario,
} from "./vehicle.test-helper";

// ---------------------------------------------------------------------------
// Cotización contra Postgres real (§39 de docs/frontend-cambios-pendientes.md).
// Lo que no se puede probar sin base: que "la activa" y la superación
// funcionen sobre filas reales, que las transiciones sean compare-and-swap de
// verdad, que dos escrituras concurrentes se serialicen en el lock de la
// oportunidad, el vencimiento perezoso, la foto de la unidad y el aislamiento
// entre organizaciones (service y FKs compuestas). Las reglas puras están en
// quote.service.test.ts; el WHERE de cada escritura del repository, en
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
let opportunityB: string;

before(async () => {
  a = await montar("quote-a");
  b = await montar("quote-b");

  const pipeline = await createPipeline(a.organizationId, { name: "Ventas" });
  const stage = await createStage(a.organizationId, { pipelineId: pipeline.id, name: "Contacto" });
  const company = await prisma.company.create({
    data: { organizationId: a.organizationId, name: "Cliente" },
  });
  pipelineId = pipeline.id;
  stageId = stage.id;
  companyId = company.id;

  const pipelineB = await createPipeline(b.organizationId, { name: "Ventas B" });
  const stageB = await createStage(b.organizationId, {
    pipelineId: pipelineB.id,
    name: "Contacto",
  });
  const companyB = await prisma.company.create({
    data: { organizationId: b.organizationId, name: "Cliente B" },
  });
  const oppB = await createOpportunity(b.organizationId, b.userId, {
    title: "De B",
    pipelineId: pipelineB.id,
    stageId: stageB.id,
    companyId: companyB.id,
  });
  opportunityB = oppB.id;
});

after(async () => {
  for (const e of [a, b]) {
    if (!e) continue;
    const where = { organizationId: e.organizationId };
    // Las cotizaciones referencian oportunidad, unidad y usuario (RESTRICT /
    // NO ACTION): van primero.
    await prisma.quote.deleteMany({ where });
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

function cotizar(opportunityId: string, amount = 25_000, extra: Record<string, unknown> = {}) {
  return createQuote(a.organizationId, a.userId, {
    opportunityId,
    amount,
    currency: "USD",
    lines: [],
    ...extra,
  });
}

async function estado(id: string) {
  const quote = await prisma.quote.findUniqueOrThrow({ where: { id } });
  return quote.status;
}

// ---------------------------------------------------------------------------
// Crear y "la activa"
// ---------------------------------------------------------------------------

test("crear la primera: nace DRAFT, es la activa, guarda quién la armó y las líneas como string de dos decimales", async () => {
  const opp = await oportunidad();
  const quote = await cotizar(opp.id, 25_000, {
    lines: [
      { description: "Polarizado", amount: 350 },
      { description: "Descuento contado", amount: -1000 },
    ],
    validUntil: new Date("2099-12-31T00:00:00.000Z"),
  });

  assert.equal(quote.status, "DRAFT");
  assert.equal(Number(quote.amount), 25_000);
  assert.equal(quote.createdById, a.userId);
  assert.equal(quote.createdBy.id, a.userId);
  assert.deepEqual(quote.lines, [
    { description: "Polarizado", amount: "350.00" },
    { description: "Descuento contado", amount: "-1000.00" },
  ]);
  assert.equal(quote.validUntil?.toISOString(), "2099-12-31T00:00:00.000Z");

  const active = await getActiveQuote(a.organizationId, opp.id);
  assert.equal(active?.id, quote.id);
});

test("crear una nueva con la activa en DRAFT o SENT la supera; el historial queda más nueva primero", async () => {
  const opp = await oportunidad();
  const primera = await cotizar(opp.id, 25_000);
  const segunda = await cotizar(opp.id, 24_000);
  assert.equal(await estado(primera.id), "SUPERSEDED");

  await updateQuoteStatus(a.organizationId, segunda.id, "SENT");
  const tercera = await cotizar(opp.id, 23_500);
  assert.equal(await estado(segunda.id), "SUPERSEDED");
  assert.equal(await estado(tercera.id), "DRAFT");

  const lista = await listQuotesByOpportunity(a.organizationId, {
    opportunityId: opp.id,
    page: 1,
    pageSize: 50,
  });
  assert.deepEqual(
    lista.data.map((q) => q.id),
    [tercera.id, segunda.id, primera.id],
  );
  assert.equal(lista.activeQuoteId, tercera.id);
  assert.equal(lista.pagination.total, 3);
});

test("crear con la activa ACCEPTED: 409 y no se escribe nada", async () => {
  const opp = await oportunidad();
  const quote = await cotizar(opp.id);
  await updateQuoteStatus(a.organizationId, quote.id, "SENT");
  await updateQuoteStatus(a.organizationId, quote.id, "ACCEPTED");

  const err = await capturar(() => cotizar(opp.id, 20_000));
  assertAppError(err, 409, COTIZACION_ACEPTADA_BLOQUEA);
  assert.equal(await prisma.quote.count({ where: { opportunityId: opp.id } }), 1);
  assert.equal(await estado(quote.id), "ACCEPTED");
});

test("crear con la activa REJECTED: permitido, y la rechazada NO pasa a SUPERSEDED — queda en el historial con su estado", async () => {
  const opp = await oportunidad();
  const rechazada = await cotizar(opp.id);
  await updateQuoteStatus(a.organizationId, rechazada.id, "SENT");
  await updateQuoteStatus(a.organizationId, rechazada.id, "REJECTED");

  const nueva = await cotizar(opp.id, 22_000);
  assert.equal(await estado(rechazada.id), "REJECTED");
  assert.equal((await getActiveQuote(a.organizationId, opp.id))?.id, nueva.id);
});

test("vencimiento perezoso: una SENT con la validez pasada aparece EXPIRED al listar, y crear sobre ella es permitido", async () => {
  const opp = await oportunidad();
  const quote = await cotizar(opp.id);
  await updateQuoteStatus(a.organizationId, quote.id, "SENT");
  // La validez se corre al pasado a mano: por la API no se puede enviar una
  // cotización ya vencida (assertSendable).
  await prisma.quote.update({
    where: { id: quote.id },
    data: { validUntil: new Date("2020-01-01T00:00:00.000Z") },
  });

  const lista = await listQuotesByOpportunity(a.organizationId, {
    opportunityId: opp.id,
    page: 1,
    pageSize: 50,
  });
  assert.equal(lista.data[0].status, "EXPIRED");
  assert.equal(lista.activeQuoteId, quote.id);

  const err = await capturar(() => updateQuoteStatus(a.organizationId, quote.id, "ACCEPTED"));
  assertAppError(err, 409, "venció");

  const nueva = await cotizar(opp.id, 21_000);
  assert.equal(await estado(quote.id), "EXPIRED");
  assert.equal((await getActiveQuote(a.organizationId, opp.id))?.id, nueva.id);
});

test("una DRAFT con la validez pasada no vence (no se le mostró a nadie), pero enviarla es 409", async () => {
  const opp = await oportunidad();
  const quote = await cotizar(opp.id, 25_000, {
    validUntil: new Date("2020-01-01T00:00:00.000Z"),
  });
  assert.equal((await getQuoteById(a.organizationId, quote.id)).status, "DRAFT");

  const err = await capturar(() => updateQuoteStatus(a.organizationId, quote.id, "SENT"));
  assertAppError(err, 409, "ya pasó");
  assert.equal(await estado(quote.id), "DRAFT");
});

test("vehicleId es una FOTO: cambiar la unidad de la oportunidad no toca las cotizaciones hechas", async () => {
  const corolla = await borrador(a, { priceListUsd: 25_000 });
  const ranger = await borrador(a, { make: "Ford", model: "Ranger", priceListUsd: 40_000 });
  const opp = await oportunidad({ vehicleId: corolla.id });

  const primera = await cotizar(opp.id);
  assert.equal(primera.vehicleId, corolla.id);
  assert.equal(primera.vehicle?.make, "Toyota");

  await updateOpportunity(a.organizationId, a.userId, opp.id, { vehicleId: ranger.id });
  const segunda = await cotizar(opp.id, 39_000);

  assert.equal(segunda.vehicleId, ranger.id);
  const releida = await prisma.quote.findUniqueOrThrow({ where: { id: primera.id } });
  assert.equal(releida.vehicleId, corolla.id);
});

// ---------------------------------------------------------------------------
// Transiciones
// ---------------------------------------------------------------------------

test("transiciones válidas: DRAFT -> SENT -> ACCEPTED, y SENT -> REJECTED", async () => {
  const opp = await oportunidad();
  const quote = await cotizar(opp.id);
  assert.equal((await updateQuoteStatus(a.organizationId, quote.id, "SENT")).status, "SENT");
  assert.equal(
    (await updateQuoteStatus(a.organizationId, quote.id, "ACCEPTED")).status,
    "ACCEPTED",
  );

  const otraOpp = await oportunidad();
  const otra = await cotizar(otraOpp.id);
  await updateQuoteStatus(a.organizationId, otra.id, "SENT");
  assert.equal((await updateQuoteStatus(a.organizationId, otra.id, "REJECTED")).status, "REJECTED");
});

test("transiciones inválidas: 409 y el estado no cambia", async () => {
  const opp = await oportunidad();
  const quote = await cotizar(opp.id);

  // DRAFT no se acepta ni se rechaza sin enviarse.
  assertAppError(
    await capturar(() => updateQuoteStatus(a.organizationId, quote.id, "ACCEPTED")),
    409,
    "tiene que enviarse",
  );
  assertAppError(
    await capturar(() => updateQuoteStatus(a.organizationId, quote.id, "REJECTED")),
    409,
    "tiene que enviarse",
  );
  assert.equal(await estado(quote.id), "DRAFT");

  await updateQuoteStatus(a.organizationId, quote.id, "SENT");
  assertAppError(
    await capturar(() => updateQuoteStatus(a.organizationId, quote.id, "SENT")),
    409,
    "ya fue enviada",
  );

  await updateQuoteStatus(a.organizationId, quote.id, "REJECTED");
  // Nada vuelve atrás desde un estado final.
  assertAppError(
    await capturar(() => updateQuoteStatus(a.organizationId, quote.id, "ACCEPTED")),
    409,
    "ya fue rechazada",
  );
  assert.equal(await estado(quote.id), "REJECTED");

  // Y una superada tampoco admite nada.
  const vieja = await cotizar(opp.id);
  await cotizar(opp.id);
  assertAppError(
    await capturar(() => updateQuoteStatus(a.organizationId, vieja.id, "SENT")),
    409,
    "reemplazada",
  );
});

// Las dos llamadas se serializan en el lock de la oportunidad, así que la
// segunda cae en el pre-check; el CAS es la defensa de la fila para cualquier
// escritura que no pase por ese lock (el vencimiento perezoso). Lo que se
// afirma es el resultado observable: un solo ganador, nunca los dos.
test("aceptar y rechazar la misma cotización a la vez: gana exactamente uno", async () => {
  const opp = await oportunidad();
  const quote = await cotizar(opp.id);
  await updateQuoteStatus(a.organizationId, quote.id, "SENT");

  const resultados = await Promise.allSettled([
    updateQuoteStatus(a.organizationId, quote.id, "ACCEPTED"),
    updateQuoteStatus(a.organizationId, quote.id, "REJECTED"),
  ]);
  const ganadores = resultados.filter((r) => r.status === "fulfilled");
  const perdedores = resultados.filter((r) => r.status === "rejected");
  assert.equal(ganadores.length, 1);
  assert.equal(perdedores.length, 1);
  assertAppError((perdedores[0] as PromiseRejectedResult).reason, 409, "ya fue");

  const final = await estado(quote.id);
  assert.ok(final === "ACCEPTED" || final === "REJECTED");
});

// ---------------------------------------------------------------------------
// Edición del contenido
// ---------------------------------------------------------------------------

test("editar una DRAFT: monto, líneas y validez cambian; limpiar la validez con null", async () => {
  const opp = await oportunidad();
  const quote = await cotizar(opp.id, 25_000, {
    validUntil: new Date("2099-01-01T00:00:00.000Z"),
  });

  const editada = await updateQuoteContent(a.organizationId, quote.id, {
    amount: 24_500,
    currency: "UYU",
    lines: [{ description: "Service prepago", amount: 12_000.456 }],
    validUntil: null,
  });
  assert.equal(Number(editada.amount), 24_500);
  assert.equal(editada.currency, "UYU");
  assert.deepEqual(editada.lines, [{ description: "Service prepago", amount: "12000.46" }]);
  assert.equal(editada.validUntil, null);
  assert.equal(editada.status, "DRAFT");
});

test("editar una SENT (o cualquier no-DRAFT): 409 y el precio que vio el cliente no cambia", async () => {
  const opp = await oportunidad();
  const quote = await cotizar(opp.id, 25_000);
  await updateQuoteStatus(a.organizationId, quote.id, "SENT");

  const err = await capturar(() => updateQuoteContent(a.organizationId, quote.id, { amount: 1 }));
  assertAppError(err, 409, SOLO_BORRADOR_EDITABLE);
  const releida = await prisma.quote.findUniqueOrThrow({ where: { id: quote.id } });
  assert.equal(Number(releida.amount), 25_000);
});

// ---------------------------------------------------------------------------
// Carreras forzadas (carreras.test-helper.ts): la transacción A toma el MISMO
// lockOpportunityForUpdate que usa el service y aplica el efecto de la
// operación rival; B es la llamada real. Si el lock faltara en el service, B
// terminaría sin bloquearse y esperarBloqueadoPor fallaría.
// ---------------------------------------------------------------------------

test("carrera crear vs crear: la segunda espera el lock, ve la primera y la supera — nunca dos activas", async () => {
  const opp = await oportunidad();

  // A: el efecto de una "Nueva cotización" rival, bajo el lock real.
  const rival = await sostenerTransaccion(async (tx) => {
    await lockOpportunityForUpdate(opp.id, a.organizationId, tx);
    await tx.quote.create({
      data: {
        organizationId: a.organizationId,
        opportunityId: opp.id,
        createdById: a.userId,
        amount: 25_000,
        currency: "USD",
      },
    });
  });

  const b = cotizar(opp.id, 24_000);
  await esperarBloqueadoPor(rival, b, "createQuote");
  rival.liberar();
  await rival.terminada;
  const nueva = await b;

  const noSuperadas = await prisma.quote.findMany({
    where: { opportunityId: opp.id, status: { not: "SUPERSEDED" } },
  });
  assert.deepEqual(
    noSuperadas.map((q) => q.id),
    [nueva.id],
  );
});

test("carrera aceptar vs crear: si el ACCEPTED comitea primero, la creación ve la aceptada y da 409", async () => {
  const opp = await oportunidad();
  const quote = await cotizar(opp.id);
  await updateQuoteStatus(a.organizationId, quote.id, "SENT");

  // A: el efecto de "Marcar aceptada", bajo el mismo lock que toma
  // updateQuoteStatus.
  const rival = await sostenerTransaccion(async (tx) => {
    await lockOpportunityForUpdate(opp.id, a.organizationId, tx);
    await tx.quote.update({ where: { id: quote.id }, data: { status: "ACCEPTED" } });
  });

  const b = capturar(() => cotizar(opp.id, 20_000));
  await esperarBloqueadoPor(rival, b, "createQuote contra un aceptar");
  rival.liberar();
  await rival.terminada;

  assertAppError(await b, 409, COTIZACION_ACEPTADA_BLOQUEA);
  assert.equal(await prisma.quote.count({ where: { opportunityId: opp.id } }), 1);
});

test("carrera crear vs aceptar: si la creación comitea primero, aceptar la vieja encuentra SUPERSEDED y da 409", async () => {
  const opp = await oportunidad();
  const vieja = await cotizar(opp.id);
  await updateQuoteStatus(a.organizationId, vieja.id, "SENT");

  // A: el efecto de createQuote (superar + insertar), bajo el lock real.
  const rival = await sostenerTransaccion(async (tx) => {
    await lockOpportunityForUpdate(opp.id, a.organizationId, tx);
    await tx.quote.updateMany({
      where: { opportunityId: opp.id, status: { in: ["DRAFT", "SENT"] } },
      data: { status: "SUPERSEDED" },
    });
    await tx.quote.create({
      data: {
        organizationId: a.organizationId,
        opportunityId: opp.id,
        createdById: a.userId,
        amount: 19_000,
        currency: "USD",
      },
    });
  });

  const b = capturar(() => updateQuoteStatus(a.organizationId, vieja.id, "ACCEPTED"));
  await esperarBloqueadoPor(rival, b, "updateQuoteStatus contra un crear");
  rival.liberar();
  await rival.terminada;

  assertAppError(await b, 409, "reemplazada");
  assert.equal(await estado(vieja.id), "SUPERSEDED");
});

// El caso de arriba no alcanza para probar el lock de updateQuoteStatus: A ya
// escribió la fila de la cotización, así que el CAS de B se bloquearía contra
// ese lock de FILA aunque el service no tomara el de la oportunidad. Éste sí:
// A es una createQuote rival que tomó el lock y todavía NO tocó ninguna
// cotización (está entre leer la activa y superarla). Sin el lock en
// updateQuoteStatus, B aceptaría sin esperar y A insertaría una cotización
// nueva encima de una aceptada.
test("carrera aceptar vs crear en curso: aceptar espera el lock de la oportunidad aunque nadie haya tocado la cotización todavía", async () => {
  const opp = await oportunidad();
  const quote = await cotizar(opp.id);
  await updateQuoteStatus(a.organizationId, quote.id, "SENT");

  const rival = await sostenerTransaccion(async (tx) => {
    await lockOpportunityForUpdate(opp.id, a.organizationId, tx);
  });

  const b = updateQuoteStatus(a.organizationId, quote.id, "ACCEPTED");
  await esperarBloqueadoPor(rival, b, "updateQuoteStatus contra un crear en curso");
  rival.liberar();
  await rival.terminada;

  assert.equal((await b).status, "ACCEPTED");
});

// ---------------------------------------------------------------------------
// Aislamiento y alcance
// ---------------------------------------------------------------------------

test("otra organización: listar, leer, crear, cambiar estado y editar dan 404/400 — nunca se toca la fila de B", async () => {
  const quoteB = await createQuote(b.organizationId, b.userId, {
    opportunityId: opportunityB,
    amount: 10_000,
    currency: "USD",
    lines: [],
  });

  assertAppError(
    await capturar(() =>
      listQuotesByOpportunity(a.organizationId, {
        opportunityId: opportunityB,
        page: 1,
        pageSize: 50,
      }),
    ),
    404,
    "Oportunidad no encontrada",
  );
  assertAppError(
    await capturar(() => getQuoteById(a.organizationId, quoteB.id)),
    404,
    "no encontrada",
  );
  assertAppError(
    await capturar(() =>
      createQuote(a.organizationId, a.userId, {
        opportunityId: opportunityB,
        amount: 1,
        currency: "USD",
        lines: [],
      }),
    ),
    400,
    "opportunityId",
  );
  assertAppError(
    await capturar(() => updateQuoteStatus(a.organizationId, quoteB.id, "SENT")),
    404,
    "no encontrada",
  );
  assertAppError(
    await capturar(() => updateQuoteContent(a.organizationId, quoteB.id, { amount: 1 })),
    404,
    "no encontrada",
  );

  const releida = await prisma.quote.findUniqueOrThrow({ where: { id: quoteB.id } });
  assert.equal(releida.status, "DRAFT");
  assert.equal(Number(releida.amount), 10_000);
  assert.equal(await prisma.quote.count({ where: { opportunityId: opportunityB } }), 1);
});

// La base misma rechaza una cotización de A colgada de algo de B: las tres
// FKs compuestas de la migración 20260916120000. Directo por Prisma, sin
// pasar por el service — es un test del contrato de la base, como los de
// tenant-isolation.integration-test.ts.
async function assertViolaFk(write: () => Promise<unknown>, label: string) {
  await assert.rejects(
    write,
    (err: unknown) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003",
    `${label}: la base debe rechazar la referencia cross-tenant con una violación de FK`,
  );
}

test("FKs compuestas: una cotización de A con la oportunidad, la unidad o el autor de B es rechazada por la base", async () => {
  const oppA = await oportunidad();
  const vehicleB = await borrador(b);
  const base = {
    organizationId: a.organizationId,
    opportunityId: oppA.id,
    createdById: a.userId,
    amount: 1,
    currency: "USD",
  };

  // Caso legítimo primero: la fila está bien armada y entra.
  const ok = await prisma.quote.create({ data: base });
  assert.equal(ok.organizationId, a.organizationId);

  await assertViolaFk(
    () => prisma.quote.create({ data: { ...base, opportunityId: opportunityB } }),
    "quotes -> opportunities",
  );
  await assertViolaFk(
    () => prisma.quote.create({ data: { ...base, vehicleId: vehicleB.id } }),
    "quotes -> vehicles",
  );
  await assertViolaFk(
    () => prisma.quote.create({ data: { ...base, createdById: b.userId } }),
    "quotes -> users",
  );
});

test("oportunidad eliminada: su historial y sus cotizaciones dejan de ser alcanzables (404)", async () => {
  const opp = await oportunidad();
  const quote = await cotizar(opp.id);
  await deleteOpportunity(a.organizationId, a.userId, opp.id);

  assertAppError(
    await capturar(() =>
      listQuotesByOpportunity(a.organizationId, { opportunityId: opp.id, page: 1, pageSize: 50 }),
    ),
    404,
    "Oportunidad no encontrada",
  );
  assertAppError(
    await capturar(() => getQuoteById(a.organizationId, quote.id)),
    404,
    "no encontrada",
  );
  assertAppError(
    await capturar(() => updateQuoteStatus(a.organizationId, quote.id, "SENT")),
    404,
    "no encontrada",
  );
  assertAppError(await capturar(() => cotizar(opp.id)), 400, "opportunityId");
});
