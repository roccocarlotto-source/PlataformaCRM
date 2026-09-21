import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { prisma } from "../lib/prisma";
import { barrerOportunidadesEstancadas } from "../workers/opportunityStaleWorker";
import { drenarOutbox } from "../workers/outboxWorker";
import {
  actividadesDe,
  crearRegla,
  desmontar,
  ejecucionesDe,
  eventosDe,
  montar,
  type Escenario,
} from "./automation.test-helper";
import { crearRegistroDeAcciones, type RegistroDeAcciones } from "./automationActions";
import { ACTION_DRAFT_FOLLOW_UP } from "./automationActions/draftFollowUpMessage";
import { registrarAutomatizaciones } from "./automationRegistrations";
import { TRIGGER_OPPORTUNITY_STALE } from "./automationTriggers";
import {
  resetLlmProviderParaTests,
  setLlmProviderForTests,
  type LlmCompletionRequest,
  type LlmProvider,
} from "./llmProvider.service";
import { createOpportunity } from "./opportunity.service";
import { crearRegistroDeHandlers, type RegistroDeHandlers } from "./outboxHandlers";

// ---------------------------------------------------------------------------
// El trigger opportunity.stale de punta a punta y contra Postgres real (ítem
// 76) — mismo espíritu que automationOpportunityWon.integration-test.ts: el
// barrido del worker emite el evento -> el worker del outbox lo entrega -> el
// dispatcher corre la regla -> agent.draft_follow_up le pide el borrador al
// modelo, crea la Activity y deja la marca anti-redraft.
//
// LO ÚNICO DOBLADO ES EL MODELO, instalado con setLlmProviderForTests (el
// handler no recibe el proveedor por parámetro: corre dentro del dispatcher,
// igual que en producción). Todo lo demás es real: la consulta del barrido, la
// cola, el despacho, la Activity y la columna.
//
// CADA TEST TRAE SU PROPIA ORGANIZACIÓN: un barrido emite para todas las
// estancadas de la organización y un drenado las despacha todas, así que
// compartirla mezclaría los casos (sobre todo el del modelo que falla).
// ---------------------------------------------------------------------------

const DIA = 24 * 60 * 60 * 1000;
const BORRADOR =
  "Hola, ¿cómo estás? Te escribo para retomar lo del Corolla gris. ¿Lo seguís pensando?";

let acciones: RegistroDeAcciones;
let handlers: RegistroDeHandlers;
const escenarios: Escenario[] = [];

before(() => {
  acciones = crearRegistroDeAcciones();
  handlers = crearRegistroDeHandlers();
  registrarAutomatizaciones({ acciones, handlers });
});

after(async () => {
  resetLlmProviderParaTests();
  await desmontar(...escenarios);
});

async function escenario(etiqueta: string): Promise<Escenario> {
  const e = await montar(etiqueta);
  escenarios.push(e);
  return e;
}

interface Doble {
  requests: LlmCompletionRequest[];
  falla: boolean;
}

function instalarModelo(): Doble {
  const doble: Doble = { requests: [], falla: false };
  const proveedor: LlmProvider = {
    name: "doble",
    complete(request) {
      doble.requests.push(request);
      if (doble.falla) {
        return Promise.reject(new Error("OpenRouter respondió 503"));
      }
      return Promise.resolve({ text: `"${BORRADOR}"`, toolCalls: [] });
    },
  };
  setLlmProviderForTests(proveedor);
  return doble;
}

function reglaEstancada(e: Escenario, dias: number) {
  return crearRegla(e, {
    name: "Seguimiento de estancadas",
    triggerType: TRIGGER_OPPORTUNITY_STALE,
    triggerConfig: { daysWithoutActivity: dias },
    actionType: ACTION_DRAFT_FOLLOW_UP,
    actionConfig: {},
  });
}

function barrer(e: Escenario, dias: number) {
  return barrerOportunidadesEstancadas({
    organizationId: e.organizationId,
    ahora: new Date(Date.now() + dias * DIA),
  });
}

function drenar(e: Escenario) {
  return drenarOutbox({ organizationId: e.organizationId, registro: handlers });
}

function leer(opportunityId: string) {
  return prisma.opportunity.findUniqueOrThrow({ where: { id: opportunityId } });
}

// Un contacto con DOS conversaciones: una vieja y una reciente, cada una con
// su hilo. El borrador tiene que usar la reciente y solo la reciente.
async function contactoConConversaciones(e: Escenario) {
  const branch = await prisma.branch.create({
    data: { organizationId: e.organizationId, name: "Centro", timezone: "America/Montevideo" },
  });
  const agent = await prisma.agent.create({
    data: {
      organizationId: e.organizationId,
      branchId: branch.id,
      name: "Vera",
      instructions: "Atendé consultas.",
      modelProvider: "openrouter",
      modelName: "test/model",
      enabledTools: [],
      guardrails: {},
      channels: ["WEB"],
    },
  });
  const contact = await prisma.contact.create({
    data: { organizationId: e.organizationId, firstName: "Ana", lastName: "Pérez" },
  });

  const conversaciones = [
    {
      lastMessageAt: new Date("2026-08-01T10:05:00.000Z"),
      mensajes: ["Quería saber de la Hilux vieja"],
    },
    {
      lastMessageAt: new Date("2026-09-01T10:05:00.000Z"),
      mensajes: ["¿Tienen el Corolla en gris?", "Sí, hay una unidad disponible."],
    },
  ];
  for (const datos of conversaciones) {
    const conversation = await prisma.conversation.create({
      data: {
        organizationId: e.organizationId,
        branchId: branch.id,
        agentId: agent.id,
        contactId: contact.id,
        channel: "WEB",
        status: "CLOSED",
        lastMessageAt: datos.lastMessageAt,
      },
    });
    await prisma.message.createMany({
      data: datos.mensajes.map((content, i) => ({
        organizationId: e.organizationId,
        conversationId: conversation.id,
        direction: i % 2 === 0 ? ("INBOUND" as const) : ("OUTBOUND" as const),
        senderType: i % 2 === 0 ? ("CONTACT" as const) : ("AGENT" as const),
        content,
        createdAt: new Date(datos.lastMessageAt.getTime() - (datos.mensajes.length - i) * 60_000),
      })),
    });
  }
  return contact.id;
}

test("flujo completo: barrido -> evento -> outbox -> Activity con el borrador del modelo y la marca puesta; el día siguiente NO redacta otro", async () => {
  const e = await escenario("stale-e2e");
  const modelo = instalarModelo();
  const regla = await reglaEstancada(e, 5);
  const contactId = await contactoConConversaciones(e);
  const opp = await createOpportunity(e.organizationId, e.userId, {
    title: "Corolla 2024 gris",
    pipelineId: e.pipelineId,
    stageId: e.stageId,
    companyId: e.companyId,
    contactId,
    amount: 25000,
  });
  const antes = await leer(opp.id);

  // Seis días después: califica.
  const barrido = await barrer(e, 6);
  assert.equal(barrido.emitidos, 1);

  const resumen = await drenar(e);
  assert.equal(resumen.entregados, 1);
  assert.equal(resumen.reprogramados + resumen.muertos, 0);

  const [evento] = await eventosDe(e, TRIGGER_OPPORTUNITY_STALE);
  assert.equal(evento.status, "PROCESSED");
  const [marca] = await ejecucionesDe(regla.id);
  assert.equal(marca.status, "SUCCESS");

  // La Activity: el cuerpo es el texto del modelo (sin las comillas con las
  // que lo envolvió), para el dueño, venciendo hoy.
  const actividades = await actividadesDe(e);
  assert.equal(actividades.length, 1);
  assert.equal(actividades[0].type, "TASK");
  assert.equal(actividades[0].subject, "Seguimiento sugerido: Corolla 2024 gris");
  assert.equal(actividades[0].body, BORRADOR);
  assert.equal(actividades[0].assigneeId, e.userId);
  assert.equal(actividades[0].opportunityId, opp.id);
  assert.ok(actividades[0].dueDate);
  assert.equal(
    actividades[0].dueDate.toISOString().slice(0, 10),
    new Date().toISOString().slice(0, 10),
  );

  // Lo que vio el modelo: sin tools, con los datos de la oportunidad y el
  // transcript de la conversación MÁS RECIENTE del contacto — no la vieja.
  assert.equal(modelo.requests.length, 1);
  const [pedido] = modelo.requests;
  assert.deepEqual(pedido.tools, []);
  const contexto = pedido.messages[0].content ?? "";
  assert.match(contexto, /- Título: Corolla 2024 gris/);
  assert.match(contexto, /- Monto: 25000 USD/);
  assert.match(contexto, /Cliente: ¿Tienen el Corolla en gris\?/);
  assert.match(contexto, /Agente: Sí, hay una unidad disponible\./);
  assert.doesNotMatch(contexto, /Hilux/);
  assert.doesNotMatch(contexto, /Ana|Pérez/, "sin nombres propios del contacto");

  // La marca quedó puesta y updatedAt NO se movió: el último movimiento real
  // sigue siendo el de antes.
  const despues = await leer(opp.id);
  assert.ok(despues.lastStaleFollowUpDraftedAt);
  assert.ok(despues.lastStaleFollowUpDraftedAt > despues.updatedAt);
  assert.equal(despues.updatedAt.toISOString(), antes.updatedAt.toISOString());

  // Al día siguiente, y al mes: sigue quieta, pero ya tiene su borrador.
  assert.equal((await barrer(e, 7)).emitidos, 0);
  assert.equal((await barrer(e, 36)).emitidos, 0);
  const segundo = await drenar(e);
  assert.equal(segundo.entregados, 0);
  assert.equal((await actividadesDe(e)).length, 1);
  assert.equal(modelo.requests.length, 1, "no se volvió a llamar al modelo");
});

test("sin contacto (o sin conversaciones): el borrador se arma solo con los datos de la oportunidad", async () => {
  const e = await escenario("stale-sin-contacto");
  const modelo = instalarModelo();
  await reglaEstancada(e, 2);
  const opp = await createOpportunity(e.organizationId, e.userId, {
    title: "Flota de utilitarios",
    pipelineId: e.pipelineId,
    stageId: e.stageId,
    companyId: e.companyId,
  });

  await barrer(e, 3);
  await drenar(e);

  const actividades = await actividadesDe(e);
  assert.equal(actividades.length, 1);
  assert.equal(actividades[0].opportunityId, opp.id);
  assert.equal(actividades[0].body, BORRADOR);
  assert.match(modelo.requests[0].messages[0].content ?? "", /No hay ninguna conversación/);
});

test("si el modelo falla: ninguna Activity, la oportunidad SIN marcar y la regla FAILED; al reintentar con el modelo sano, se completa", async () => {
  const e = await escenario("stale-falla");
  const modelo = instalarModelo();
  modelo.falla = true;
  const regla = await reglaEstancada(e, 2);
  const opp = await createOpportunity(e.organizationId, e.userId, {
    title: "Camioneta para el campo",
    pipelineId: e.pipelineId,
    stageId: e.stageId,
    companyId: e.companyId,
  });

  await barrer(e, 3);
  const primero = await drenar(e);
  assert.equal(primero.reprogramados, 1);
  assert.equal(primero.entregados, 0);

  assert.equal((await actividadesDe(e)).length, 0, "ninguna Activity vacía");
  assert.equal((await leer(opp.id)).lastStaleFollowUpDraftedAt, null, "sin marca");

  const [evento] = await eventosDe(e, TRIGGER_OPPORTUNITY_STALE);
  assert.equal(evento.status, "PENDING");
  assert.match(evento.lastError ?? "", /OpenRouter respondió 503/);
  const [ejecucion] = await ejecucionesDe(regla.id);
  assert.equal(ejecucion.status, "FAILED");
  assert.equal(ejecucion.error, "OpenRouter respondió 503");

  // Sin marca, la oportunidad sigue calificando: la pasada de mañana la vuelve
  // a tomar. Y el reintento del outbox, con el modelo sano, la completa.
  modelo.falla = false;
  await prisma.outboxEvent.update({
    where: { id: evento.id },
    data: { nextAttemptAt: new Date(Date.now() - 1000) },
  });
  const segundo = await drenar(e);
  assert.equal(segundo.entregados, 1);

  const actividades = await actividadesDe(e);
  assert.equal(actividades.length, 1);
  assert.equal(actividades[0].body, BORRADOR);
  assert.ok((await leer(opp.id)).lastStaleFollowUpDraftedAt);
});

test("dos eventos para la misma oportunidad antes de despacharse (reinicio del servidor): un solo borrador", async () => {
  const e = await escenario("stale-duplicado");
  const modelo = instalarModelo();
  await reglaEstancada(e, 2);
  await createOpportunity(e.organizationId, e.userId, {
    title: "Sedán usado",
    pipelineId: e.pipelineId,
    stageId: e.stageId,
    companyId: e.companyId,
  });

  // Dos pasadas antes de que el outbox entregue nada — lo que pasa con un
  // deploy, que dispara una pasada inmediata al arrancar.
  await barrer(e, 3);
  await barrer(e, 3);
  assert.equal((await eventosDe(e, TRIGGER_OPPORTUNITY_STALE)).length, 2);

  const resumen = await drenar(e);
  assert.equal(resumen.entregados, 2, "los dos se entregan: el segundo sin efecto");

  assert.equal((await actividadesDe(e)).length, 1);
  assert.equal(modelo.requests.length, 1, "el segundo ni siquiera llama al modelo");
});
