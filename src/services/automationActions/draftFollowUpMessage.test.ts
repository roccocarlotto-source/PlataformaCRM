import assert from "node:assert/strict";
import { test } from "node:test";
import type { Opportunity } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { accionAdmiteTrigger } from "../automationActions";
import { TRIGGER_OPPORTUNITY_STALE, TRIGGER_OPPORTUNITY_WON } from "../automationTriggers";
import type { CreateActivityInput } from "../activity.service";
import {
  ACTION_DRAFT_FOLLOW_UP,
  PREFIJO_DEL_ASUNTO,
  accionRedactarSeguimiento,
  asuntoDelBorrador,
  configDeBorradorSchema,
  crearAccionBorradorDeSeguimiento,
  type DependenciasDelBorrador,
} from "./draftFollowUpMessage";

// ---------------------------------------------------------------------------
// Unitarios, SIN BASE Y SIN RED: el handler de agent.draft_follow_up con sus
// dependencias dobladas. Lo que se afirma acá es el ORDEN —borrador ->
// Activity -> marca anti-redraft— y qué queda escrito cuando algo falla en el
// medio, que es la parte del ítem 76 que no puede fallar. El camino real contra
// Postgres vive en automationOpportunityStale.integration-test.ts.
// ---------------------------------------------------------------------------

const ORG = "11111111-1111-4111-8111-111111111111";
const OPP = "22222222-2222-4222-8222-222222222222";
const OWNER = "33333333-3333-4333-8333-333333333333";
const AHORA = new Date("2026-09-21T15:00:00.000Z");

function oportunidad(extra: Partial<Opportunity> = {}): Opportunity {
  return {
    id: OPP,
    organizationId: ORG,
    companyId: null,
    contactId: null,
    ownerId: OWNER,
    pipelineId: "p",
    stageId: "s",
    title: "Corolla 2024 para Ana",
    amount: new Prisma.Decimal(25000),
    currency: "USD",
    expectedCloseDate: null,
    actualCloseDate: null,
    status: "OPEN",
    lostReason: null,
    createdAt: new Date("2026-09-01T12:00:00.000Z"),
    updatedAt: new Date("2026-09-05T12:00:00.000Z"),
    deletedAt: null,
    vehicleId: null,
    financingType: null,
    leadSource: null,
    financingLender: null,
    financingDownPayment: null,
    financingInstallmentCount: null,
    financingInstallmentAmount: null,
    lastStaleFollowUpDraftedAt: null,
    ...extra,
  };
}

interface Registro {
  pasos: string[];
  actividades: { organizationId: string; actor: string; input: CreateActivityInput }[];
  marcas: { id: string; organizationId: string; cuando: Date }[];
}

function doblar(overrides: Partial<DependenciasDelBorrador> & { fila?: Opportunity | null } = {}): {
  deps: DependenciasDelBorrador;
  registro: Registro;
} {
  const registro: Registro = { pasos: [], actividades: [], marcas: [] };
  const fila = overrides.fila === undefined ? oportunidad() : overrides.fila;
  const deps: DependenciasDelBorrador = {
    leerOportunidad: (() => {
      registro.pasos.push("leer");
      return Promise.resolve(fila);
    }) as unknown as DependenciasDelBorrador["leerOportunidad"],
    generarBorrador: () => {
      registro.pasos.push("borrador");
      return Promise.resolve("Hola, ¿cómo estás? ¿Pudiste pensar lo del Corolla?");
    },
    crearActividad: ((organizationId: string, actor: string, input: CreateActivityInput) => {
      registro.pasos.push("actividad");
      registro.actividades.push({ organizationId, actor, input });
      return Promise.resolve({});
    }) as unknown as DependenciasDelBorrador["crearActividad"],
    marcarBorrador: (id, organizationId, cuando) => {
      registro.pasos.push("marca");
      registro.marcas.push({ id, organizationId, cuando });
      return Promise.resolve(1);
    },
    ahora: () => AHORA,
    ...overrides,
  };
  return { deps, registro };
}

function correr(deps: DependenciasDelBorrador, payload: Record<string, unknown> = {}) {
  return crearAccionBorradorDeSeguimiento(deps).handler({
    organizationId: ORG,
    config: {},
    payload: { opportunityId: OPP, ownerId: OWNER, ...payload },
  });
}

// ---------------------------------------------------------------------------
// Identidad de la acción
// ---------------------------------------------------------------------------

test("la acción registrada es agent.draft_follow_up, sin config propia y solo para opportunity.stale", () => {
  assert.equal(accionRedactarSeguimiento.actionType, ACTION_DRAFT_FOLLOW_UP);
  assert.equal(ACTION_DRAFT_FOLLOW_UP, "agent.draft_follow_up");
  assert.equal(accionRedactarSeguimiento.schema, configDeBorradorSchema);
  assert.deepEqual(configDeBorradorSchema.parse({}), {});
  // Una clave de más se descarta, no se guarda en la regla.
  assert.deepEqual(configDeBorradorSchema.parse({ daysWithoutActivity: 3 }), {});

  assert.equal(accionAdmiteTrigger(accionRedactarSeguimiento, TRIGGER_OPPORTUNITY_STALE), true);
  assert.equal(accionAdmiteTrigger(accionRedactarSeguimiento, TRIGGER_OPPORTUNITY_WON), false);
});

test("el asunto es 'Seguimiento sugerido: <título>' y nunca pasa de los 255 de Activity.subject", () => {
  assert.equal(asuntoDelBorrador("Corolla"), "Seguimiento sugerido: Corolla");
  const largo = asuntoDelBorrador("x".repeat(255));
  assert.equal(largo.length, 255);
  assert.ok(largo.startsWith(PREFIJO_DEL_ASUNTO));
});

// ---------------------------------------------------------------------------
// El camino feliz
// ---------------------------------------------------------------------------

test("crea UNA Activity TASK con el texto del modelo, asignada al dueño y venciendo hoy, y DESPUÉS marca la oportunidad", async () => {
  const { deps, registro } = doblar();

  await correr(deps);

  assert.deepEqual(registro.pasos, ["leer", "borrador", "actividad", "marca"]);

  assert.equal(registro.actividades.length, 1);
  const [{ organizationId, actor, input }] = registro.actividades;
  assert.equal(organizationId, ORG);
  assert.equal(actor, OWNER, "el dueño figura como autor, igual que activity.create_follow_up");
  assert.equal(input.type, "TASK");
  assert.equal(input.subject, "Seguimiento sugerido: Corolla 2024 para Ana");
  assert.equal(input.body, "Hola, ¿cómo estás? ¿Pudiste pensar lo del Corolla?");
  assert.equal(input.assigneeId, OWNER);
  assert.equal(input.opportunityId, OPP);
  assert.equal(input.dueDate?.toISOString(), AHORA.toISOString(), "vence hoy");

  assert.deepEqual(registro.marcas, [{ id: OPP, organizationId: ORG, cuando: AHORA }]);
});

test("una marca ANTERIOR al último movimiento no frena: hubo movimiento real después del último borrador", async () => {
  const { deps, registro } = doblar({
    fila: oportunidad({
      lastStaleFollowUpDraftedAt: new Date("2026-09-02T12:00:00.000Z"),
      updatedAt: new Date("2026-09-05T12:00:00.000Z"),
    }),
  });

  await correr(deps);

  assert.equal(registro.actividades.length, 1);
  assert.equal(registro.marcas.length, 1);
});

// ---------------------------------------------------------------------------
// Fallos: nada a medias
// ---------------------------------------------------------------------------

test("si el modelo falla: NO se crea Activity, NO se marca la oportunidad, y el error sube para que el outbox reintente", async () => {
  const { deps, registro } = doblar({
    generarBorrador: () => Promise.reject(new Error("OpenRouter respondió 503")),
  });

  await assert.rejects(correr(deps), /OpenRouter respondió 503/);

  assert.equal(registro.actividades.length, 0, "ninguna Activity vacía");
  assert.equal(registro.marcas.length, 0, "la oportunidad sigue sin marcar: mañana se reintenta");
});

test("si createActivity falla: la oportunidad NO queda marcada", async () => {
  const { deps, registro } = doblar({
    crearActividad: (() =>
      Promise.reject(
        new Error("assignee inactivo"),
      )) as unknown as DependenciasDelBorrador["crearActividad"],
  });

  await assert.rejects(correr(deps), /assignee inactivo/);
  assert.equal(registro.marcas.length, 0);
});

test("payload sin opportunityId o con ids que no son UUID falla con un mensaje legible, sin tocar nada", async () => {
  const { deps, registro } = doblar();

  await assert.rejects(
    crearAccionBorradorDeSeguimiento(deps).handler({
      organizationId: ORG,
      config: {},
      payload: { ownerId: OWNER },
    }),
  );
  await assert.rejects(correr(deps, { opportunityId: "no-es-uuid" }), /payload\.opportunityId/);

  assert.deepEqual(registro.pasos, [], "ni siquiera se leyó la oportunidad");
});

// ---------------------------------------------------------------------------
// Los tres casos que terminan sin efecto y SIN error
// ---------------------------------------------------------------------------

test("la oportunidad ya no existe (o está borrada): no se llama al modelo ni se escribe nada, y no es un fallo", async () => {
  const { deps, registro } = doblar({ fila: null });

  await correr(deps);

  assert.deepEqual(registro.pasos, ["leer"]);
});

test("la oportunidad ya no está OPEN (se ganó o se perdió entre el barrido y el despacho): nada", async () => {
  for (const status of ["WON", "LOST"] as const) {
    const { deps, registro } = doblar({ fila: oportunidad({ status }) });
    await correr(deps);
    assert.deepEqual(registro.pasos, ["leer"], status);
  }
});

test("ya hay un borrador posterior (o simultáneo) al último movimiento: un evento duplicado no redacta otro", async () => {
  const updatedAt = new Date("2026-09-05T12:00:00.000Z");
  for (const marca of [updatedAt, new Date("2026-09-10T12:00:00.000Z")]) {
    const { deps, registro } = doblar({
      fila: oportunidad({ updatedAt, lastStaleFollowUpDraftedAt: marca }),
    });
    await correr(deps);
    assert.deepEqual(registro.pasos, ["leer"], marca.toISOString());
  }
});
