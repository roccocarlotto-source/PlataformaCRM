import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { prisma } from "../lib/prisma";
import {
  CONTACTO_CON_OPORTUNIDADES_ABIERTAS,
  createContact,
  deleteContact,
} from "./contact.service";
import {
  createCompany,
  deleteCompany,
  EMPRESA_CON_OPORTUNIDADES_ABIERTAS,
} from "./company.service";
import { createOpportunity, updateOpportunity } from "./opportunity.service";
import { createPipeline, PIPELINE_DEFAULT_SIN_ETAPAS, updatePipeline } from "./pipeline.service";
import { createStage, deleteStage, ULTIMA_ETAPA_DEL_DEFAULT } from "./stage.service";
import { assertAppError, capturar, desmontar, montar, type Escenario } from "./vehicle.test-helper";

// ---------------------------------------------------------------------------
// Ítems 155 en adelante de docs/matriz-de-datos-crm.md contra Postgres real:
// las reglas de integridad entre contactos, empresas, pipelines y
// oportunidades que la sonda del ítem 150 encontró abiertas.
// ---------------------------------------------------------------------------

let e: Escenario;
let pipelineId: string;
let nuevo: string;
let ganado: string;

before(async () => {
  e = await montar("integridad");
  const pipeline = await createPipeline(e.organizationId, { name: "Ventas", isDefault: true });
  pipelineId = pipeline.id;
  nuevo = (await createStage(e.organizationId, { pipelineId, name: "Nuevo" })).id;
  ganado = (await createStage(e.organizationId, { pipelineId, name: "Ganado", isWon: true })).id;
});

after(async () => {
  if (!e) return;
  const where = { organizationId: e.organizationId };
  await prisma.opportunity.deleteMany({ where });
  await prisma.stage.deleteMany({ where });
  await prisma.pipeline.deleteMany({ where });
  await prisma.contact.deleteMany({ where });
  await prisma.company.deleteMany({ where });
  await prisma.outboxEvent.deleteMany({ where });
  await desmontar(e);
});

let seq = 0;
function contacto(extra: Record<string, unknown> = {}) {
  seq++;
  return createContact(e.organizationId, e.userId, {
    firstName: "Ana",
    lastName: `Integridad ${seq}`,
    ...extra,
  });
}

function oportunidad(extra: Record<string, unknown>) {
  return createOpportunity(e.organizationId, e.userId, {
    title: "Interesada",
    pipelineId,
    stageId: nuevo,
    ...extra,
  });
}

// ---------------------------------------------------------------------------
// Ítem 155 — contacto / empresa con oportunidades abiertas
// ---------------------------------------------------------------------------

test("ítem 155: dar de baja un contacto o una empresa con oportunidades abiertas es 409 y no borra nada", async () => {
  const c = await contacto();
  const empresa = await createCompany(e.organizationId, e.userId, { name: "Empresa abierta" });
  await oportunidad({ contactId: c.id, companyId: empresa.id });

  assertAppError(
    await capturar(() => deleteContact(e.organizationId, c.id)),
    409,
    CONTACTO_CON_OPORTUNIDADES_ABIERTAS,
  );
  assertAppError(
    await capturar(() => deleteCompany(e.organizationId, empresa.id)),
    409,
    EMPRESA_CON_OPORTUNIDADES_ABIERTAS,
  );
  const [contactoReleido, empresaReleida] = await Promise.all([
    prisma.contact.findUniqueOrThrow({ where: { id: c.id } }),
    prisma.company.findUniqueOrThrow({ where: { id: empresa.id } }),
  ]);
  assert.equal(contactoReleido.deletedAt, null);
  assert.equal(empresaReleida.deletedAt, null);
});

test("ítem 155: con la oportunidad cerrada, o sin oportunidades, la baja procede", async () => {
  const c = await contacto();
  const opp = await oportunidad({ contactId: c.id });
  await updateOpportunity(e.organizationId, e.userId, opp.id, { stageId: ganado });
  await deleteContact(e.organizationId, c.id);
  const releido = await prisma.contact.findUniqueOrThrow({ where: { id: c.id } });
  assert.ok(releido.deletedAt !== null);

  const empresa = await createCompany(e.organizationId, e.userId, { name: "Empresa sin nada" });
  await deleteCompany(e.organizationId, empresa.id);
});

// ---------------------------------------------------------------------------
// Ítem 156 — el pipeline por defecto existe y tiene etapas
// ---------------------------------------------------------------------------

test("ítem 156: el primer pipeline de una organización nace default aunque no se pida; el segundo no", async () => {
  const otra = await montar("primer-pipeline");
  try {
    const primero = await createPipeline(otra.organizationId, { name: "Primero" });
    const segundo = await createPipeline(otra.organizationId, { name: "Segundo" });
    assert.equal(primero.isDefault, true);
    assert.equal(segundo.isDefault, false);
  } finally {
    await prisma.pipeline.deleteMany({ where: { organizationId: otra.organizationId } });
    await desmontar(otra);
  }
});

test("ítem 156: no se marca default un pipeline sin etapas, ni se borra la última etapa del default", async () => {
  const vacio = await createPipeline(e.organizationId, { name: "Vacío" });
  assertAppError(
    await capturar(() => updatePipeline(e.organizationId, vacio.id, { isDefault: true })),
    409,
    PIPELINE_DEFAULT_SIN_ETAPAS,
  );

  const unico = await createPipeline(e.organizationId, { name: "Con una etapa" });
  const etapa = await createStage(e.organizationId, { pipelineId: unico.id, name: "Única" });
  await updatePipeline(e.organizationId, unico.id, { isDefault: true });
  assertAppError(
    await capturar(() => deleteStage(e.organizationId, etapa.id)),
    409,
    ULTIMA_ETAPA_DEL_DEFAULT,
  );

  // Con otro default marcado, la etapa se puede borrar.
  await updatePipeline(e.organizationId, pipelineId, { isDefault: true });
  await deleteStage(e.organizationId, etapa.id);
});

// ---------------------------------------------------------------------------
// Ítem 157 — ganar hace cliente al contacto
// ---------------------------------------------------------------------------

test("ítem 157: ganar la venta pasa el contacto a CUSTOMER, y reabrirla no lo degrada", async () => {
  const lead = await contacto({ lifecycleStage: "LEAD" });
  const opp = await oportunidad({ contactId: lead.id });
  await updateOpportunity(e.organizationId, e.userId, opp.id, { stageId: ganado });
  const cliente = await prisma.contact.findUniqueOrThrow({ where: { id: lead.id } });
  assert.equal(cliente.lifecycleStage, "CUSTOMER");

  await updateOpportunity(e.organizationId, e.userId, opp.id, { stageId: nuevo });
  const sigue = await prisma.contact.findUniqueOrThrow({ where: { id: lead.id } });
  assert.equal(sigue.lifecycleStage, "CUSTOMER");

  // Creada directamente como ganada, igual.
  const mql = await contacto({ lifecycleStage: "MQL" });
  await oportunidad({ contactId: mql.id, stageId: ganado, status: "WON" });
  const otro = await prisma.contact.findUniqueOrThrow({ where: { id: mql.id } });
  assert.equal(otro.lifecycleStage, "CUSTOMER");
});
