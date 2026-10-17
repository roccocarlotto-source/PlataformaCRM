import assert from "node:assert/strict";
import { test } from "node:test";
import { AppError } from "../utils/AppError";
import {
  PREFIJO_DEL_ID_SIMULADO,
  depsDePlantillasPara,
  esIdSimulado,
  mensajeDeModoDemo,
  plantillasSimuladas,
  salidasPara,
  salidasSimuladas,
} from "./modoDemo.service";
import type {
  CreateWhatsappTemplate,
  DeleteWhatsappTemplate,
  GetWhatsappTemplateStatus,
  SendWhatsappTemplate,
  SendWhatsappTemplateInput,
  SendWhatsappText,
  UploadTemplateSample,
} from "./whatsappGraph.service";
import type { DepsDePlantillas } from "./whatsappTemplate.service";

// ---------------------------------------------------------------------------
// La guardia del modo demo (docs-privados/taller-demo-diseno.md §2.4, local),
// sin base: `esDemo` se inyecta. Lo que se afirma es el contrato que usan los
// workers: misma referencia si no es demo; salidas que no llaman a nada si lo
// es. Que cada worker la llame lo prueba modoDemo.integration-test.ts.
// ---------------------------------------------------------------------------

const siDemo = { esDemo: () => Promise.resolve(true) };
const noDemo = { esDemo: () => Promise.resolve(false) };

// Un doble con la firma de la salida real que LANZA si alguien lo llama.
function explota<T>(nombre: string): T {
  return (() => Promise.reject(new Error(`${nombre} REAL llamada en modo demo`))) as unknown as T;
}

const PLANTILLA: SendWhatsappTemplateInput = {
  phoneNumberId: "1",
  to: "+59899000000",
  templateName: "x",
  languageCode: "es_AR",
  bodyParameters: [],
  accessToken: "t",
};

test("sin modo demo devuelve EXACTAMENTE el mismo objeto: cero diferencia para un cliente", async () => {
  const deps = {
    accessToken: () => "t",
    sendText: explota<SendWhatsappText>("sendText"),
    sendTemplate: explota<SendWhatsappTemplate>("sendTemplate"),
  };
  assert.equal(await salidasPara("org", deps, noDemo), deps);
});

test("en modo demo reemplaza solo las salidas presentes y conserva el resto del deps", async () => {
  const deps = {
    accessToken: () => "t",
    sendTemplate: explota<SendWhatsappTemplate>("sendTemplate"),
    otraCosa: 7,
  };
  const salidas = await salidasPara("org", deps, siDemo);
  assert.notEqual(salidas, deps);
  assert.equal(salidas.accessToken(), "t");
  assert.equal(salidas.otraCosa, 7);
  assert.notEqual(salidas.sendTemplate, deps.sendTemplate);
  assert.equal("sendText" in salidas, false, "no inventa un sendText que el worker no tenía");
  const { wamid } = await salidas.sendTemplate(PLANTILLA);
  assert.ok(
    wamid && esIdSimulado(wamid),
    `el wamid simulado empieza con ${PREFIJO_DEL_ID_SIMULADO}`,
  );
});

test("las tres salidas simuladas devuelven lo que el llamador espera, con id demo:", async () => {
  const s = salidasSimuladas("org");
  const texto = await s.sendText({ phoneNumberId: "1", to: "+1", body: "hola", accessToken: "t" });
  assert.ok(texto.wamid && esIdSimulado(texto.wamid));
  const plantilla = await s.sendTemplate(PLANTILLA);
  assert.ok(plantilla.wamid && esIdSimulado(plantilla.wamid));
  assert.notEqual(texto.wamid, plantilla.wamid, "un id por envío");
  assert.equal(
    await s.sendMetaText({ pageAccessToken: "p", recipientId: "r", text: "hola" }),
    undefined,
  );
});

test("esIdSimulado distingue los ids de la demo de los de Meta", () => {
  assert.equal(esIdSimulado("demo:abc"), true);
  assert.equal(esIdSimulado("wamid.HBgL"), false);
  assert.equal(esIdSimulado(null), false);
  assert.equal(esIdSimulado(undefined), false);
});

const plantillasReales: DepsDePlantillas = {
  wabaId: () => "w",
  accessToken: () => "t",
  appId: () => "a",
  create: explota<CreateWhatsappTemplate>("create"),
  delete: explota<DeleteWhatsappTemplate>("delete"),
  getStatus: explota<GetWhatsappTemplateStatus>("getStatus"),
  uploadSample: explota<UploadTemplateSample>("uploadSample"),
  nombreNuevo: () => "nombre_fijo",
};

test("plantillas: sin demo el mismo deps; con demo el alta sale APPROVED con id demo: y nada llama a Meta", async () => {
  assert.equal(await depsDePlantillasPara("org", plantillasReales, noDemo), plantillasReales);
  const simuladas = await depsDePlantillasPara("org", plantillasReales, siDemo);
  const alta = await simuladas.create({
    wabaId: "w",
    accessToken: "t",
    name: "n",
    language: "es_AR",
    category: "MARKETING",
    bodyText: "hola",
    bodyExamples: [],
  } as Parameters<DepsDePlantillas["create"]>[0]);
  assert.equal(alta.status, "APPROVED");
  assert.ok(esIdSimulado(alta.id));
  assert.deepEqual(await simuladas.getStatus({ metaTemplateId: alta.id, accessToken: "t" }), {
    status: "APPROVED",
    rejectedReason: null,
  });
  assert.equal(
    await simuladas.delete({ wabaId: "w", accessToken: "t", name: "n", metaTemplateId: alta.id }),
    undefined,
  );
  assert.ok(
    (
      await simuladas.uploadSample({} as Parameters<DepsDePlantillas["uploadSample"]>[0])
    ).startsWith(PREFIJO_DEL_ID_SIMULADO),
  );
  // Lo que no llama a nadie se conserva tal cual.
  assert.equal(simuladas.wabaId(), "w");
  assert.equal(simuladas.nombreNuevo?.("x", "y"), "nombre_fijo");
  assert.equal(plantillasSimuladas(plantillasReales).accessToken(), "t");
});

test("el mensaje del 409 nombra la acción y dice que nada sale", () => {
  const mensaje = mensajeDeModoDemo("conectar una página de Facebook");
  assert.match(mensaje, /modo demo/);
  assert.match(mensaje, /conectar una página de Facebook/);
  assert.ok(new AppError(mensaje, 409).isOperational);
});
