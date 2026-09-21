import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { prisma } from "../lib/prisma";
import { drenarOutbox } from "../workers/outboxWorker";
import {
  actividadesDe,
  crearRegla,
  crearUsuario,
  desmontar,
  ejecucionesDe,
  eventosDe,
  montar,
  type Escenario,
} from "./automation.test-helper";
import { crearRegistroDeAcciones, type RegistroDeAcciones } from "./automationActions";
import { configDeSeguimientoSchema } from "./automationActions/createFollowUpActivity";
import { registrarAutomatizaciones } from "./automationRegistrations";
import { TRIGGER_OPPORTUNITY_STALE, TRIGGER_OPPORTUNITY_WON } from "./automationTriggers";
import { createOpportunity, updateOpportunity } from "./opportunity.service";
import { crearRegistroDeHandlers, type RegistroDeHandlers } from "./outboxHandlers";

// ---------------------------------------------------------------------------
// El primer caso del motor, de punta a punta y contra Postgres real
// (docs/automations-architecture.md §7): updateOpportunity a WON -> evento
// opportunity.won en el outbox -> el worker lo entrega -> el dispatcher corre
// la regla -> queda la Activity de seguimiento. Y las negativas: WON -> WON no
// emite, OPEN -> LOST no emite, un reintento no duplica la Activity.
//
// LOS REGISTROS SON LOS DEL TEST, poblados con la MISMA función que usa
// server.ts (registrarAutomatizaciones) pero sobre registros creados con las
// factories: el camino evento -> despacho -> acción es el de producción, sin
// tocar los singletons. El drenado va acotado a la organización del test.
// ---------------------------------------------------------------------------

let e: Escenario;
let acciones: RegistroDeAcciones;
let handlers: RegistroDeHandlers;

before(async () => {
  e = await montar("won");
  acciones = crearRegistroDeAcciones();
  handlers = crearRegistroDeHandlers();
  registrarAutomatizaciones({ acciones, handlers });
});

after(async () => {
  if (e) await desmontar(e);
});

function drenar() {
  return drenarOutbox({ organizationId: e.organizationId, registro: handlers });
}

function oportunidad(extra: Record<string, unknown> = {}) {
  return createOpportunity(e.organizationId, e.userId, {
    title: "Interesado",
    pipelineId: e.pipelineId,
    stageId: e.stageId,
    companyId: e.companyId,
    ...extra,
  });
}

async function actividadesDeOportunidad(opportunityId: string) {
  return (await actividadesDe(e)).filter((a) => a.opportunityId === opportunityId);
}

async function eventosDeOportunidad(opportunityId: string) {
  return (await eventosDe(e)).filter(
    (evento) => (evento.payload as { opportunityId: string }).opportunityId === opportunityId,
  );
}

// ---------------------------------------------------------------------------
// Emisión: cuándo sí y cuándo no
// ---------------------------------------------------------------------------

test("registrarAutomatizaciones deja un handler por trigger conocido y las acciones del catálogo", () => {
  assert.deepEqual(handlers.tiposRegistrados(), [
    TRIGGER_OPPORTUNITY_STALE,
    TRIGGER_OPPORTUNITY_WON,
  ]);
  assert.deepEqual(acciones.tiposRegistrados(), [
    "activity.create_follow_up",
    "agent.draft_follow_up",
  ]);
});

test("registrarAutomatizaciones dos veces sobre los mismos registros LANZA: no es un reemplazo", () => {
  assert.throws(() => registrarAutomatizaciones({ acciones, handlers }), /registrar dos veces/);
});

test("OPEN -> WON emite UN evento opportunity.won con { opportunityId, ownerId } en la misma transacción que el cambio", async () => {
  const opp = await oportunidad();
  assert.equal((await eventosDeOportunidad(opp.id)).length, 0, "crear en OPEN no emite");

  const ganada = await updateOpportunity(e.organizationId, e.userId, opp.id, { status: "WON" });
  assert.equal(ganada.status, "WON");

  const eventos = await eventosDeOportunidad(opp.id);
  assert.equal(eventos.length, 1);
  assert.equal(eventos[0].eventType, "opportunity.won");
  assert.equal(eventos[0].status, "PENDING");
  assert.deepEqual(eventos[0].payload, { opportunityId: opp.id, ownerId: e.userId });
});

test("WON -> WON NO emite: un PATCH sobre una ya ganada, toque o no el status, no es una transición", async () => {
  const opp = await oportunidad();
  await updateOpportunity(e.organizationId, e.userId, opp.id, { status: "WON" });
  assert.equal((await eventosDeOportunidad(opp.id)).length, 1);

  await updateOpportunity(e.organizationId, e.userId, opp.id, { status: "WON" });
  await updateOpportunity(e.organizationId, e.userId, opp.id, { title: "Renombrada" });

  assert.equal((await eventosDeOportunidad(opp.id)).length, 1, "sigue habiendo un solo evento");
});

test("OPEN -> LOST no emite; LOST -> WON sí", async () => {
  const opp = await oportunidad();
  await updateOpportunity(e.organizationId, e.userId, opp.id, {
    status: "LOST",
    lostReason: "Precio",
  });
  assert.equal((await eventosDeOportunidad(opp.id)).length, 0);

  await updateOpportunity(e.organizationId, e.userId, opp.id, { status: "WON" });
  assert.equal((await eventosDeOportunidad(opp.id)).length, 1);
});

test("crear directamente con status WON emite el evento con el owner de la oportunidad creada", async () => {
  const otroUsuario = await crearUsuario(e, "owner-directo");
  const opp = await oportunidad({ status: "WON", ownerId: otroUsuario });

  const eventos = await eventosDeOportunidad(opp.id);
  assert.equal(eventos.length, 1);
  assert.deepEqual(eventos[0].payload, { opportunityId: opp.id, ownerId: otroUsuario });
});

test("un PATCH que reasigna y gana a la vez lleva en el payload al owner NUEVO", async () => {
  const nuevoOwner = await crearUsuario(e, "owner-nuevo");
  const opp = await oportunidad();

  await updateOpportunity(e.organizationId, e.userId, opp.id, {
    status: "WON",
    ownerId: nuevoOwner,
  });

  const eventos = await eventosDeOportunidad(opp.id);
  assert.equal(eventos.length, 1);
  assert.equal((eventos[0].payload as { ownerId: string }).ownerId, nuevoOwner);
});

test("dos PATCH a WON CONCURRENTES sobre la misma oportunidad emiten UN solo evento: la transición se decide bajo el lock de la fila", async () => {
  // Los dos leen OPEN antes de abrir su transacción; sin el lock, los dos
  // emitirían. Con él, el segundo espera al primero, relee WON y no emite —
  // sea cual sea el orden en que el scheduler los intercale.
  const opp = await oportunidad();

  const resultados = await Promise.allSettled([
    updateOpportunity(e.organizationId, e.userId, opp.id, { status: "WON" }),
    updateOpportunity(e.organizationId, e.userId, opp.id, { status: "WON" }),
  ]);
  assert.ok(
    resultados.every((r) => r.status === "fulfilled"),
    `los dos PATCH tienen que completar: ${JSON.stringify(resultados)}`,
  );

  assert.equal((await eventosDeOportunidad(opp.id)).length, 1);
});

test("un PATCH a WON que falla por validación no deja ni el cambio ni el evento", async () => {
  const opp = await oportunidad();

  // stageId de otro pipeline: validateStageId lo rechaza con 400 antes de
  // escribir nada. La oportunidad sigue OPEN y no hay evento.
  await assert.rejects(
    updateOpportunity(e.organizationId, e.userId, opp.id, {
      status: "WON",
      stageId: "00000000-0000-0000-0000-000000000000",
    }),
  );

  const fila = await prisma.opportunity.findUniqueOrThrow({ where: { id: opp.id } });
  assert.equal(fila.status, "OPEN");
  assert.equal((await eventosDeOportunidad(opp.id)).length, 0);
});

// ---------------------------------------------------------------------------
// El camino completo
// ---------------------------------------------------------------------------

test("flujo completo: updateOpportunity a WON -> evento -> worker -> Activity de seguimiento asignada al owner; un segundo drenado no la duplica", async () => {
  // Vacía los eventos que dejaron los tests de emisión de arriba: todavía no
  // había ninguna regla, así que se entregan sin efecto. Sin esto, el conteo
  // de `entregados` de abajo los incluiría.
  await drenar();

  const regla = await crearRegla(e, {
    actionConfig: { subject: "Llamar para agradecer la compra", daysUntilDue: 3 },
  });
  const opp = await oportunidad();

  await updateOpportunity(e.organizationId, e.userId, opp.id, { status: "WON" });

  const resumen = await drenar();
  assert.equal(resumen.entregados, 1);
  assert.equal(resumen.reprogramados + resumen.muertos + resumen.pospuestos, 0);

  const [evento] = await eventosDeOportunidad(opp.id);
  assert.equal(evento.status, "PROCESSED");

  const actividades = await actividadesDeOportunidad(opp.id);
  assert.equal(actividades.length, 1);
  assert.equal(actividades[0].type, "TASK");
  assert.equal(actividades[0].subject, "Llamar para agradecer la compra");
  // La regla no tiene `notes`: la tarea queda SIN notas, y eso es un null y no
  // un "" (el handler ni siquiera manda la clave `body`). Ítem 68.
  assert.equal(actividades[0].body, null);
  assert.equal(actividades[0].assigneeId, e.userId);
  assert.equal(actividades[0].authorId, e.userId);
  assert.ok(actividades[0].dueDate);

  const marcas = await ejecucionesDe(regla.id);
  const marca = marcas.find((m) => m.outboxEventId === evento.id);
  assert.ok(marca, "quedó la marca de ejecución para este evento");
  assert.equal(marca.status, "SUCCESS");

  // Nada más que entregar, y la Activity sigue siendo una.
  const segunda = await drenar();
  assert.equal(segunda.entregados + segunda.reprogramados + segunda.muertos, 0);
  assert.equal((await actividadesDeOportunidad(opp.id)).length, 1);

  await prisma.automation.update({ where: { id: regla.id }, data: { deletedAt: new Date() } });
});

test("una regla con notes deja esas notas en el body de la Activity creada", async () => {
  // El agujero que cerró el ítem 68: hasta acá la tarea que creaba una regla
  // no podía llevar ningún detalle más allá del título, porque el handler
  // nunca escribía Activity.body — el mismo campo que el formulario MANUAL de
  // actividades muestra bajo el rótulo "Notas".
  const notas = "Preguntar si quiere agendar el primer service y anotar la patente definitiva.";
  const regla = await crearRegla(e, {
    actionConfig: { subject: "Llamar para agradecer la compra", daysUntilDue: 2, notes: notas },
  });
  const opp = await oportunidad();

  await updateOpportunity(e.organizationId, e.userId, opp.id, { status: "WON" });
  await drenar();

  const actividades = await actividadesDeOportunidad(opp.id);
  assert.equal(actividades.length, 1);
  assert.equal(actividades[0].subject, "Llamar para agradecer la compra");
  // Tal cual, sin recortes ni prefijos: lo que se configuró es lo que se lee.
  assert.equal(actividades[0].body, notas);

  await prisma.automation.update({ where: { id: regla.id }, data: { deletedAt: new Date() } });
});

test("reintento tras un fallo de OTRA regla no duplica la Activity: la regla que ya tuvo éxito se salta", async () => {
  // Una segunda acción, solo en el registro de este test, que falla siempre.
  acciones.registrar({
    actionType: "test.siempre_falla",
    schema: configDeSeguimientoSchema,
    async handler() {
      throw new Error("el destino respondió 503");
    },
  });

  const reglaBuena = await crearRegla(e, {
    actionConfig: { subject: "Seguimiento", daysUntilDue: 1 },
  });
  const reglaRota = await crearRegla(e, {
    name: "Rota",
    actionType: "test.siempre_falla",
    actionConfig: { subject: "x", daysUntilDue: 1 },
  });
  const opp = await oportunidad();
  await updateOpportunity(e.organizationId, e.userId, opp.id, { status: "WON" });

  // Primer intento: la buena crea su Activity, la rota falla, el evento se
  // reprograma con el resumen del fallo.
  const primero = await drenar();
  assert.equal(primero.reprogramados, 1);
  assert.equal(primero.entregados, 0);
  assert.equal((await actividadesDeOportunidad(opp.id)).length, 1);

  const [evento] = await eventosDeOportunidad(opp.id);
  assert.equal(evento.status, "PENDING");
  assert.equal(evento.attempts, 1);
  assert.match(evento.lastError ?? "", /1 de 2 automatizaciones fallaron/);
  assert.match(evento.lastError ?? "", /el destino respondió 503/);

  const marcaBuena = (await ejecucionesDe(reglaBuena.id)).find(
    (m) => m.outboxEventId === evento.id,
  );
  const marcaRota = (await ejecucionesDe(reglaRota.id)).find((m) => m.outboxEventId === evento.id);
  assert.equal(marcaBuena?.status, "SUCCESS");
  assert.equal(marcaRota?.status, "FAILED");
  assert.equal(marcaRota?.error, "el destino respondió 503");

  // Se adelanta el reloj en vez de esperar el backoff: lo que se prueba es la
  // idempotencia, no el paso del tiempo.
  await prisma.outboxEvent.update({
    where: { id: evento.id },
    data: { nextAttemptAt: new Date(Date.now() - 1000) },
  });

  const segundo = await drenar();
  assert.equal(segundo.reprogramados, 1, "la rota sigue fallando");
  assert.equal(
    (await actividadesDeOportunidad(opp.id)).length,
    1,
    "la buena NO volvió a correr: sigue habiendo una sola Activity",
  );
  assert.equal((await ejecucionesDe(reglaBuena.id)).length, 1, "y una sola marca");

  await prisma.automation.updateMany({
    where: { id: { in: [reglaBuena.id, reglaRota.id] } },
    data: { deletedAt: new Date() },
  });
});

test("una regla inactiva no produce Activity aunque el evento se entregue", async () => {
  const regla = await crearRegla(e, { isActive: false });
  const opp = await oportunidad();
  await updateOpportunity(e.organizationId, e.userId, opp.id, { status: "WON" });

  const resumen = await drenar();
  assert.equal(resumen.entregados, 1, "el evento se entrega igual: tiene handler");
  assert.equal((await actividadesDeOportunidad(opp.id)).length, 0);
  assert.equal((await ejecucionesDe(regla.id)).length, 0);
});
