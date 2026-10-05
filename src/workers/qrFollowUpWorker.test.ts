import assert from "node:assert/strict";
import { test } from "node:test";
import type { QrFollowUpParaEnviar } from "../repositories/qrFollowUp.repository";
import {
  WhatsappGraphError,
  type SendWhatsappTemplateInput,
} from "../services/whatsappGraph.service";
import {
  ErrorPermanenteDelSeguimiento,
  armarEnvioDeLaPlantilla,
  clasificarFallo,
  leerConfiguracion,
  motivoDeCancelacion,
  nombreParaElSaludo,
  procesarSeguimiento,
  type ConfiguracionDeEnvio,
  type PlantillaDeSeguimiento,
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
    // G-07: si viene, la sucursal está cerrada y abre en ese momento.
    abreA?: Date;
    falla?: unknown;
    plantilla?: PlantillaDeSeguimiento | null;
  } = {},
) {
  const enviados: SendWhatsappTemplateInput[] = [];
  const plantillasPedidas: string[] = [];
  const deps = {
    plantillaDeLaRegla: (organizationId: string, automationId: string) => {
      plantillasPedidas.push(`${organizationId}/${automationId}`);
      return Promise.resolve(opciones.plantilla === undefined ? PLANTILLA : opciones.plantilla);
    },
    // G-07: siempre abierta, salvo los casos que prueban la ventana.
    proximaApertura: (_organizationId: string, _branchId: string, ahora: Date) =>
      Promise.resolve(opciones.abreA ?? ahora),
    numeroDeLaSucursal: () =>
      Promise.resolve(opciones.numero === undefined ? "1234567890" : opciones.numero),
    sendTemplate: (input: SendWhatsappTemplateInput) => {
      enviados.push(input);
      return opciones.falla === undefined
        ? Promise.resolve({ wamid: null })
        : Promise.reject(opciones.falla);
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
  // OPUS-D-01 (docs-privados, local): el límite de envío llega con HTTP 400 y
  // su código; se reintenta en vez de perder el seguimiento.
  assert.equal(
    clasificarFallo(
      new WhatsappGraphError(400, JSON.stringify({ error: { message: "x", code: 130429 } })),
    ),
    "TRANSITORIO",
  );
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

// G-07 de docs-privados/auditoria-2026-09-30-corta.md (local): fuera del
// horario de la sucursal no se manda nada; se pospone hasta la apertura.
test("G-07: con la sucursal cerrada no manda y devuelve FUERA_DE_HORARIO con la próxima apertura", async () => {
  const abre = new Date(Date.now() + 5 * 60 * 60 * 1000);
  const { deps, enviados } = doblar({ abreA: abre });

  const resultado = await procesarSeguimiento(RECLAMO, CONFIG, deps, () => Promise.resolve(fila()));

  assert.deepEqual(resultado, { resultado: "FUERA_DE_HORARIO", hasta: abre });
  assert.equal(enviados.length, 0);
});

test("G-07: lo que ya no corresponde se cancela aunque la sucursal esté cerrada", async () => {
  const { deps } = doblar({ abreA: new Date(Date.now() + 60 * 60 * 1000) });
  const resultado = await procesarSeguimiento(RECLAMO, CONFIG, deps, () =>
    Promise.resolve(fila({ qrCode: { ...fila().qrCode, deletedAt: new Date() } })),
  );
  assert.equal(resultado.resultado, "CANCELADO");
});

test("envía la plantilla desde el número de la sucursal del QR, con {{1}} nombre y {{2}} link", async () => {
  const { deps, enviados } = doblar();

  const resultado = await procesarSeguimiento(RECLAMO, CONFIG, deps, () => Promise.resolve(fila()));

  // F1: el resultado lleva lo que salió, para anotarlo en la conversación.
  assert.deepEqual(resultado, {
    resultado: "ENVIADO",
    envio: {
      organizationId: "org",
      contactId: "contacto",
      phoneNumberId: "1234567890",
      destino: "5491155550000",
      plantilla: PLANTILLA,
      parametros: ["Ana", "https://g.page/r/abc/review"],
      wamid: null,
    },
  });
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
// La plantilla de la regla (ítem 160; por regla desde el 181)
// ---------------------------------------------------------------------------

test("manda con la plantilla de la REGLA de la fila (organización + automatización), leída justo antes de mandar", async () => {
  const { deps, enviados, plantillasPedidas } = doblar({
    plantilla: { name: "gracias_por_tu_compra", languageCode: "es" },
  });

  await procesarSeguimiento(RECLAMO, CONFIG, deps, () => Promise.resolve(fila()));

  assert.deepEqual(plantillasPedidas, ["org/regla"]);
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

// ---------------------------------------------------------------------------
// Formato del mensaje: lo decide la plantilla con la que sale.
// ---------------------------------------------------------------------------

const QR_ID = "5b0f7a4e-2c1d-4f3a-9e8b-1a2b3c4d5e6f";
const API_PUBLICA = "https://plataformacrm.onrender.com";

function enviarCon(
  plantilla: PlantillaDeSeguimiento,
  { baseDeLaApi }: { baseDeLaApi: string | undefined } = { baseDeLaApi: API_PUBLICA },
) {
  const { deps, enviados } = doblar({ plantilla });
  return procesarSeguimiento(RECLAMO, CONFIG, { ...deps, baseDeLaApi: () => baseDeLaApi }, () =>
    Promise.resolve(fila({ qrCodeId: QR_ID })),
  ).then((resultado) => ({ resultado, enviados }));
}

test("formato solo link (las plantillas de siempre): sin encabezado, [nombre, link]", async () => {
  const { enviados } = await enviarCon({
    ...PLANTILLA,
    bodyText: "Hola {nombre}, tu opinión: {link} gracias",
    headerFormat: "NONE",
  });
  assert.equal(enviados[0].headerImageUrl, undefined);
  assert.deepEqual(enviados[0].bodyParameters, ["Ana", "https://g.page/r/abc/review"]);
});

test("formato link e imagen: la imagen del QR de la sucursal de encabezado y [nombre, link]", async () => {
  const { enviados } = await enviarCon({
    ...PLANTILLA,
    bodyText: "Hola {nombre}, tu opinión: {link} gracias",
    headerFormat: "IMAGE",
  });
  assert.equal(enviados[0].headerImageUrl, `${API_PUBLICA}/qr-images/r/${QR_ID}.png`);
  assert.deepEqual(enviados[0].bodyParameters, ["Ana", "https://g.page/r/abc/review"]);
});

test("formato solo imagen: la imagen de encabezado y solo [nombre]", async () => {
  const { resultado, enviados } = await enviarCon({
    ...PLANTILLA,
    bodyText: "Hola {nombre}, te dejamos el QR. Gracias",
    headerFormat: "IMAGE",
  });
  assert.equal(enviados[0].headerImageUrl, `${API_PUBLICA}/qr-images/r/${QR_ID}.png`);
  assert.deepEqual(enviados[0].bodyParameters, ["Ana"]);
  assert.equal(resultado.resultado === "ENVIADO" && resultado.envio.parametros.length, 1);
});

test("plantilla con imagen sin URL pública del backend: error permanente, no se manda", async () => {
  await assert.rejects(
    enviarCon(
      { ...PLANTILLA, bodyText: "Hola {nombre}, tu QR. Gracias", headerFormat: "IMAGE" },
      { baseDeLaApi: undefined },
    ),
    (err) =>
      err instanceof ErrorPermanenteDelSeguimiento && /PUBLIC_API_BASE_URL/.test(err.message),
  );
});

test("armarEnvioDeLaPlantilla: sin el texto de la plantilla, [nombre, link] como siempre", () => {
  assert.deepEqual(
    armarEnvioDeLaPlantilla(
      PLANTILLA,
      "Ana",
      "https://x",
      { tipo: "r", id: QR_ID },
      { baseDeLaApi: API_PUBLICA },
    ),
    { bodyParameters: ["Ana", "https://x"] },
  );
});
