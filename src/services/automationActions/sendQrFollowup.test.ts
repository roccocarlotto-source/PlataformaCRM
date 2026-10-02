import assert from "node:assert/strict";
import { test } from "node:test";
import { Prisma, type Opportunity, type QrCode } from "@prisma/client";
import type { AgendarQrFollowUpData } from "../../repositories/qrFollowUp.repository";
import { accionAdmiteTrigger } from "../automationActions";
import { TRIGGER_OPPORTUNITY_STALE, TRIGGER_OPPORTUNITY_WON } from "../automationTriggers";
import { MAX_DELAY_HOURS, MAX_DELAY_MINUTES } from "./demoraDelEnvio";
import {
  ACTION_SEND_QR_FOLLOWUP,
  configDeSeguimientoQrSchema,
  crearAccionSeguimientoQr,
  type DependenciasDelSeguimientoQr,
} from "./sendQrFollowup";

// ---------------------------------------------------------------------------
// La acción opportunity.send_qr_followup (ítem 159) sin base: las lecturas y
// el agendado son dobles. Lo que se prueba es la decisión —agenda, no agenda,
// o falla— y la hora del envío. Que el UNIQUE de la base convierta la
// reentrega en un no-op lo prueba qrFollowUpWorker.integration-test.ts contra
// Postgres real; acá se prueba que la acción trata ese "ya estaba" como éxito.
// ---------------------------------------------------------------------------

const ORG = "11111111-1111-4111-8111-111111111111";
const OPP = "22222222-2222-4222-8222-222222222222";
const OWNER = "33333333-3333-4333-8333-333333333333";
const CONTACTO = "44444444-4444-4444-8444-444444444444";
const QR = "55555555-5555-4555-8555-555555555555";
const REGLA = "66666666-6666-4666-8666-666666666666";
const AHORA = new Date("2026-09-25T15:00:00.000Z");

function oportunidad(extra: Partial<Opportunity> = {}): Opportunity {
  return {
    id: OPP,
    organizationId: ORG,
    companyId: null,
    contactId: CONTACTO,
    ownerId: OWNER,
    pipelineId: "p",
    stageId: "s",
    title: "Corolla 2024 para Ana",
    amount: new Prisma.Decimal(25000),
    currency: "USD",
    expectedCloseDate: null,
    actualCloseDate: null,
    status: "WON",
    lostReason: null,
    createdAt: AHORA,
    updatedAt: AHORA,
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

function qr(): QrCode {
  return {
    id: QR,
    organizationId: ORG,
    branchId: "77777777-7777-4777-8777-777777777777",
    displayNumber: 1,
    name: "Reseñas Google",
    message: null,
    destinationUrl: "https://g.page/r/abc/review",
    deletedAt: null,
    createdAt: AHORA,
  };
}

function doblar(
  opciones: {
    oportunidad?: Opportunity | null;
    qr?: QrCode | null;
    yaAgendado?: boolean;
  } = {},
) {
  const agendados: AgendarQrFollowUpData[] = [];
  const deps: DependenciasDelSeguimientoQr = {
    leerOportunidad: () =>
      Promise.resolve(opciones.oportunidad === undefined ? oportunidad() : opciones.oportunidad),
    leerQr: () => Promise.resolve(opciones.qr === undefined ? qr() : opciones.qr),
    agendar: (data) => {
      agendados.push(data);
      return Promise.resolve(!opciones.yaAgendado);
    },
    ahora: () => AHORA,
  };
  return { deps, agendados };
}

function correr(
  deps: DependenciasDelSeguimientoQr,
  demora: { delayMinutes: number } | { delayHours: number } = { delayMinutes: 48 * 60 },
) {
  return crearAccionSeguimientoQr(deps).handler({
    organizationId: ORG,
    automationId: REGLA,
    config: { qrCodeId: QR, ...demora },
    payload: { opportunityId: OPP, ownerId: OWNER },
  });
}

// ---------------------------------------------------------------------------
// Identidad y configuración
// ---------------------------------------------------------------------------

test("la acción se llama opportunity.send_qr_followup y solo admite opportunity.won", () => {
  const accion = crearAccionSeguimientoQr(doblar().deps);
  assert.equal(accion.actionType, ACTION_SEND_QR_FOLLOWUP);
  assert.equal(accionAdmiteTrigger(accion, TRIGGER_OPPORTUNITY_WON), true);
  assert.equal(accionAdmiteTrigger(accion, TRIGGER_OPPORTUNITY_STALE), false);
});

test("el schema exige qrCodeId UUID y la demora en minutos (o en horas, la clave legada) entre 0 y el tope", () => {
  for (const config of [
    { qrCodeId: QR, delayMinutes: 0 },
    { qrCodeId: QR, delayMinutes: MAX_DELAY_MINUTES },
    { qrCodeId: QR, delayHours: 0 },
    { qrCodeId: QR, delayHours: MAX_DELAY_HOURS },
  ]) {
    assert.ok(configDeSeguimientoQrSchema.safeParse(config).success, JSON.stringify(config));
  }

  const casos: [unknown, RegExp][] = [
    [{ delayMinutes: 1 }, /qrCodeId es requerido/],
    [{ qrCodeId: "no-es-uuid", delayMinutes: 1 }, /qrCodeId debe ser un UUID/],
    [{ qrCodeId: QR }, /delayMinutes es requerido/],
    [{ qrCodeId: QR, delayMinutes: 1.5 }, /delayMinutes debe ser un número entero/],
    [{ qrCodeId: QR, delayMinutes: MAX_DELAY_MINUTES + 1 }, /delayMinutes no puede superar/],
    [{ qrCodeId: QR, delayMinutes: 30, delayHours: 1 }, /no los dos/],
    [{ qrCodeId: QR, delayHours: 1.5 }, /delayHours debe ser un número entero/],
    [{ qrCodeId: QR, delayHours: "24" }, /delayHours debe ser un número entero/],
    [{ qrCodeId: QR, delayHours: -1 }, /delayHours no puede ser negativo/],
    [{ qrCodeId: QR, delayHours: MAX_DELAY_HOURS + 1 }, /delayHours no puede superar/],
  ];
  for (const [config, mensaje] of casos) {
    const resultado = configDeSeguimientoQrSchema.safeParse(config);
    assert.equal(resultado.success, false, JSON.stringify(config));
    assert.match(resultado.error?.issues.map((i) => i.message).join(", ") ?? "", mensaje);
  }
});

test("lo que se guarda es la salida del schema: siempre delayMinutes, nunca delayHours", () => {
  assert.deepEqual(configDeSeguimientoQrSchema.parse({ qrCodeId: QR, delayHours: 24 }), {
    qrCodeId: QR,
    delayMinutes: 1440,
  });
});

// ---------------------------------------------------------------------------
// Agendado
// ---------------------------------------------------------------------------

test("agenda UN envío con la regla, la oportunidad, su contacto, el QR y ahora + delayMinutes", async () => {
  const { deps, agendados } = doblar();

  await correr(deps, { delayMinutes: 48 * 60 });

  assert.deepEqual(agendados, [
    {
      organizationId: ORG,
      automationId: REGLA,
      opportunityId: OPP,
      contactId: CONTACTO,
      qrCodeId: QR,
      scheduledFor: new Date("2026-09-27T15:00:00.000Z"),
    },
  ]);
});

test("menos de una hora: delayMinutes 15 agenda a los 15 minutos", async () => {
  const { deps, agendados } = doblar();
  await correr(deps, { delayMinutes: 15 });
  assert.equal(agendados[0].scheduledFor.toISOString(), "2026-09-25T15:15:00.000Z");
});

test("una regla vieja con delayHours sigue agendando a ahora + esas horas", async () => {
  const { deps, agendados } = doblar();
  await correr(deps, { delayHours: 48 });
  assert.equal(agendados[0].scheduledFor.toISOString(), "2026-09-27T15:00:00.000Z");
});

test("si ya estaba agendado (reentrega del evento) no es un error: la acción termina bien", async () => {
  const { deps, agendados } = doblar({ yaAgendado: true });

  await correr(deps);

  assert.equal(agendados.length, 1);
});

test("un QR inexistente, borrado o de otra organización FALLA con un mensaje que manda a editar la regla", async () => {
  const { deps, agendados } = doblar({ qr: null });

  await assert.rejects(correr(deps), /QR .* no existe o está borrado: editá la automatización/);
  assert.equal(agendados.length, 0);
});

test("sin agendar ni fallar: la oportunidad borrada, ya no ganada, o sin contacto", async () => {
  for (const caso of [
    null,
    oportunidad({ status: "OPEN" }),
    oportunidad({ status: "LOST" }),
    oportunidad({ contactId: null, companyId: "88888888-8888-4888-8888-888888888888" }),
  ]) {
    const { deps, agendados } = doblar({ oportunidad: caso });
    await correr(deps);
    assert.equal(agendados.length, 0, JSON.stringify(caso?.status ?? null));
  }
});

test("payload o config inválidos fallan antes de leer o agendar nada", async () => {
  const { deps, agendados } = doblar();
  const accion = crearAccionSeguimientoQr(deps);

  await assert.rejects(
    accion.handler({
      organizationId: ORG,
      automationId: REGLA,
      config: { qrCodeId: QR, delayHours: 1 },
      payload: { opportunityId: "no-es-uuid", ownerId: OWNER },
    }),
    /payload\.opportunityId/,
  );
  await assert.rejects(
    accion.handler({
      organizationId: ORG,
      automationId: REGLA,
      config: { qrCodeId: QR },
      payload: { opportunityId: OPP, ownerId: OWNER },
    }),
  );
  assert.equal(agendados.length, 0);
});
