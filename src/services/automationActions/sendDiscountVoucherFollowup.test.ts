import assert from "node:assert/strict";
import { test } from "node:test";
import { Prisma, type Branch, type Opportunity } from "@prisma/client";
import type { AgendarDiscountVoucherFollowUpData } from "../../repositories/discountVoucherFollowUp.repository";
import { accionAdmiteTrigger } from "../automationActions";
import { TRIGGER_OPPORTUNITY_STALE, TRIGGER_OPPORTUNITY_WON } from "../automationTriggers";
import { MAX_LABEL_LENGTH } from "../discountVoucher.service";
import {
  ACTION_SEND_DISCOUNT_VOUCHER,
  MAX_EXPIRES_IN_DAYS,
  configDeCuponSchema,
  crearAccionCupon,
  type DependenciasDelCupon,
} from "./sendDiscountVoucherFollowup";
import { MAX_DELAY_HOURS } from "./sendQrFollowup";

// ---------------------------------------------------------------------------
// La acción opportunity.send_discount_voucher (ítem 177) sin base, mismo
// criterio que sendQrFollowup.test.ts: se prueba la decisión —agenda, no
// agenda, o falla— y lo que agenda. Que el UNIQUE vuelva la reentrega un no-op
// lo prueba discountVoucherFollowUpWorker.integration-test.ts.
// ---------------------------------------------------------------------------

const ORG = "11111111-1111-4111-8111-111111111111";
const OPP = "22222222-2222-4222-8222-222222222222";
const OWNER = "33333333-3333-4333-8333-333333333333";
const CONTACTO = "44444444-4444-4444-8444-444444444444";
const SUCURSAL = "55555555-5555-4555-8555-555555555555";
const REGLA = "66666666-6666-4666-8666-666666666666";
const AHORA = new Date("2026-09-25T15:00:00.000Z");

const CONFIG = {
  label: "15% de descuento en el taller",
  delayHours: 48,
  expiresInDays: 30,
  branchId: SUCURSAL,
};

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

function sucursal(): Branch {
  return {
    id: SUCURSAL,
    organizationId: ORG,
    name: "Centro",
    timezone: "America/Montevideo",
    defaultOwnerId: null,
    paymentLinkUrl: null,
    bankTransferDetails: null,
    createdAt: AHORA,
    updatedAt: AHORA,
    deletedAt: null,
  };
}

function doblar(
  opciones: {
    oportunidad?: Opportunity | null;
    sucursal?: Branch | null;
    yaAgendado?: boolean;
  } = {},
) {
  const agendados: AgendarDiscountVoucherFollowUpData[] = [];
  const deps: DependenciasDelCupon = {
    leerOportunidad: () =>
      Promise.resolve(opciones.oportunidad === undefined ? oportunidad() : opciones.oportunidad),
    leerSucursal: () =>
      Promise.resolve(opciones.sucursal === undefined ? sucursal() : opciones.sucursal),
    agendar: (data) => {
      agendados.push(data);
      return Promise.resolve(!opciones.yaAgendado);
    },
    ahora: () => AHORA,
  };
  return { deps, agendados };
}

function correr(deps: DependenciasDelCupon, config: Record<string, unknown> = CONFIG) {
  return crearAccionCupon(deps).handler({
    organizationId: ORG,
    automationId: REGLA,
    config,
    payload: { opportunityId: OPP, ownerId: OWNER },
  });
}

function mensajesDe(config: unknown): string {
  const resultado = configDeCuponSchema.safeParse(config);
  assert.equal(resultado.success, false, JSON.stringify(config));
  return resultado.error?.issues.map((i) => i.message).join(", ") ?? "";
}

// ---------------------------------------------------------------------------
// Identidad y configuración
// ---------------------------------------------------------------------------

test("la acción se llama opportunity.send_discount_voucher y solo admite opportunity.won", () => {
  const accion = crearAccionCupon(doblar().deps);
  assert.equal(accion.actionType, ACTION_SEND_DISCOUNT_VOUCHER);
  assert.equal(accionAdmiteTrigger(accion, TRIGGER_OPPORTUNITY_WON), true);
  assert.equal(accionAdmiteTrigger(accion, TRIGGER_OPPORTUNITY_STALE), false);
});

test("el schema acepta los bordes: delayHours 0 y el tope del QR, expiresInDays 1 y su tope, label de 200", () => {
  for (const config of [
    { ...CONFIG, delayHours: 0 },
    { ...CONFIG, delayHours: MAX_DELAY_HOURS },
    { ...CONFIG, expiresInDays: 1 },
    { ...CONFIG, expiresInDays: MAX_EXPIRES_IN_DAYS },
    { ...CONFIG, label: "x".repeat(MAX_LABEL_LENGTH) },
  ]) {
    assert.ok(configDeCuponSchema.safeParse(config).success, JSON.stringify(config));
  }
});

test("el schema recorta el label", () => {
  const resultado = configDeCuponSchema.parse({ ...CONFIG, label: "  15% off  " });
  assert.equal(resultado.label, "15% off");
});

test("el schema no tiene defaults ocultos: cada uno de los cuatro campos es requerido", () => {
  const sin = (campo: keyof typeof CONFIG) => {
    const copia: Record<string, unknown> = { ...CONFIG };
    delete copia[campo];
    return copia;
  };
  assert.match(mensajesDe(sin("label")), /label es requerido/);
  assert.match(mensajesDe(sin("delayHours")), /delayHours es requerido/);
  assert.match(mensajesDe(sin("expiresInDays")), /expiresInDays es requerido/);
  assert.match(mensajesDe(sin("branchId")), /branchId es requerido/);
});

test("el schema rechaza cada valor fuera de rango con un mensaje que lo nombra", () => {
  const casos: [unknown, RegExp][] = [
    [{ ...CONFIG, label: "   " }, /label es requerido/],
    [{ ...CONFIG, label: "x".repeat(MAX_LABEL_LENGTH + 1) }, /label no puede superar los 200/],
    [{ ...CONFIG, label: 15 }, /label debe ser un texto/],
    [{ ...CONFIG, delayHours: -1 }, /delayHours no puede ser negativo/],
    [{ ...CONFIG, delayHours: 1.5 }, /delayHours debe ser un número entero/],
    [{ ...CONFIG, delayHours: MAX_DELAY_HOURS + 1 }, /delayHours no puede superar las 720/],
    [{ ...CONFIG, expiresInDays: 0 }, /expiresInDays tiene que ser al menos 1/],
    [{ ...CONFIG, expiresInDays: -3 }, /expiresInDays tiene que ser al menos 1/],
    [{ ...CONFIG, expiresInDays: 2.5 }, /expiresInDays debe ser un número entero/],
    [{ ...CONFIG, expiresInDays: "30" }, /expiresInDays debe ser un número entero/],
    [{ ...CONFIG, expiresInDays: MAX_EXPIRES_IN_DAYS + 1 }, /expiresInDays no puede superar/],
    [{ ...CONFIG, branchId: "no-es-uuid" }, /branchId debe ser un UUID/],
  ];
  for (const [config, mensaje] of casos) {
    assert.match(mensajesDe(config), mensaje, JSON.stringify(config));
  }
});

// ---------------------------------------------------------------------------
// Agendado
// ---------------------------------------------------------------------------

test("agenda UN envío con la regla, la oportunidad, su contacto, la sucursal, el cupón pedido y ahora + delayHours (horaDeEnvio del QR)", async () => {
  const { deps, agendados } = doblar();

  await correr(deps);

  assert.deepEqual(agendados, [
    {
      organizationId: ORG,
      automationId: REGLA,
      opportunityId: OPP,
      contactId: CONTACTO,
      branchId: SUCURSAL,
      label: "15% de descuento en el taller",
      expiresInDays: 30,
      scheduledFor: new Date("2026-09-27T15:00:00.000Z"),
    },
  ]);
});

test("con delayHours 0 agenda para ahora mismo", async () => {
  const { deps, agendados } = doblar();
  await correr(deps, { ...CONFIG, delayHours: 0 });
  assert.equal(agendados[0].scheduledFor.toISOString(), AHORA.toISOString());
});

test("si ya estaba agendado (reentrega del evento) termina bien, sin error", async () => {
  const { deps, agendados } = doblar({ yaAgendado: true });
  await correr(deps);
  assert.equal(agendados.length, 1, "intentó una vez; el UNIQUE lo volvió un no-op");
});

test("una sucursal borrada o de otra organización es un ERROR de la regla, con el motivo", async () => {
  const { deps, agendados } = doblar({ sucursal: null });
  await assert.rejects(
    correr(deps),
    /sucursal .* no existe o está borrada: editá la automatización/,
  );
  assert.equal(agendados.length, 0);
});

test("oportunidad borrada, que ya no está ganada, o sin contacto: no agenda y no es error", async () => {
  for (const opp of [
    null,
    oportunidad({ status: "OPEN" }),
    oportunidad({ status: "LOST" }),
    oportunidad({ contactId: null, companyId: "empresa" }),
  ]) {
    const { deps, agendados } = doblar({ oportunidad: opp });
    await correr(deps);
    assert.equal(agendados.length, 0, JSON.stringify(opp?.status ?? null));
  }
});
