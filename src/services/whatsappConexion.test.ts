import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { findBranchWhatsappPhoneNumberId } from "../repositories/agent.repository";
import { AppError } from "../utils/AppError";
import { depsDelRecordatorioReales } from "../clinicas/recordatorios/recordatorioWorker";
import { depsDeEnvioReales } from "../workers/agentInboundWorker";
import { depsDelCuponReales } from "../workers/discountVoucherFollowUpWorker";
import { depsDelSeguimientoDeConsultaReales } from "../workers/inquiryFollowUpWorker";
import { depsDelSeguimientoReales } from "../workers/qrFollowUpWorker";
import {
  conexionDeWhatsapp,
  wabaDeLaPlantilla,
  type DepsDeConexion,
} from "./whatsappConexion.service";
import { downloadWhatsappMediaReal } from "./whatsappGraph.service";

// ---------------------------------------------------------------------------
// El WABA de cada organización (docs/whatsapp-alta-clinica.md): el punto
// único que lo decide, y "automotora sin cambios" en todos los caminos de
// envío: ninguno consulta el WABA propio, todos mandan con el token de la
// plataforma y desde el número de la sucursal, como antes.
// ---------------------------------------------------------------------------

const global: DepsDeConexion = {
  wabaId: () => "111111111111111",
  accessToken: () => "token-de-la-plataforma",
};

test("sin WABA propio (una automotora, AutoMax incluida): el WABA global exacto y el token de la plataforma", async () => {
  assert.deepEqual(await conexionDeWhatsapp("org", global), {
    wabaId: "111111111111111",
    accessToken: "token-de-la-plataforma",
    propio: false,
  });
  assert.deepEqual(
    await conexionDeWhatsapp("org", { ...global, wabaPropio: () => Promise.resolve(null) }),
    { wabaId: "111111111111111", accessToken: "token-de-la-plataforma", propio: false },
  );
});

test("con WABA propio: ese WABA, con el MISMO token de la plataforma (la clínica no da token)", async () => {
  const conPropio = { ...global, wabaPropio: () => Promise.resolve("222222222222222") };
  assert.deepEqual(await conexionDeWhatsapp("org", conPropio), {
    wabaId: "222222222222222",
    accessToken: "token-de-la-plataforma",
    propio: true,
  });
  // Con un WABA propio, el global no hace falta.
  assert.equal(
    (await conexionDeWhatsapp("org", { ...conPropio, wabaId: () => undefined })).wabaId,
    "222222222222222",
  );
});

test("sin token, o sin ningún WABA: 503", async () => {
  for (const deps of [
    { ...global, accessToken: () => "  " },
    { ...global, wabaId: () => undefined },
  ]) {
    await assert.rejects(
      conexionDeWhatsapp("org", deps),
      (err: unknown) => err instanceof AppError && err.statusCode === 503,
    );
  }
});

test("una plantilla se borra en el WABA donde se creó: el suyo, o el global si es anterior", () => {
  assert.equal(wabaDeLaPlantilla({ wabaId: "222222222222222" }, global), "222222222222222");
  assert.equal(wabaDeLaPlantilla({ wabaId: null }, global), "111111111111111");
  assert.equal(wabaDeLaPlantilla({ wabaId: null }, { wabaId: () => "" }), undefined);
});

// ---------------------------------------------------------------------------
// Automotora sin cambios: los caminos de envío
// ---------------------------------------------------------------------------

const CAMINOS_DE_ENVIO = [
  "src/workers/agentInboundWorker.ts",
  "src/workers/qrFollowUpWorker.ts",
  "src/workers/inquiryFollowUpWorker.ts",
  "src/workers/discountVoucherFollowUpWorker.ts",
  "src/clinicas/recordatorios/recordatorioWorker.ts",
  "src/services/conversationReply.service.ts",
  "src/services/discountVoucherManual.service.ts",
  "src/controllers/whatsappWebhook.controller.ts",
];

test("automotora sin cambios: ningún camino de envío consulta el WABA propio", async () => {
  for (const archivo of CAMINOS_DE_ENVIO) {
    const fuente = await readFile(join(process.cwd(), archivo), "utf8");
    for (const prohibido of [
      "whatsappBusinessConnection",
      "whatsappConexion",
      "findWabaPropio",
      "conexionDeWhatsapp",
    ]) {
      assert.ok(!fuente.includes(prohibido), `${archivo} usa ${prohibido}`);
    }
  }
});

test("automotora sin cambios: los envíos salen del número de la sucursal y bajan el media como antes", () => {
  // Respuestas del agente y descarga de media (agentInboundWorker).
  assert.equal(depsDeEnvioReales.downloadMedia, downloadWhatsappMediaReal);
  // Los cuatro workers que mandan plantillas, con el número de la sucursal.
  assert.equal(depsDelSeguimientoReales.numeroDeLaSucursal, findBranchWhatsappPhoneNumberId);
  assert.equal(
    depsDelSeguimientoDeConsultaReales.numeroDeLaSucursal,
    findBranchWhatsappPhoneNumberId,
  );
  assert.equal(depsDelCuponReales.numeroDeLaSucursal, findBranchWhatsappPhoneNumberId);
  assert.equal(depsDelRecordatorioReales.numeroDeLaSede, findBranchWhatsappPhoneNumberId);
});
