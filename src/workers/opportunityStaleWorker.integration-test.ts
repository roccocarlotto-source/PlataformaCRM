import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { prisma } from "../lib/prisma";
import { markStaleFollowUpDrafted } from "../repositories/opportunity.repository";
import {
  crearRegla,
  desmontar,
  eventosDe,
  montar,
  type Escenario,
} from "../services/automation.test-helper";
import { ACTION_DRAFT_FOLLOW_UP } from "../services/automationActions/draftFollowUpMessage";
import { TRIGGER_OPPORTUNITY_STALE } from "../services/automationTriggers";
import {
  createOpportunity,
  deleteOpportunity,
  updateOpportunity,
} from "../services/opportunity.service";
import { barrerOportunidadesEstancadas } from "./opportunityStaleWorker";

// ---------------------------------------------------------------------------
// El barrido del trigger opportunity.stale (ítem 76) contra Postgres real: qué
// oportunidades califican y, sobre todo, EL ANTI-REDRAFT — que una oportunidad
// ya drafteada y sin movimiento posterior no vuelva a emitir, y que una que sí
// se movió y volvió a estancarse, sí.
//
// EL RELOJ SE ADELANTA con la opción `ahora` en vez de retroceder updatedAt:
// las oportunidades se crean con su updatedAt real, y "pasaron ocho días" es
// barrer con ahora + 8 días. Así ningún test escribe updatedAt a mano, que es
// justo la columna cuyo comportamiento se está probando.
//
// El barrido va acotado a la organización del test (el runner corre archivos
// en paralelo contra una base compartida), y los eventos se cuentan por
// oportunidad: cada barrido emite para TODAS las estancadas de la
// organización, incluidas las de tests anteriores de este archivo.
// ---------------------------------------------------------------------------

const DIA = 24 * 60 * 60 * 1000;

let e: Escenario;

before(async () => {
  e = await montar("stale-worker");
});

after(async () => {
  if (e) await desmontar(e);
});

function enDias(dias: number): Date {
  return new Date(Date.now() + dias * DIA);
}

function barrer(ahora: Date) {
  return barrerOportunidadesEstancadas({ organizationId: e.organizationId, ahora });
}

function oportunidad(extra: Record<string, unknown> = {}) {
  return createOpportunity(e.organizationId, e.userId, {
    title: "Interesado en el Corolla",
    pipelineId: e.pipelineId,
    stageId: e.stageId,
    companyId: e.companyId,
    ...extra,
  });
}

async function eventosDeOportunidad(opportunityId: string) {
  return (await eventosDe(e, TRIGGER_OPPORTUNITY_STALE)).filter(
    (evento) => (evento.payload as { opportunityId: string }).opportunityId === opportunityId,
  );
}

function reglaEstancada(dias: number, extra: Record<string, unknown> = {}) {
  return crearRegla(e, {
    name: "Seguimiento de estancadas",
    triggerType: TRIGGER_OPPORTUNITY_STALE,
    triggerConfig: { daysWithoutActivity: dias },
    actionType: ACTION_DRAFT_FOLLOW_UP,
    actionConfig: {},
    ...extra,
  });
}

test("sin ninguna regla de opportunity.stale el barrido no mira ninguna oportunidad", async () => {
  const opp = await oportunidad();

  const resumen = await barrer(enDias(30));

  assert.deepEqual(resumen, { organizaciones: 0, emitidos: 0, fallidas: 0 });
  assert.equal((await eventosDeOportunidad(opp.id)).length, 0);
});

test("una regla INACTIVA o BORRADA tampoco dispara nada", async () => {
  const inactiva = await reglaEstancada(1, { isActive: false });
  const borrada = await reglaEstancada(1, { deletedAt: new Date() });
  const opp = await oportunidad();

  const resumen = await barrer(enDias(30));

  assert.equal(resumen.organizaciones, 0);
  assert.equal((await eventosDeOportunidad(opp.id)).length, 0);
  await prisma.automation.deleteMany({ where: { id: { in: [inactiva.id, borrada.id] } } });
});

test("con la regla activa: emite recién cuando se cumplen los días, con { opportunityId, ownerId }", async () => {
  const regla = await reglaEstancada(7);
  const opp = await oportunidad();

  // Recién creada: no está estancada.
  await barrer(new Date());
  assert.equal((await eventosDeOportunidad(opp.id)).length, 0, "hoy no");

  // Seis días: todavía no.
  await barrer(enDias(6));
  assert.equal((await eventosDeOportunidad(opp.id)).length, 0, "a los 6 días no");

  // Ocho días: sí, y una sola vez.
  const resumen = await barrer(enDias(8));
  assert.equal(resumen.organizaciones, 1);
  assert.ok(resumen.emitidos >= 1);

  const eventos = await eventosDeOportunidad(opp.id);
  assert.equal(eventos.length, 1);
  assert.equal(eventos[0].eventType, "opportunity.stale");
  assert.equal(eventos[0].status, "PENDING");
  assert.deepEqual(eventos[0].payload, { opportunityId: opp.id, ownerId: e.userId });

  await prisma.automation.update({ where: { id: regla.id }, data: { deletedAt: new Date() } });
});

test("solo OPEN y no borradas: una ganada, una perdida y una borrada no emiten aunque lleven meses quietas", async () => {
  const regla = await reglaEstancada(1);
  const ganada = await oportunidad({ status: "WON" });
  const perdida = await oportunidad({ status: "LOST", lostReason: "Precio" });
  const borrada = await oportunidad();
  await deleteOpportunity(e.organizationId, e.userId, borrada.id);
  const abierta = await oportunidad();

  await barrer(enDias(90));

  assert.equal((await eventosDeOportunidad(ganada.id)).length, 0, "ganada");
  assert.equal((await eventosDeOportunidad(perdida.id)).length, 0, "perdida");
  assert.equal((await eventosDeOportunidad(borrada.id)).length, 0, "borrada");
  assert.equal((await eventosDeOportunidad(abierta.id)).length, 1, "la abierta sí");

  await prisma.automation.update({ where: { id: regla.id }, data: { deletedAt: new Date() } });
});

// ---------------------------------------------------------------------------
// EL ANTI-REDRAFT
// ---------------------------------------------------------------------------

test("ya drafteada y SIN movimiento posterior: NO vuelve a emitir, por más días que pasen", async () => {
  const regla = await reglaEstancada(3);
  const opp = await oportunidad();
  const fila = await prisma.opportunity.findUniqueOrThrow({ where: { id: opp.id } });

  // El borrador se redactó después del último movimiento.
  await markStaleFollowUpDrafted(
    opp.id,
    e.organizationId,
    new Date(fila.updatedAt.getTime() + 1000),
  );

  for (const dias of [4, 30, 365]) {
    await barrer(enDias(dias));
  }
  assert.equal((await eventosDeOportunidad(opp.id)).length, 0);

  // Y la marca NO movió updatedAt: la escritura es cruda a propósito.
  const despues = await prisma.opportunity.findUniqueOrThrow({ where: { id: opp.id } });
  assert.equal(despues.updatedAt.toISOString(), fila.updatedAt.toISOString());
  assert.equal(
    despues.lastStaleFollowUpDraftedAt?.toISOString(),
    new Date(fila.updatedAt.getTime() + 1000).toISOString(),
    "la marca queda con el valor exacto, en UTC",
  );

  await prisma.automation.update({ where: { id: regla.id }, data: { deletedAt: new Date() } });
});

test("una marca IGUAL a updatedAt cuenta como ya drafteada (la comparación es estricta)", async () => {
  const regla = await reglaEstancada(3);
  const opp = await oportunidad();
  const fila = await prisma.opportunity.findUniqueOrThrow({ where: { id: opp.id } });

  await markStaleFollowUpDrafted(opp.id, e.organizationId, fila.updatedAt);
  await barrer(enDias(10));

  assert.equal((await eventosDeOportunidad(opp.id)).length, 0);
  await prisma.automation.update({ where: { id: regla.id }, data: { deletedAt: new Date() } });
});

test("con movimiento DESPUÉS del último borrador y vuelta a estancarse: SÍ vuelve a emitir", async () => {
  const regla = await reglaEstancada(3);
  const opp = await oportunidad();
  const fila = await prisma.opportunity.findUniqueOrThrow({ where: { id: opp.id } });
  // La marca en el mismo instante que el último movimiento (cuenta como
  // drafteada, ver el test de arriba) y no en el futuro: el movimiento de
  // abajo tiene que quedar DESPUÉS de ella, como pasa en la vida real.
  await markStaleFollowUpDrafted(opp.id, e.organizationId, fila.updatedAt);

  await barrer(enDias(10));
  assert.equal((await eventosDeOportunidad(opp.id)).length, 0, "drafteada: nada");

  // Un movimiento real, aunque sea cambiarle el monto. updatedAt pasa a
  // "ahora", que es posterior a la marca. La espera corta garantiza que caiga
  // en otro milisegundo aunque todo lo anterior haya corrido en el mismo.
  await new Promise((resolve) => setTimeout(resolve, 5));
  await updateOpportunity(e.organizationId, e.userId, opp.id, { amount: 31000 });

  // Recién movida: no está estancada todavía.
  await barrer(enDias(1));
  assert.equal((await eventosDeOportunidad(opp.id)).length, 0, "recién movida: nada");

  // Vuelve a estancarse: ahora sí corresponde otro borrador.
  await barrer(enDias(10));
  assert.equal((await eventosDeOportunidad(opp.id)).length, 1);

  await prisma.automation.update({ where: { id: regla.id }, data: { deletedAt: new Date() } });
});
