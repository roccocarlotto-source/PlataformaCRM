import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  DiscountVoucherFollowUpParaEnviar,
  DiscountVoucherFollowUpReclamado,
} from "../repositories/discountVoucherFollowUp.repository";
import {
  WhatsappGraphError,
  type SendWhatsappTemplateInput,
} from "../services/whatsappGraph.service";
import { AppError } from "../utils/AppError";
import { buildVoucherPublicUrl } from "../utils/voucherPublicUrl";
import {
  clasificarFallo,
  leerConfiguracion,
  motivoDeCancelacion,
  procesarCupon,
  vencimientoDelCupon,
  type ConfiguracionDelCupon,
} from "./discountVoucherFollowUpWorker";
import { ErrorPermanenteDelSeguimiento } from "./qrFollowUpWorker";

// ---------------------------------------------------------------------------
// Las decisiones del worker de cupones de descuento (ítem 177), sin base ni
// red. La emisión real en transacción, el reclamo y las marcas viven en
// discountVoucherFollowUpWorker.integration-test.ts.
// ---------------------------------------------------------------------------

const RECLAMO: DiscountVoucherFollowUpReclamado = { id: "f1", organizationId: "org", attempts: 1 };
const CONFIG: ConfiguracionDelCupon = { accessToken: "token" };
const PLANTILLA = { name: "seguimiento_resena", languageCode: "es_AR" };
// El agendado fue hace tres días; el envío es AHORA.
const AGENDADO = new Date("2026-09-22T15:00:00.000Z");
const AHORA = new Date("2026-09-25T15:00:00.000Z");
const CUPON = "99999999-9999-4999-8999-999999999999";

function fila(
  extra: Partial<DiscountVoucherFollowUpParaEnviar> = {},
): DiscountVoucherFollowUpParaEnviar {
  return {
    id: "f1",
    organizationId: "org",
    automationId: "regla",
    opportunityId: "opp",
    contactId: "contacto",
    branchId: "sucursal",
    label: "15% en el taller",
    expiresInDays: 30,
    discountVoucherId: null,
    scheduledFor: AGENDADO,
    nextAttemptAt: AGENDADO,
    status: "PENDING",
    attempts: 1,
    lastError: null,
    sentAt: null,
    createdAt: AGENDADO,
    updatedAt: AGENDADO,
    automation: { isActive: true, deletedAt: null },
    opportunity: { status: "WON", deletedAt: null },
    contact: { firstName: "Ana", phone: "+54 9 11 5555-0000", deletedAt: null },
    branch: { deletedAt: null },
    ...extra,
  };
}

interface Emision {
  reclamo: DiscountVoucherFollowUpReclamado;
  filaId: string;
  expiresAt: Date;
}

function doblar(
  opciones: {
    numero?: string | null;
    falla?: unknown;
    plantilla?: typeof PLANTILLA | null;
  } = {},
) {
  const enviados: SendWhatsappTemplateInput[] = [];
  const emisiones: Emision[] = [];
  const plantillasPedidas: string[] = [];
  const deps = {
    plantillaDeLaRegla: (organizationId: string, automationId: string) => {
      plantillasPedidas.push(`${organizationId}/${automationId}`);
      return Promise.resolve(opciones.plantilla === undefined ? PLANTILLA : opciones.plantilla);
    },
    numeroDeLaSucursal: () =>
      Promise.resolve(opciones.numero === undefined ? "1234567890" : opciones.numero),
    sendTemplate: (input: SendWhatsappTemplateInput) => {
      enviados.push(input);
      return opciones.falla === undefined
        ? Promise.resolve({ wamid: null })
        : Promise.reject(opciones.falla);
    },
    emitirCupon: (
      reclamo: DiscountVoucherFollowUpReclamado,
      f: DiscountVoucherFollowUpParaEnviar,
      expiresAt: Date,
    ) => {
      emisiones.push({ reclamo, filaId: f.id, expiresAt });
      return Promise.resolve(CUPON);
    },
    ahora: () => AHORA,
  };
  return { deps, enviados, emisiones, plantillasPedidas };
}

// ---------------------------------------------------------------------------
// Configuración, link y vencimiento
// ---------------------------------------------------------------------------

test("leerConfiguracion: sin token (o vacío) falta WHATSAPP_ACCESS_TOKEN", () => {
  assert.deepEqual(leerConfiguracion({ accessToken: () => undefined }), {
    ok: false,
    faltan: ["WHATSAPP_ACCESS_TOKEN"],
  });
  assert.deepEqual(leerConfiguracion({ accessToken: () => " " }), {
    ok: false,
    faltan: ["WHATSAPP_ACCESS_TOKEN"],
  });
});

test("leerConfiguracion: con el token, lo recorta", () => {
  assert.deepEqual(leerConfiguracion({ accessToken: () => " token " }), {
    ok: true,
    config: CONFIG,
  });
});

test("vencimientoDelCupon: suma días exactos", () => {
  assert.equal(vencimientoDelCupon(AHORA, 1).toISOString(), "2026-09-26T15:00:00.000Z");
  assert.equal(vencimientoDelCupon(AHORA, 30).toISOString(), "2026-10-25T15:00:00.000Z");
});

// ---------------------------------------------------------------------------
// Clasificación
// ---------------------------------------------------------------------------

test("clasificarFallo: la del QR (429/5xx/red transitorios; 4xx de Meta y datos faltantes permanentes)", () => {
  assert.equal(clasificarFallo(new WhatsappGraphError(503, "")), "TRANSITORIO");
  assert.equal(clasificarFallo(new TypeError("fetch failed")), "TRANSITORIO");
  assert.equal(clasificarFallo(new WhatsappGraphError(400, "bad")), "PERMANENTE");
  assert.equal(clasificarFallo(new ErrorPermanenteDelSeguimiento("sin teléfono")), "PERMANENTE");
});

test("clasificarFallo: un 4xx de crearDiscountVoucher es permanente; un AppError 5xx no", () => {
  assert.equal(clasificarFallo(new AppError("label inválido", 400)), "PERMANENTE");
  assert.equal(clasificarFallo(new AppError("se cayó algo", 500)), "TRANSITORIO");
});

// ---------------------------------------------------------------------------
// Cancelación: cada motivo
// ---------------------------------------------------------------------------

test("motivoDeCancelacion: null cuando todo sigue en pie", () => {
  assert.equal(motivoDeCancelacion(fila()), null);
});

test("motivoDeCancelacion: cada motivo, con su mensaje", () => {
  const borrado = new Date();
  const casos: [Partial<DiscountVoucherFollowUpParaEnviar>, RegExp][] = [
    [{ automation: { isActive: true, deletedAt: borrado } }, /borró la automatización/],
    [{ automation: { isActive: false, deletedAt: null } }, /desactivada/],
    [{ opportunity: { status: "WON", deletedAt: borrado } }, /borró la oportunidad/],
    [
      { opportunity: { status: "OPEN", deletedAt: null } },
      /ya no está ganada \(estado actual: OPEN\)/,
    ],
    [{ opportunity: { status: "LOST", deletedAt: null } }, /estado actual: LOST/],
    [{ contact: { firstName: "Ana", phone: "1", deletedAt: borrado } }, /borró el contacto/],
    [{ branch: { deletedAt: borrado } }, /borró la sucursal/],
  ];
  for (const [extra, mensaje] of casos) {
    assert.match(motivoDeCancelacion(fila(extra)) ?? "", mensaje, JSON.stringify(extra));
  }
});

test("cada motivo de cancelación CANCELA sin emitir cupón ni mandar nada", async () => {
  const borrado = new Date();
  for (const extra of [
    { automation: { isActive: false, deletedAt: null } },
    { opportunity: { status: "LOST" as const, deletedAt: null } },
    { contact: { firstName: "Ana", phone: "1", deletedAt: borrado } },
    { branch: { deletedAt: borrado } },
  ]) {
    const { deps, enviados, emisiones } = doblar();
    const resultado = await procesarCupon(RECLAMO, CONFIG, deps, () =>
      Promise.resolve(fila(extra)),
    );
    assert.equal(resultado.resultado, "CANCELADO", JSON.stringify(extra));
    assert.equal(emisiones.length, 0);
    assert.equal(enviados.length, 0);
  }
});

// ---------------------------------------------------------------------------
// Emisión y envío
// ---------------------------------------------------------------------------

test("emite el cupón con expiresAt = AHORA + expiresInDays (no desde el agendado) y lo manda con {{1}} nombre y {{2}} link", async () => {
  const { deps, enviados, emisiones } = doblar();

  const resultado = await procesarCupon(RECLAMO, CONFIG, deps, () => Promise.resolve(fila()));

  // F1: el resultado lleva lo que salió, para anotarlo en la conversación.
  assert.equal(resultado.resultado, "ENVIADO");
  if (resultado.resultado === "ENVIADO") {
    assert.equal(resultado.envio.contactId, "contacto");
    assert.equal(resultado.envio.destino, "5491155550000");
    assert.deepEqual(resultado.envio.parametros, enviados[0].bodyParameters);
  }
  assert.deepEqual(emisiones, [
    { reclamo: RECLAMO, filaId: "f1", expiresAt: new Date("2026-10-25T15:00:00.000Z") },
  ]);
  // Contado desde el agendado habría sido tres días antes.
  assert.notEqual(emisiones[0].expiresAt.getTime(), vencimientoDelCupon(AGENDADO, 30).getTime());
  assert.deepEqual(enviados, [
    {
      phoneNumberId: "1234567890",
      to: "5491155550000",
      templateName: "seguimiento_resena",
      languageCode: "es_AR",
      // El link lo arma buildVoucherPublicUrl (ítem 178), el mismo que codifica
      // el QR de la página del cupón.
      bodyParameters: ["Ana", buildVoucherPublicUrl(CUPON)],
      accessToken: "token",
    },
  ]);
});

// Ítem 181: la plantilla es la de la regla que agendó el cupón, no "la" de la
// organización (que puede ser la del QR de reseñas, con otro texto).
test("pide la plantilla de la REGLA de la fila (organización + automatización)", async () => {
  const { deps, plantillasPedidas } = doblar();

  await procesarCupon(RECLAMO, CONFIG, deps, () => Promise.resolve(fila()));

  assert.deepEqual(plantillasPedidas, ["org/regla"]);
});

test("un reintento con el cupón ya emitido NO emite otro: manda el mismo", async () => {
  const YA = "88888888-8888-4888-8888-888888888888";
  const { deps, enviados, emisiones } = doblar();

  await procesarCupon(RECLAMO, CONFIG, deps, () =>
    Promise.resolve(fila({ discountVoucherId: YA, attempts: 2 })),
  );

  assert.equal(emisiones.length, 0, "no se emitió un segundo cupón");
  assert.equal(enviados[0].bodyParameters[1], buildVoucherPublicUrl(YA));
});

test("si Meta falla después de emitir, el error sube (y el cupón ya quedó anotado para el reintento)", async () => {
  const { deps, emisiones } = doblar({ falla: new WhatsappGraphError(503, "caído") });

  await assert.rejects(
    procesarCupon(RECLAMO, CONFIG, deps, () => Promise.resolve(fila())),
    WhatsappGraphError,
  );
  assert.equal(emisiones.length, 1);
});

test("contacto sin teléfono, sucursal sin número o sin plantilla: falla PERMANENTE sin emitir el cupón", async () => {
  const casos = [
    {
      opciones: {},
      fila: fila({ contact: { firstName: "Ana", phone: null, deletedAt: null } }),
      mensaje: /no tiene un teléfono/,
    },
    { opciones: { numero: null }, fila: fila(), mensaje: /no tiene un número de WhatsApp/ },
    { opciones: { plantilla: null }, fila: fila(), mensaje: /plantilla de WhatsApp aprobada/ },
  ];
  for (const caso of casos) {
    const { deps, enviados, emisiones } = doblar(caso.opciones);
    await assert.rejects(
      procesarCupon(RECLAMO, CONFIG, deps, () => Promise.resolve(caso.fila)),
      (err: unknown) =>
        err instanceof ErrorPermanenteDelSeguimiento && caso.mensaje.test(err.message),
    );
    assert.equal(emisiones.length, 0, "no quedó un cupón que nunca iba a salir");
    assert.equal(enviados.length, 0);
  }
});

test("si la fila ya no existe es un error permanente", async () => {
  const { deps } = doblar();
  await assert.rejects(
    procesarCupon(RECLAMO, CONFIG, deps, () => Promise.resolve(null)),
    ErrorPermanenteDelSeguimiento,
  );
});
