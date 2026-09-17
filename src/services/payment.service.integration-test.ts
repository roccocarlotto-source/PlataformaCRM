import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { createOpportunity, deleteOpportunity, updateOpportunity } from "./opportunity.service";
import {
  createPayment,
  deletePayment,
  getPaymentById,
  listPaymentsByOpportunity,
  updatePayment,
} from "./payment.service";
import { createPipeline } from "./pipeline.service";
import { createStage } from "./stage.service";
import { assertAppError, capturar, desmontar, montar, type Escenario } from "./vehicle.test-helper";

// ---------------------------------------------------------------------------
// Pago del cliente contra Postgres real (§43 de
// docs/frontend-cambios-pendientes.md). Lo que no se puede probar sin base:
// el CHECK estricto de la migración 20260920120000 (con Prisma directo, sin
// zod en el camino), la foto de la moneda sobre filas reales, el orden del
// historial, el DELETE físico y el aislamiento entre organizaciones (service
// y FK compuesta). El borde zod está en payment.controller.test.ts; el WHERE
// de cada escritura del repository, en tenant-isolation.integration-test.ts.
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
  a = await montar("payment-a");
  b = await montar("payment-b");

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
    // Los pagos referencian la oportunidad (RESTRICT): van primero.
    await prisma.payment.deleteMany({ where });
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
    amount: 25_000,
    currency: "USD",
    ...extra,
  });
}

function pagar(opportunityId: string, amount = 5_000, paidAt = "2026-09-16") {
  return createPayment(a.organizationId, {
    opportunityId,
    amount,
    method: "TRANSFER",
    paidAt: new Date(`${paidAt}T00:00:00.000Z`),
  });
}

// ---------------------------------------------------------------------------
// CHECK
// ---------------------------------------------------------------------------

function filaDirecta(opportunityId: string, amount: number) {
  return prisma.payment.create({
    data: {
      organizationId: a.organizationId,
      opportunityId,
      amount,
      currency: "USD",
      method: "CASH",
      paidAt: new Date("2026-09-16T00:00:00.000Z"),
    },
  });
}

test("el CHECK rechaza un pago de 0 y uno negativo aunque zod no esté en el camino; 0.01 entra", async () => {
  const opp = await oportunidad();
  await assert.rejects(filaDirecta(opp.id, 0), /payments_amount_positive_check/);
  await assert.rejects(filaDirecta(opp.id, -100), /payments_amount_positive_check/);
  // Decimal(14, 2) redondea antes del CHECK: 0.004 llega como 0.00.
  await assert.rejects(filaDirecta(opp.id, 0.004), /payments_amount_positive_check/);

  const borde = await filaDirecta(opp.id, 0.01);
  assert.equal(borde.amount.toString(), "0.01");
});

// ---------------------------------------------------------------------------
// Crear, listar, editar, borrar
// ---------------------------------------------------------------------------

test("crear: toma la moneda de la oportunidad, guarda método y fecha, y no toca la oportunidad", async () => {
  const opp = await oportunidad({ currency: "UYU" });
  const payment = await createPayment(a.organizationId, {
    opportunityId: opp.id,
    amount: 1_500.5,
    method: "CASH",
    paidAt: new Date("2026-09-10T00:00:00.000Z"),
  });

  assert.equal(payment.organizationId, a.organizationId);
  assert.equal(payment.opportunityId, opp.id);
  assert.equal(payment.currency, "UYU");
  assert.equal(payment.amount.toString(), "1500.5");
  assert.equal(payment.method, "CASH");
  assert.equal(payment.paidAt.toISOString(), "2026-09-10T00:00:00.000Z");

  // Informativo: la oportunidad queda exactamente como estaba.
  const releida = await prisma.opportunity.findUniqueOrThrow({ where: { id: opp.id } });
  assert.equal(releida.status, "OPEN");
  assert.equal(releida.updatedAt.getTime(), opp.updatedAt.getTime());
});

test("listar: más nuevo primero por fecha de cobro, con paginación", async () => {
  const opp = await oportunidad();
  const vieja = await pagar(opp.id, 1_000, "2026-08-01");
  const nueva = await pagar(opp.id, 2_000, "2026-09-15");
  const media = await pagar(opp.id, 3_000, "2026-09-01");

  const lista = await listPaymentsByOpportunity(a.organizationId, {
    opportunityId: opp.id,
    page: 1,
    pageSize: 50,
  });
  assert.deepEqual(
    lista.data.map((p) => p.id),
    [nueva.id, media.id, vieja.id],
  );
  assert.equal(lista.pagination.total, 3);

  const primera = await listPaymentsByOpportunity(a.organizationId, {
    opportunityId: opp.id,
    page: 1,
    pageSize: 2,
  });
  assert.equal(primera.data.length, 2);
  assert.equal(primera.pagination.totalPages, 2);
});

test("editar: monto, método y fecha cambian; la moneda y la oportunidad no", async () => {
  const opp = await oportunidad();
  const payment = await pagar(opp.id);

  const editado = await updatePayment(a.organizationId, payment.id, {
    amount: 4_200,
    method: "CHECK",
    paidAt: new Date("2026-09-20T00:00:00.000Z"),
  });
  assert.equal(editado.amount.toString(), "4200");
  assert.equal(editado.method, "CHECK");
  assert.equal(editado.paidAt.toISOString(), "2026-09-20T00:00:00.000Z");
  assert.equal(editado.currency, "USD");
  assert.equal(editado.opportunityId, opp.id);

  const soloMetodo = await updatePayment(a.organizationId, payment.id, { method: "CARD" });
  assert.equal(soloMetodo.method, "CARD");
  assert.equal(soloMetodo.amount.toString(), "4200");
});

test("borrar: DELETE físico — la fila desaparece de la base, y borrarla otra vez es 404", async () => {
  const opp = await oportunidad();
  const queda = await pagar(opp.id, 1_000);
  const payment = await pagar(opp.id, 2_000);

  await deletePayment(a.organizationId, payment.id);
  assert.equal(await prisma.payment.findUnique({ where: { id: payment.id } }), null);
  assert.ok(await prisma.payment.findUnique({ where: { id: queda.id } }));

  assertAppError(
    await capturar(() => deletePayment(a.organizationId, payment.id)),
    404,
    "Pago no encontrado",
  );
  assertAppError(
    await capturar(() => updatePayment(a.organizationId, payment.id, { amount: 1 })),
    404,
    "Pago no encontrado",
  );
});

test("currency es una FOTO: cambiar la moneda de la oportunidad no toca los pagos ya cargados", async () => {
  const opp = await oportunidad({ currency: "USD" });
  const enDolares = await pagar(opp.id, 5_000);

  await updateOpportunity(a.organizationId, a.userId, opp.id, { currency: "UYU" });
  const enPesos = await pagar(opp.id, 200_000);

  assert.equal(enPesos.currency, "UYU");
  const releido = await prisma.payment.findUniqueOrThrow({ where: { id: enDolares.id } });
  assert.equal(releido.currency, "USD");

  // Editar el pago viejo tampoco lo "actualiza" a la moneda nueva.
  const editado = await updatePayment(a.organizationId, enDolares.id, { amount: 5_100 });
  assert.equal(editado.currency, "USD");
});

// ---------------------------------------------------------------------------
// Aislamiento y alcance
// ---------------------------------------------------------------------------

test("otra organización: listar, leer, crear, editar y borrar dan 404/400 — nunca se toca la fila de B", async () => {
  const paymentB = await createPayment(b.organizationId, {
    opportunityId: opportunityB,
    amount: 10_000,
    method: "CASH",
    paidAt: new Date("2026-09-16T00:00:00.000Z"),
  });

  assertAppError(
    await capturar(() =>
      listPaymentsByOpportunity(a.organizationId, {
        opportunityId: opportunityB,
        page: 1,
        pageSize: 50,
      }),
    ),
    404,
    "Oportunidad no encontrada",
  );
  assertAppError(
    await capturar(() => getPaymentById(a.organizationId, paymentB.id)),
    404,
    "Pago no encontrado",
  );
  assertAppError(
    await capturar(() =>
      createPayment(a.organizationId, {
        opportunityId: opportunityB,
        amount: 1,
        method: "CASH",
        paidAt: new Date("2026-09-16T00:00:00.000Z"),
      }),
    ),
    400,
    "opportunityId",
  );
  assertAppError(
    await capturar(() => updatePayment(a.organizationId, paymentB.id, { amount: 1 })),
    404,
    "Pago no encontrado",
  );
  assertAppError(
    await capturar(() => deletePayment(a.organizationId, paymentB.id)),
    404,
    "Pago no encontrado",
  );

  const releido = await prisma.payment.findUniqueOrThrow({ where: { id: paymentB.id } });
  assert.equal(releido.amount.toString(), "10000");
  assert.equal(await prisma.payment.count({ where: { opportunityId: opportunityB } }), 1);
});

test("FK compuesta: un pago de A colgado de la oportunidad de B es rechazado por la base", async () => {
  const oppA = await oportunidad();
  const ok = await filaDirecta(oppA.id, 1);
  assert.equal(ok.organizationId, a.organizationId);

  await assert.rejects(
    () => filaDirecta(opportunityB, 1),
    (err: unknown) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003",
    "payments -> opportunities: la base debe rechazar la referencia cross-tenant",
  );
});

test("oportunidad eliminada: su historial y sus pagos dejan de ser alcanzables (404)", async () => {
  const opp = await oportunidad();
  const payment = await pagar(opp.id);
  await deleteOpportunity(a.organizationId, a.userId, opp.id);

  assertAppError(
    await capturar(() =>
      listPaymentsByOpportunity(a.organizationId, { opportunityId: opp.id, page: 1, pageSize: 50 }),
    ),
    404,
    "Oportunidad no encontrada",
  );
  assertAppError(
    await capturar(() => getPaymentById(a.organizationId, payment.id)),
    404,
    "Pago no encontrado",
  );
  assertAppError(
    await capturar(() => deletePayment(a.organizationId, payment.id)),
    404,
    "Pago no encontrado",
  );
  assertAppError(await capturar(() => pagar(opp.id)), 400, "opportunityId");
});
