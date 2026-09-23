import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { prisma } from "../lib/prisma";
import { createOpportunity, getDashboardSummary, updateOpportunity } from "./opportunity.service";
import {
  ESTADO_NO_COINCIDE_CON_ETAPA,
  ETAPA_DE_CIERRE_SIN_ESTADO,
  hoyEnLaZona,
} from "./opportunityClosing";
import { createPipeline } from "./pipeline.service";
import {
  createStage,
  ETAPA_CON_OPORTUNIDADES_NO_CAMBIA_CIERRE,
  updateStage,
} from "./stage.service";
import { assertAppError, capturar, desmontar, montar, type Escenario } from "./vehicle.test-helper";

// ---------------------------------------------------------------------------
// Ítem 154 de docs/matriz-de-datos-crm.md contra Postgres real: la etapa manda
// sobre el estado, la fecha de cierre acompaña al estado, y la marca de una
// etapa con oportunidades no cambia. Las reglas puras están en
// opportunityClosing.test.ts.
// ---------------------------------------------------------------------------

let e: Escenario;
let pipelineId: string;
let nuevo: string;
let ganado: string;
let perdido: string;
let companyId: string;
const TZ = "America/Montevideo";

before(async () => {
  e = await montar("cierre");
  await prisma.organization.update({ where: { id: e.organizationId }, data: { timezone: TZ } });
  const pipeline = await createPipeline(e.organizationId, { name: "Ventas" });
  pipelineId = pipeline.id;
  nuevo = (await createStage(e.organizationId, { pipelineId, name: "Nuevo" })).id;
  ganado = (await createStage(e.organizationId, { pipelineId, name: "Ganado", isWon: true })).id;
  perdido = (await createStage(e.organizationId, { pipelineId, name: "Perdido", isLost: true })).id;
  companyId = (
    await prisma.company.create({ data: { organizationId: e.organizationId, name: "Cliente" } })
  ).id;
});

after(async () => {
  if (!e) return;
  const where = { organizationId: e.organizationId };
  await prisma.opportunity.deleteMany({ where });
  await prisma.stage.deleteMany({ where });
  await prisma.pipeline.deleteMany({ where });
  await prisma.company.deleteMany({ where });
  await desmontar(e);
});

function oportunidad(extra: Record<string, unknown> = {}) {
  return createOpportunity(e.organizationId, e.userId, {
    title: "Interesado",
    pipelineId,
    stageId: nuevo,
    companyId,
    ...extra,
  });
}

const hoy = () => hoyEnLaZona(TZ).toISOString().slice(0, 10);
const dia = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null;

test("O1/O3: crear o mover con un estado que contradice la etapa es 400 y no escribe nada", async () => {
  assertAppError(
    await capturar(() => oportunidad({ status: "WON" })),
    400,
    ESTADO_NO_COINCIDE_CON_ETAPA,
  );
  assertAppError(
    await capturar(() => oportunidad({ stageId: ganado, status: "OPEN" })),
    400,
    ESTADO_NO_COINCIDE_CON_ETAPA,
  );
  assertAppError(
    await capturar(() => oportunidad({ stageId: ganado })),
    400,
    ETAPA_DE_CIERRE_SIN_ESTADO,
  );

  const opp = await oportunidad();
  assertAppError(
    await capturar(() =>
      updateOpportunity(e.organizationId, e.userId, opp.id, { stageId: perdido, status: "WON" }),
    ),
    400,
    ESTADO_NO_COINCIDE_CON_ETAPA,
  );
  const releida = await prisma.opportunity.findUniqueOrThrow({ where: { id: opp.id } });
  assert.equal(releida.status, "OPEN");
  assert.equal(releida.stageId, nuevo);
});

test("mover a una etapa de cierre sin mandar estado: gana o pierde, con la fecha de hoy en la zona de la organización", async () => {
  const opp = await oportunidad();
  const ganada = await updateOpportunity(e.organizationId, e.userId, opp.id, { stageId: ganado });
  assert.equal(ganada.status, "WON");
  assert.equal(dia(ganada.actualCloseDate), hoy());

  // Y el evento de automatización sale igual que si hubiera mandado status.
  const eventos = await prisma.outboxEvent.count({
    where: { organizationId: e.organizationId, eventType: "opportunity.won" },
  });
  assert.ok(eventos >= 1);
});

test("solo el estado (el camino del agente): la oportunidad se mueve a la etapa que lo significa", async () => {
  const opp = await oportunidad();
  const perdida = await updateOpportunity(e.organizationId, e.userId, opp.id, {
    status: "LOST",
    lostReason: "Precio",
  });
  assert.equal(perdida.stageId, perdido);
  assert.equal(perdida.lostReason, "Precio");
  assert.equal(dia(perdida.actualCloseDate), hoy());

  // Reabrir: vuelve a la primera etapa abierta y se limpian fecha y motivo.
  const reabierta = await updateOpportunity(e.organizationId, e.userId, opp.id, {
    status: "OPEN",
  });
  assert.equal(reabierta.stageId, nuevo);
  assert.equal(reabierta.actualCloseDate, null);
  assert.equal(reabierta.lostReason, null);
});

test("O2: una venta ganada sin fecha ya cuenta en el dashboard", async () => {
  const antes = await getDashboardSummary(e.organizationId, { granularity: "month" });
  await oportunidad({ stageId: ganado, status: "WON", amount: 500, currency: "USD" });
  const despues = await getDashboardSummary(e.organizationId, { granularity: "month" });
  assert.equal(despues.wonThisPeriod.count, antes.wonThisPeriod.count + 1);
});

test("una fila en drift de antes de la regla se guarda igual si no se toca estado ni etapa (§50)", async () => {
  const opp = await oportunidad();
  await prisma.opportunity.update({ where: { id: opp.id }, data: { status: "WON" } });
  // El formulario reenvía todo, incluida la misma etapa y el mismo estado.
  const guardada = await updateOpportunity(e.organizationId, e.userId, opp.id, {
    title: "Editada",
    stageId: nuevo,
    status: "WON",
  });
  assert.equal(guardada.title, "Editada");
  assert.equal(guardada.status, "WON");
  assert.equal(guardada.stageId, nuevo);
});

test("O9: cambiar si cierra una etapa con oportunidades es 409; vacía, se puede", async () => {
  const negociacion = await createStage(e.organizationId, { pipelineId, name: "Negociación" });
  const opp = await oportunidad({ stageId: negociacion.id });
  assertAppError(
    await capturar(() => updateStage(e.organizationId, negociacion.id, { isWon: true })),
    409,
    ETAPA_CON_OPORTUNIDADES_NO_CAMBIA_CIERRE,
  );
  // Renombrarla sí.
  await updateStage(e.organizationId, negociacion.id, { name: "En negociación" });

  await updateOpportunity(e.organizationId, e.userId, opp.id, { stageId: nuevo });
  const marcada = await updateStage(e.organizationId, negociacion.id, { isWon: true });
  assert.equal(marcada.isWon, true);
});
