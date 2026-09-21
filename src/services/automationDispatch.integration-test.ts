import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { prisma } from "../lib/prisma";
import {
  actividadesDe,
  crearRegla,
  desmontar,
  ejecucionesDe,
  emitir,
  eventoAEntregar,
  montar,
  type Escenario,
} from "./automation.test-helper";
import {
  crearRegistroDeAcciones,
  type AccionAEjecutar,
  type RegistroDeAcciones,
} from "./automationActions";
import { accionCrearActividadDeSeguimiento } from "./automationActions/createFollowUpActivity";
import { despacharAutomatizaciones } from "./automationDispatch.service";
import { TRIGGER_OPPORTUNITY_WON } from "./automationTriggers";
import { createOpportunity } from "./opportunity.service";

// ---------------------------------------------------------------------------
// El dispatcher contra Postgres real (docs/automations-architecture.md §6):
// qué reglas corren, cuáles se saltan en un reintento, qué marca queda y qué
// error sube. Se llama a despacharAutomatizaciones DIRECTO con el evento
// armado a mano, sin pasar por el worker — el camino completo (service ->
// outbox -> worker -> Activity) está en automationOpportunityWon.integration-
// test.ts.
//
// CADA TEST TRAE SU PROPIO REGISTRO DE ACCIONES, creado con la factory, con
// acciones de prueba que cuentan invocaciones. No se toca el singleton de
// producción. Un trigger de prueba distinto por test evita que las reglas de
// un caso se despachen en otro.
// ---------------------------------------------------------------------------

let e: Escenario;

before(async () => {
  e = await montar("dispatch");
});

after(async () => {
  if (e) await desmontar(e);
});

interface AccionContada {
  invocaciones: AccionAEjecutar[];
}

// Registra una acción de prueba que anota cada invocación y, opcionalmente,
// falla siempre.
function registrarContada(
  registro: RegistroDeAcciones,
  actionType: string,
  opciones: { falla?: string } = {},
): AccionContada {
  const contada: AccionContada = { invocaciones: [] };
  registro.registrar({
    actionType,
    schema: accionCrearActividadDeSeguimiento.schema,
    async handler(input) {
      contada.invocaciones.push(input);
      if (opciones.falla) {
        throw new Error(opciones.falla);
      }
    },
  });
  return contada;
}

const CONFIG = { subject: "Seguimiento", daysUntilDue: 2 };

async function despachar(registro: RegistroDeAcciones, triggerType: string, payload = {}) {
  const fila = await emitir(e, triggerType, payload);
  const evento = eventoAEntregar(fila);
  return { evento, correr: () => despacharAutomatizaciones(evento, triggerType, { registro }) };
}

// ---------------------------------------------------------------------------
// Qué reglas corren
// ---------------------------------------------------------------------------

test("varias reglas activas para el mismo trigger disparan todas, cada una con su marca SUCCESS y el payload del evento", async () => {
  const registro = crearRegistroDeAcciones();
  const a = registrarContada(registro, "test.a");
  const b = registrarContada(registro, "test.b");
  const trigger = "test.varias";

  const reglaA = await crearRegla(e, {
    triggerType: trigger,
    actionType: "test.a",
    actionConfig: CONFIG,
  });
  const reglaB = await crearRegla(e, {
    triggerType: trigger,
    actionType: "test.b",
    actionConfig: CONFIG,
  });

  const { evento, correr } = await despachar(registro, trigger, { opportunityId: "opp-1" });
  await correr();

  assert.equal(a.invocaciones.length, 1);
  assert.equal(b.invocaciones.length, 1);
  assert.deepEqual(a.invocaciones[0], {
    organizationId: e.organizationId,
    config: CONFIG,
    payload: { opportunityId: "opp-1" },
  });

  for (const regla of [reglaA, reglaB]) {
    const marcas = await ejecucionesDe(regla.id);
    assert.equal(marcas.length, 1);
    assert.equal(marcas[0].status, "SUCCESS");
    assert.equal(marcas[0].error, null);
    assert.equal(marcas[0].outboxEventId, evento.id);
    assert.equal(marcas[0].organizationId, e.organizationId);
  }
});

test("una regla inactiva o soft-deleted no dispara y no deja marca", async () => {
  const registro = crearRegistroDeAcciones();
  const contada = registrarContada(registro, "test.apagada");
  const trigger = "test.inactivas";

  const inactiva = await crearRegla(e, {
    triggerType: trigger,
    actionType: "test.apagada",
    actionConfig: CONFIG,
    isActive: false,
  });
  const borrada = await crearRegla(e, {
    triggerType: trigger,
    actionType: "test.apagada",
    actionConfig: CONFIG,
    deletedAt: new Date(),
  });

  const { correr } = await despachar(registro, trigger);
  await correr();

  assert.equal(contada.invocaciones.length, 0);
  assert.equal((await ejecucionesDe(inactiva.id)).length, 0);
  assert.equal((await ejecucionesDe(borrada.id)).length, 0);
});

test("una regla de OTRA organización para el mismo trigger no dispara con el evento de ésta", async () => {
  const otra = await montar("dispatch-otra");
  try {
    const registro = crearRegistroDeAcciones();
    const contada = registrarContada(registro, "test.ajena");
    const trigger = "test.scoping";

    const ajena = await crearRegla(otra, {
      triggerType: trigger,
      actionType: "test.ajena",
      actionConfig: CONFIG,
    });

    const { correr } = await despachar(registro, trigger);
    await correr();

    assert.equal(contada.invocaciones.length, 0);
    assert.equal((await ejecucionesDe(ajena.id)).length, 0);
  } finally {
    await desmontar(otra);
  }
});

test("sin reglas para el trigger, el despacho es un no-op que no lanza", async () => {
  const registro = crearRegistroDeAcciones();
  const { correr } = await despachar(registro, "test.sin_reglas");
  await correr();
});

// ---------------------------------------------------------------------------
// Idempotencia frente al reintento del evento
// ---------------------------------------------------------------------------

test("reintento: la regla con SUCCESS sembrado se salta, la que tenía FAILED se reintenta y pasa a SUCCESS", async () => {
  const registro = crearRegistroDeAcciones();
  const yaHecha = registrarContada(registro, "test.ya_hecha");
  const pendiente = registrarContada(registro, "test.pendiente");
  const trigger = "test.reintento";

  const reglaHecha = await crearRegla(e, {
    triggerType: trigger,
    actionType: "test.ya_hecha",
    actionConfig: CONFIG,
  });
  const reglaPendiente = await crearRegla(e, {
    triggerType: trigger,
    actionType: "test.pendiente",
    actionConfig: CONFIG,
  });

  const { evento, correr } = await despachar(registro, trigger);

  // El estado que deja un primer intento donde la primera regla anduvo y la
  // segunda no: es exactamente lo que el outbox va a volver a entregar.
  await prisma.automationExecution.createMany({
    data: [
      {
        organizationId: e.organizationId,
        automationId: reglaHecha.id,
        outboxEventId: evento.id,
        status: "SUCCESS",
      },
      {
        organizationId: e.organizationId,
        automationId: reglaPendiente.id,
        outboxEventId: evento.id,
        status: "FAILED",
        error: "falló la primera vez",
      },
    ],
  });

  await correr();

  assert.equal(yaHecha.invocaciones.length, 0, "la regla con SUCCESS no se re-ejecuta");
  assert.equal(pendiente.invocaciones.length, 1, "la regla con FAILED sí se reintenta");

  const marcasHecha = await ejecucionesDe(reglaHecha.id);
  assert.equal(marcasHecha.length, 1, "sigue habiendo UNA marca por (regla, evento)");
  assert.equal(marcasHecha[0].status, "SUCCESS");

  const marcasPendiente = await ejecucionesDe(reglaPendiente.id);
  assert.equal(marcasPendiente.length, 1);
  assert.equal(marcasPendiente[0].status, "SUCCESS", "FAILED -> SUCCESS en la misma fila");
  assert.equal(marcasPendiente[0].error, null, "el error viejo se limpia");
});

// ---------------------------------------------------------------------------
// Fallos
// ---------------------------------------------------------------------------

test("un fallo de acción se PROPAGA (no se traga), deja FAILED con el error, y las demás reglas del evento igual corren", async () => {
  const registro = crearRegistroDeAcciones();
  const rota = registrarContada(registro, "test.rota", { falla: "el destino respondió 503" });
  const sana = registrarContada(registro, "test.sana");
  const trigger = "test.fallo";

  // La rota se crea PRIMERO para que sea la primera en el orden de despacho
  // (createdAt asc): si el dispatcher cortara en el primer fallo, la sana no
  // correría.
  const reglaRota = await crearRegla(e, {
    triggerType: trigger,
    actionType: "test.rota",
    actionConfig: CONFIG,
  });
  const reglaSana = await crearRegla(e, {
    triggerType: trigger,
    actionType: "test.sana",
    actionConfig: CONFIG,
  });

  const { correr } = await despachar(registro, trigger);

  await assert.rejects(correr, (err: unknown) => {
    assert.ok(err instanceof Error);
    assert.match(err.message, /1 de 2 automatizaciones fallaron/);
    assert.match(err.message, /el destino respondió 503/);
    assert.match(err.message, new RegExp(reglaRota.id));
    return true;
  });

  assert.equal(rota.invocaciones.length, 1);
  assert.equal(sana.invocaciones.length, 1, "la sana corrió aunque la rota fallara antes");

  const marcasRota = await ejecucionesDe(reglaRota.id);
  assert.equal(marcasRota[0].status, "FAILED");
  assert.equal(marcasRota[0].error, "el destino respondió 503");

  const marcasSana = await ejecucionesDe(reglaSana.id);
  assert.equal(marcasSana[0].status, "SUCCESS");
});

test("un actionType sin acción registrada es un fallo de ESA regla: FAILED con el motivo, y se propaga", async () => {
  const registro = crearRegistroDeAcciones();
  const trigger = "test.sin_accion";
  const regla = await crearRegla(e, {
    triggerType: trigger,
    actionType: "test.inexistente",
    actionConfig: CONFIG,
  });

  const { correr } = await despachar(registro, trigger);
  await assert.rejects(correr, /no hay acción registrada para "test\.inexistente"/);

  const marcas = await ejecucionesDe(regla.id);
  assert.equal(marcas[0].status, "FAILED");
  assert.match(marcas[0].error ?? "", /no hay acción registrada/);
});

test("un actionConfig guardado que ya no pasa el schema de la acción falla legible, no con un TypeError", async () => {
  const registro = crearRegistroDeAcciones();
  const contada = registrarContada(registro, "test.estricta");
  const trigger = "test.config_vieja";
  const regla = await crearRegla(e, {
    triggerType: trigger,
    actionType: "test.estricta",
    // Sin daysUntilDue: la forma que tendría una regla guardada antes de que
    // el schema lo exigiera.
    actionConfig: { subject: "Seguimiento" },
  });

  const { correr } = await despachar(registro, trigger);
  await assert.rejects(correr, /ya no pasa el schema de "test\.estricta".*daysUntilDue/);

  assert.equal(contada.invocaciones.length, 0, "el handler no corre con un config inválido");
  assert.equal((await ejecucionesDe(regla.id))[0].status, "FAILED");
});

test("un payload que no es un objeto JSON falla legible", async () => {
  const registro = crearRegistroDeAcciones();
  const contada = registrarContada(registro, "test.payload");
  const trigger = "test.payload_raro";
  await crearRegla(e, { triggerType: trigger, actionType: "test.payload", actionConfig: CONFIG });

  const fila = await emitir(e, trigger, ["no", "es", "un", "objeto"]);
  await assert.rejects(
    () => despacharAutomatizaciones(eventoAEntregar(fila), trigger, { registro }),
    /no es un objeto JSON/,
  );
  assert.equal(contada.invocaciones.length, 0);
});

// ---------------------------------------------------------------------------
// La acción real: activity.create_follow_up
// ---------------------------------------------------------------------------

test("activity.create_follow_up crea la Activity con los campos esperados: TASK, asignada y firmada por el owner, colgada de la oportunidad, con vencimiento a N días", async () => {
  const registro = crearRegistroDeAcciones();
  registro.registrar(accionCrearActividadDeSeguimiento);

  const opp = await createOpportunity(e.organizationId, e.userId, {
    title: "Interesado",
    pipelineId: e.pipelineId,
    stageId: e.stageId,
    companyId: e.companyId,
  });
  const regla = await crearRegla(e, {
    actionConfig: { subject: "Llamar para agradecer la compra", daysUntilDue: 3 },
  });

  const antes = Date.now();
  const { correr } = await despachar(registro, TRIGGER_OPPORTUNITY_WON, {
    opportunityId: opp.id,
    ownerId: opp.ownerId,
  });
  await correr();

  const actividades = (await actividadesDe(e)).filter((a) => a.opportunityId === opp.id);
  assert.equal(actividades.length, 1);
  const actividad = actividades[0];
  assert.equal(actividad.type, "TASK");
  assert.equal(actividad.subject, "Llamar para agradecer la compra");
  assert.equal(actividad.assigneeId, opp.ownerId);
  assert.equal(actividad.authorId, opp.ownerId);
  assert.equal(actividad.opportunityId, opp.id);
  assert.equal(actividad.companyId, null);
  assert.equal(actividad.contactId, null);
  assert.equal(actividad.completedAt, null);
  assert.ok(actividad.dueDate, "tiene fecha de vencimiento");
  const tresDias = 3 * 24 * 60 * 60 * 1000;
  const margen = 60 * 1000;
  assert.ok(
    actividad.dueDate.getTime() >= antes + tresDias - margen &&
      actividad.dueDate.getTime() <= Date.now() + tresDias + margen,
    `dueDate ${actividad.dueDate.toISOString()} no está a ~3 días`,
  );

  assert.equal((await ejecucionesDe(regla.id))[0].status, "SUCCESS");
});

test("una regla guardada con una acción que NO admite su trigger queda FAILED sin ejecutar la acción (defensa en profundidad del ítem 76)", async () => {
  // Directo en la base, salteando el CRUD que la rechazaría con 400: es el
  // caso de una acción que restringe sus triggers DESPUÉS de que la regla
  // existe. activity.create_follow_up colgada de opportunity.stale es
  // exactamente la combinación que crearía una tarea diaria infinita.
  const registro = crearRegistroDeAcciones();
  registro.registrar(accionCrearActividadDeSeguimiento);
  const regla = await crearRegla(e, { triggerType: "opportunity.stale" });

  const cuantasAntes = (await actividadesDe(e)).length;
  const { correr } = await despachar(registro, "opportunity.stale", {
    opportunityId: randomUUID(),
    ownerId: e.userId,
  });
  await assert.rejects(
    correr,
    /"activity\.create_follow_up" no se puede usar con el trigger "opportunity\.stale"/,
  );

  assert.equal((await actividadesDe(e)).length, cuantasAntes);
  const [marca] = await ejecucionesDe(regla.id);
  assert.equal(marca.status, "FAILED");
  await prisma.automation.update({ where: { id: regla.id }, data: { deletedAt: new Date() } });
});

test("activity.create_follow_up con un payload sin ownerId válido falla legible y no crea nada", async () => {
  const registro = crearRegistroDeAcciones();
  // Una copia SIN la restricción de triggers (ítem 76): la acción real solo
  // admite opportunity.won, y con un trigger de prueba el dispatcher la
  // frenaría por compatibilidad antes de llegar al payload, que es lo que este
  // caso prueba.
  registro.registrar({ ...accionCrearActividadDeSeguimiento, triggers: undefined });
  const trigger = "test.payload_incompleto";
  const regla = await crearRegla(e, { triggerType: trigger });

  const cuantasAntes = (await actividadesDe(e)).length;
  const { correr } = await despachar(registro, trigger, { opportunityId: "no-es-uuid" });
  await assert.rejects(correr, /payload\.opportunityId debe ser un UUID/);

  assert.equal((await actividadesDe(e)).length, cuantasAntes);
  assert.equal((await ejecucionesDe(regla.id))[0].status, "FAILED");
});
