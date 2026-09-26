import assert from "node:assert/strict";
import { test } from "node:test";
import type { QrFollowUpParaEnviar } from "../repositories/qrFollowUp.repository";
import {
  WhatsappGraphError,
  type SendWhatsappTemplateInput,
} from "../services/whatsappGraph.service";
import {
  ErrorPermanenteDelSeguimiento,
  clasificarFallo,
  leerConfiguracion,
  motivoDeCancelacion,
  nombreParaElSaludo,
  procesarSeguimiento,
  type ConfiguracionDeEnvio,
} from "./qrFollowUpWorker";

// ---------------------------------------------------------------------------
// Las decisiones del worker de seguimientos con QR (ítem 159), sin base ni red.
// El reclamo, las marcas y "un SENT no se reprocesa" dependen de la cola real y
// viven en qrFollowUpWorker.integration-test.ts.
// ---------------------------------------------------------------------------

const RECLAMO = { id: "f1", organizationId: "org", attempts: 1 };
const CONFIG: ConfiguracionDeEnvio = { accessToken: "token" };
const PLANTILLA = { name: "seguimiento_resena", languageCode: "es_AR" };
const AHORA = new Date("2026-09-25T15:00:00.000Z");

function fila(extra: Partial<QrFollowUpParaEnviar> = {}): QrFollowUpParaEnviar {
  return {
    id: "f1",
    organizationId: "org",
    automationId: "regla",
    opportunityId: "opp",
    contactId: "contacto",
    qrCodeId: "qr",
    scheduledFor: AHORA,
    nextAttemptAt: AHORA,
    status: "PENDING",
    attempts: 1,
    lastError: null,
    sentAt: null,
    createdAt: AHORA,
    updatedAt: AHORA,
    automation: { isActive: true, deletedAt: null },
    opportunity: { status: "WON", deletedAt: null },
    contact: { firstName: "Ana", phone: "+54 9 11 5555-0000", deletedAt: null },
    qrCode: {
      branchId: "sucursal",
      destinationUrl: "https://g.page/r/abc/review",
      deletedAt: null,
    },
    ...extra,
  };
}

function doblar(
  opciones: {
    numero?: string | null;
    falla?: unknown;
    plantilla?: typeof PLANTILLA | null;
  } = {},
) {
  const enviados: SendWhatsappTemplateInput[] = [];
  const plantillasPedidas: string[] = [];
  const deps = {
    plantillaDeLaOrganizacion: (organizationId: string) => {
      plantillasPedidas.push(organizationId);
      return Promise.resolve(opciones.plantilla === undefined ? PLANTILLA : opciones.plantilla);
    },
    numeroDeLaSucursal: () =>
      Promise.resolve(opciones.numero === undefined ? "1234567890" : opciones.numero),
    sendTemplate: (input: SendWhatsappTemplateInput) => {
      enviados.push(input);
      return opciones.falla === undefined ? Promise.resolve() : Promise.reject(opciones.falla);
    },
  };
  return { deps, enviados, plantillasPedidas };
}

// ---------------------------------------------------------------------------
// Configuración
// ---------------------------------------------------------------------------

test("leerConfiguracion: sin token (o con el string vacío) nombra lo que falta; la plantilla ya no es configuración global", () => {
  assert.deepEqual(leerConfiguracion({ accessToken: () => undefined }), {
    ok: false,
    faltan: ["WHATSAPP_ACCESS_TOKEN"],
  });
  assert.deepEqual(leerConfiguracion({ accessToken: () => "  " }), {
    ok: false,
    faltan: ["WHATSAPP_ACCESS_TOKEN"],
  });

  // Ítem 160: con el token alcanza. Antes también exigía las dos variables de
  // la plantilla (WHATSAPP_REVIEW_FOLLOWUP_TEMPLATE_*), que ya no existen.
  assert.deepEqual(leerConfiguracion({ accessToken: () => " token " }), {
    ok: true,
    config: CONFIG,
  });
});

// ---------------------------------------------------------------------------
// Clasificación de fallos
// ---------------------------------------------------------------------------

test("clasificarFallo: 429 y 5xx de Meta, la red o un bug son transitorios", () => {
  assert.equal(clasificarFallo(new WhatsappGraphError(429, "rate limit")), "TRANSITORIO");
  assert.equal(clasificarFallo(new WhatsappGraphError(500, "")), "TRANSITORIO");
  assert.equal(clasificarFallo(new WhatsappGraphError(503, "")), "TRANSITORIO");
  assert.equal(clasificarFallo(new TypeError("fetch failed")), "TRANSITORIO");
});

test("clasificarFallo: un 4xx de Meta y un dato que falta son permanentes", () => {
  assert.equal(clasificarFallo(new WhatsappGraphError(400, "invalid parameter")), "PERMANENTE");
  assert.equal(clasificarFallo(new WhatsappGraphError(404, "template not found")), "PERMANENTE");
  assert.equal(clasificarFallo(new WhatsappGraphError(401, "token vencido")), "PERMANENTE");
  assert.equal(clasificarFallo(new ErrorPermanenteDelSeguimiento("sin teléfono")), "PERMANENTE");
});

// ---------------------------------------------------------------------------
// Cuándo ya no corresponde mandarlo
// ---------------------------------------------------------------------------

test("motivoDeCancelacion: null cuando todo sigue en pie", () => {
  assert.equal(motivoDeCancelacion(fila()), null);
});

test("motivoDeCancelacion: la oportunidad que ya no está ganada cancela, con el estado actual", () => {
  assert.equal(
    motivoDeCancelacion(fila({ opportunity: { status: "OPEN", deletedAt: null } })),
    "La oportunidad ya no está ganada (estado actual: OPEN)",
  );
  assert.match(
    motivoDeCancelacion(fila({ opportunity: { status: "LOST", deletedAt: null } })) ?? "",
    /LOST/,
  );
});

test("motivoDeCancelacion: regla borrada o desactivada, oportunidad, contacto o QR borrados", () => {
  const borrado = new Date();
  assert.match(
    motivoDeCancelacion(fila({ automation: { isActive: true, deletedAt: borrado } })) ?? "",
    /borró la automatización/,
  );
  assert.match(
    motivoDeCancelacion(fila({ automation: { isActive: false, deletedAt: null } })) ?? "",
    /desactivada/,
  );
  assert.match(
    motivoDeCancelacion(fila({ opportunity: { status: "WON", deletedAt: borrado } })) ?? "",
    /borró la oportunidad/,
  );
  assert.match(
    motivoDeCancelacion(fila({ contact: { firstName: "Ana", phone: "1", deletedAt: borrado } })) ??
      "",
    /borró el contacto/,
  );
  assert.match(
    motivoDeCancelacion(
      fila({ qrCode: { branchId: "s", destinationUrl: "https://x", deletedAt: borrado } }),
    ) ?? "",
    /borró el QR/,
  );
});

test("nombreParaElSaludo: el nombre recortado, y 'cliente' si está en blanco", () => {
  assert.equal(nombreParaElSaludo("  Ana "), "Ana");
  assert.equal(nombreParaElSaludo("   "), "cliente");
});

// ---------------------------------------------------------------------------
// procesarSeguimiento
// ---------------------------------------------------------------------------

test("envía la plantilla desde el número de la sucursal del QR, con {{1}} nombre y {{2}} link", async () => {
  const { deps, enviados } = doblar();

  const resultado = await procesarSeguimiento(RECLAMO, CONFIG, deps, () => Promise.resolve(fila()));

  assert.deepEqual(resultado, { resultado: "ENVIADO" });
  assert.deepEqual(enviados, [
    {
      phoneNumberId: "1234567890",
      // Contact.phone es texto libre: al wa_id le quedan solo los dígitos.
      to: "5491155550000",
      templateName: "seguimiento_resena",
      languageCode: "es_AR",
      bodyParameters: ["Ana", "https://g.page/r/abc/review"],
      accessToken: "token",
    },
  ]);
});

test("si la oportunidad ya no está ganada, CANCELA sin mandar nada", async () => {
  const { deps, enviados } = doblar();

  const resultado = await procesarSeguimiento(RECLAMO, CONFIG, deps, () =>
    Promise.resolve(fila({ opportunity: { status: "LOST", deletedAt: null } })),
  );

  assert.deepEqual(resultado, {
    resultado: "CANCELADO",
    motivo: "La oportunidad ya no está ganada (estado actual: LOST)",
  });
  assert.equal(enviados.length, 0);
});

test("contacto sin teléfono o sucursal sin número de WhatsApp: error PERMANENTE, sin mandar", async () => {
  const sinTelefono = doblar();
  await assert.rejects(
    procesarSeguimiento(RECLAMO, CONFIG, sinTelefono.deps, () =>
      Promise.resolve(fila({ contact: { firstName: "Ana", phone: null, deletedAt: null } })),
    ),
    (err: unknown) =>
      err instanceof ErrorPermanenteDelSeguimiento && /no tiene un teléfono/.test(err.message),
  );
  assert.equal(sinTelefono.enviados.length, 0);

  const sinNumero = doblar({ numero: null });
  await assert.rejects(
    procesarSeguimiento(RECLAMO, CONFIG, sinNumero.deps, () => Promise.resolve(fila())),
    (err: unknown) =>
      err instanceof ErrorPermanenteDelSeguimiento && /número de WhatsApp/.test(err.message),
  );
  assert.equal(sinNumero.enviados.length, 0);
});

test("el error de Meta sube tal cual, para que el drenado lo clasifique", async () => {
  const { deps } = doblar({ falla: new WhatsappGraphError(503, "caído") });

  await assert.rejects(
    procesarSeguimiento(RECLAMO, CONFIG, deps, () => Promise.resolve(fila())),
    (err: unknown) => err instanceof WhatsappGraphError && err.status === 503,
  );
});

// ---------------------------------------------------------------------------
// La plantilla de la organización (ítem 160)
// ---------------------------------------------------------------------------

test("manda con la plantilla de la organización de la fila, leída justo antes de mandar", async () => {
  const { deps, enviados, plantillasPedidas } = doblar({
    plantilla: { name: "gracias_por_tu_compra", languageCode: "es" },
  });

  await procesarSeguimiento(RECLAMO, CONFIG, deps, () => Promise.resolve(fila()));

  assert.deepEqual(plantillasPedidas, ["org"]);
  assert.equal(enviados.length, 1);
  assert.equal(enviados[0].templateName, "gracias_por_tu_compra");
  assert.equal(enviados[0].languageCode, "es");
});

test("si la plantilla desapareció entre el reclamo y el envío: error PERMANENTE (FAILED), sin mandar", async () => {
  const { deps, enviados } = doblar({ plantilla: null });

  await assert.rejects(
    procesarSeguimiento(RECLAMO, CONFIG, deps, () => Promise.resolve(fila())),
    (err: unknown) =>
      err instanceof ErrorPermanenteDelSeguimiento &&
      /ya no tiene una plantilla de WhatsApp aprobada/.test(err.message) &&
      clasificarFallo(err) === "PERMANENTE",
  );
  assert.equal(enviados.length, 0);
});

test("una fila que se cancela no llega a preguntar por la plantilla", async () => {
  const { deps, plantillasPedidas } = doblar();

  await procesarSeguimiento(RECLAMO, CONFIG, deps, () =>
    Promise.resolve(fila({ opportunity: { status: "LOST", deletedAt: null } })),
  );

  assert.deepEqual(plantillasPedidas, []);
});
