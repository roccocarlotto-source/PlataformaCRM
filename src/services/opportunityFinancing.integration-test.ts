import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { prisma } from "../lib/prisma";
import { createOpportunity, getOpportunityById, updateOpportunity } from "./opportunity.service";
import { createPipeline } from "./pipeline.service";
import { createStage } from "./stage.service";
import { desmontar, montar, type Escenario } from "./vehicle.test-helper";

// ---------------------------------------------------------------------------
// Detalle de financiación (§42 de docs/frontend-cambios-pendientes.md) contra
// Postgres real. Dos cosas que sin base no se pueden probar:
//
// - Los tres CHECK de la migración 20260919120000. Zod ya los frena en el
//   borde HTTP (opportunity.controller.test.ts); estos son la defensa que
//   sobrevive a un camino de escritura que no pase por el controller, así que
//   se ejercitan con Prisma directo — mismo criterio que los CHECK de
//   booking-config.integration-test.ts. Y que NULL pasa sin `OR ... IS NULL`.
// - Que el service los persista tal cual en create y los vacíe con null en
//   update, y que los Decimal vuelvan con sus dos decimales.
// ---------------------------------------------------------------------------

let e: Escenario;
let pipelineId: string;
let stageId: string;
let companyId: string;

before(async () => {
  e = await montar("opp-fin");
  const pipeline = await createPipeline(e.organizationId, { name: "Ventas" });
  const stage = await createStage(e.organizationId, { pipelineId: pipeline.id, name: "Contacto" });
  const company = await prisma.company.create({
    data: { organizationId: e.organizationId, name: "Cliente" },
  });
  pipelineId = pipeline.id;
  stageId = stage.id;
  companyId = company.id;
});

after(async () => {
  if (!e) return;
  await prisma.opportunity.deleteMany({ where: { organizationId: e.organizationId } });
  await prisma.stage.deleteMany({ where: { organizationId: e.organizationId } });
  await prisma.pipeline.deleteMany({ where: { organizationId: e.organizationId } });
  await prisma.company.deleteMany({ where: { organizationId: e.organizationId } });
  await desmontar(e);
});

function filaDirecta(extra: Record<string, unknown>) {
  return prisma.opportunity.create({
    data: {
      organizationId: e.organizationId,
      ownerId: e.userId,
      pipelineId,
      stageId,
      companyId,
      title: "Directa",
      ...extra,
    },
  });
}

test("los CHECK rechazan entrega negativa, cuota negativa y cero cuotas aunque Zod no esté en el camino", async () => {
  await assert.rejects(
    filaDirecta({ financingDownPayment: -1 }),
    /opportunities_financing_down_payment_non_negative_check/,
  );
  await assert.rejects(
    filaDirecta({ financingInstallmentAmount: -0.01 }),
    /opportunities_financing_installment_amount_non_negative_check/,
  );
  await assert.rejects(
    filaDirecta({ financingInstallmentCount: 0 }),
    /opportunities_financing_installment_count_positive_check/,
  );
  await assert.rejects(
    filaDirecta({ financingInstallmentCount: -3 }),
    /opportunities_financing_installment_count_positive_check/,
  );
});

test("los CHECK dejan pasar NULL y los bordes válidos (entrega y cuota en 0, una cuota)", async () => {
  const sinDetalle = await filaDirecta({});
  assert.equal(sinDetalle.financingDownPayment, null);
  assert.equal(sinDetalle.financingInstallmentCount, null);
  assert.equal(sinDetalle.financingInstallmentAmount, null);

  const bordes = await filaDirecta({
    financingDownPayment: 0,
    financingInstallmentAmount: 0,
    financingInstallmentCount: 1,
  });
  assert.equal(bordes.financingDownPayment?.toString(), "0");
  assert.equal(bordes.financingInstallmentCount, 1);
});

test("createOpportunity persiste el detalle tal cual y updateOpportunity lo corrige y lo vacía con null", async () => {
  const creada = await createOpportunity(e.organizationId, e.userId, {
    title: "Con plan",
    pipelineId,
    stageId,
    companyId,
    financingType: "INSTALLMENT_24M",
    financingLender: "Banco República",
    financingDownPayment: 5000.5,
    financingInstallmentCount: 23,
    financingInstallmentAmount: 812.25,
  });
  assert.equal(creada.financingLender, "Banco República");
  assert.equal(creada.financingDownPayment?.toFixed(2), "5000.50");
  assert.equal(creada.financingInstallmentCount, 23);
  assert.equal(creada.financingInstallmentAmount?.toFixed(2), "812.25");

  // Cambiar la categoría no toca el detalle: no hay regla de vaciado.
  await updateOpportunity(e.organizationId, e.userId, creada.id, {
    financingType: "OWN_FINANCING",
    financingInstallmentCount: 25,
  });
  const corregida = await getOpportunityById(e.organizationId, creada.id);
  assert.equal(corregida.financingType, "OWN_FINANCING");
  assert.equal(corregida.financingLender, "Banco República");
  assert.equal(corregida.financingInstallmentCount, 25);

  await updateOpportunity(e.organizationId, e.userId, creada.id, {
    financingLender: null,
    financingDownPayment: null,
    financingInstallmentCount: null,
    financingInstallmentAmount: null,
  });
  const vaciada = await getOpportunityById(e.organizationId, creada.id);
  assert.equal(vaciada.financingLender, null);
  assert.equal(vaciada.financingDownPayment, null);
  assert.equal(vaciada.financingInstallmentCount, null);
  assert.equal(vaciada.financingInstallmentAmount, null);
  assert.equal(vaciada.financingType, "OWN_FINANCING");
});
