import assert from "node:assert/strict";
import { test } from "node:test";
import type { ConversationChannel } from "@prisma/client";
import type { JobReclamado } from "../repositories/agentInboundJob.repository";
import {
  MENSAJE_CONEXION_INACTIVA,
  MENSAJE_PAGINA_RECONECTADA,
} from "../services/metaPageConnection.service";
import { olvidarPartesEnviadasParaTests } from "../services/envioEnPartes";
import { MetaSendError, type SendMetaTextInput } from "../services/metaSend.service";
import { WhatsappGraphError, type SendWhatsappTextInput } from "../services/whatsappGraph.service";
import { AppError } from "../utils/AppError";
import {
  clasificarFallo,
  descargarAdjuntos,
  enviarPorElCanal,
  ErrorDeDescarga,
  ErrorDeEnvio,
  ErrorPermanenteDelJob,
  procesarJob,
  resolverFalloDelJob,
  resolverTokenDePagina,
  type DepsDeEnvio,
} from "./agentInboundWorker";

// ---------------------------------------------------------------------------
// Las decisiones puras del worker de la cola de WhatsApp (ítem 125): qué se
// reintenta y cuándo. El recorrido completo contra la base está en
// src/controllers/whatsappWebhook.controller.integration-test.ts.
// ---------------------------------------------------------------------------

const LIMITES = { maxIntentos: 5, backoff: { baseMs: 15_000, topeMs: 300_000 } };
const AHORA = new Date("2026-09-24T12:00:00Z");

test("clasificarFallo: un AppError de negocio (4xx) es permanente; un 5xx no", () => {
  assert.equal(clasificarFallo(new AppError("El agente está desactivado", 400)), "PERMANENTE");
  assert.equal(clasificarFallo(new AppError("Agente no encontrado", 404)), "PERMANENTE");
  assert.equal(clasificarFallo(new AppError("se cayó algo", 502)), "TRANSITORIO");
});

test("clasificarFallo: un envío rechazado por Meta usa el mismo corte que el proveedor de LLM", () => {
  const envio = (status: number) => new ErrorDeEnvio(new WhatsappGraphError(status, "x"));
  assert.equal(clasificarFallo(envio(400)), "PERMANENTE");
  assert.equal(clasificarFallo(envio(401)), "PERMANENTE");
  assert.equal(clasificarFallo(envio(429)), "TRANSITORIO");
  assert.equal(clasificarFallo(envio(503)), "TRANSITORIO");
  // Sin respuesta de Meta (red, timeout): no hay status, se reintenta.
  assert.equal(clasificarFallo(new ErrorDeEnvio(new Error("fetch failed"))), "TRANSITORIO");
});

test("clasificarFallo: un job sin sus datos es permanente; un error cualquiera es transitorio", () => {
  assert.equal(clasificarFallo(new ErrorPermanenteDelJob("no existe")), "PERMANENTE");
  assert.equal(clasificarFallo(new Error("connection terminated")), "TRANSITORIO");
  assert.equal(clasificarFallo("algo raro"), "TRANSITORIO");
});

test("resolverFalloDelJob: el primer fallo espera la base, y la espera se duplica", () => {
  const primero = resolverFalloDelJob(1, "TRANSITORIO", AHORA, LIMITES);
  assert.deepEqual(primero, {
    estado: "REINTENTAR",
    nextAttemptAt: new Date(AHORA.getTime() + 15_000),
  });
  const tercero = resolverFalloDelJob(3, "TRANSITORIO", AHORA, LIMITES);
  assert.deepEqual(tercero, {
    estado: "REINTENTAR",
    nextAttemptAt: new Date(AHORA.getTime() + 60_000),
  });
});

test("resolverFalloDelJob: al agotar los intentos, o ante un error permanente, FAILED", () => {
  assert.deepEqual(resolverFalloDelJob(5, "TRANSITORIO", AHORA, LIMITES), { estado: "FAILED" });
  assert.deepEqual(resolverFalloDelJob(1, "PERMANENTE", AHORA, LIMITES), { estado: "FAILED" });
});

test("clasificarFallo: una descarga de audio fallida (ítem 162) usa el mismo corte que el envío", () => {
  const descarga = (status: number) => new ErrorDeDescarga(new WhatsappGraphError(status, "x"));
  assert.equal(clasificarFallo(descarga(404)), "PERMANENTE");
  assert.equal(clasificarFallo(descarga(401)), "PERMANENTE");
  assert.equal(clasificarFallo(descarga(429)), "TRANSITORIO");
  assert.equal(clasificarFallo(descarga(500)), "TRANSITORIO");
  assert.equal(clasificarFallo(new ErrorDeDescarga(new Error("fetch failed"))), "TRANSITORIO");
});

test("descargarAdjuntos: baja solo los pendientes con media, y los deja como audio en base64 por id de Message", async () => {
  const pedidos: string[] = [];
  const adjuntos = await descargarAdjuntos(
    [
      { messageId: "m-texto", mediaId: null, mediaType: null },
      { messageId: "m-audio", mediaId: "media-1", mediaType: "audio/ogg; codecs=opus" },
    ],
    {
      accessToken: () => "token",
      downloadMedia: ({ mediaId, accessToken }) => {
        assert.equal(accessToken, "token");
        pedidos.push(mediaId);
        return Promise.resolve({ data: Buffer.from("ABC"), mimeType: "audio/ogg" });
      },
    },
  );
  assert.deepEqual(pedidos, ["media-1"]);
  assert.deepEqual(
    [...adjuntos.entries()],
    [["m-audio", { type: "audio", data: "QUJD", mimeType: "audio/ogg; codecs=opus" }]],
  );
});

test("descargarAdjuntos (ítem 163): el tipo de parte sale del mime — image/* es imagen, lo demás audio", async () => {
  const adjuntos = await descargarAdjuntos(
    [
      { messageId: "m-imagen", mediaId: "media-1", mediaType: "image/jpeg" },
      { messageId: "m-audio", mediaId: "media-2", mediaType: "audio/ogg; codecs=opus" },
      // Sin mediaType en el job manda el mime de la descarga, también para el tipo.
      { messageId: "m-sin-mime", mediaId: "media-3", mediaType: null },
    ],
    {
      accessToken: () => "token",
      downloadMedia: ({ mediaId }) =>
        Promise.resolve({
          data: Buffer.from("ABC"),
          mimeType: mediaId === "media-3" ? "image/png" : "application/octet-stream",
        }),
    },
  );
  assert.deepEqual(
    [...adjuntos.entries()],
    [
      ["m-imagen", { type: "image", data: "QUJD", mimeType: "image/jpeg" }],
      ["m-audio", { type: "audio", data: "QUJD", mimeType: "audio/ogg; codecs=opus" }],
      ["m-sin-mime", { type: "image", data: "QUJD", mimeType: "image/png" }],
    ],
  );
});

test("descargarAdjuntos: sin WHATSAPP_ACCESS_TOKEN falla TRANSITORIO, sin llamar a Meta", async () => {
  let llamadas = 0;
  await assert.rejects(
    descargarAdjuntos([{ messageId: "m", mediaId: "media-1", mediaType: "audio/ogg" }], {
      accessToken: () => undefined,
      downloadMedia: () => {
        llamadas++;
        return Promise.resolve({ data: Buffer.alloc(0), mimeType: "audio/ogg" });
      },
    }),
    (err: unknown) => {
      assert.ok(err instanceof ErrorDeDescarga);
      assert.match(err.message, /WHATSAPP_ACCESS_TOKEN/);
      assert.equal(clasificarFallo(err), "TRANSITORIO");
      return true;
    },
  );
  assert.equal(llamadas, 0);
});

test("descargarAdjuntos: sin pendientes con media no llama a Meta ni exige el token", async () => {
  const adjuntos = await descargarAdjuntos([{ messageId: "m", mediaId: null, mediaType: null }], {
    accessToken: () => undefined,
    downloadMedia: () => Promise.reject(new Error("no debería llamarse")),
  });
  assert.equal(adjuntos.size, 0);
});

// ---------------------------------------------------------------------------
// Messenger e Instagram (ítem 172). El envío se prueba en sus dos piezas
// puras —resolverTokenDePagina y enviarPorElCanal— y en procesarJob solo lo
// que corta ANTES de tocar la base. El recorrido completo (turno, envío,
// delivery_status, conexión en ERROR) está en
// src/controllers/metaWebhook.controller.integration-test.ts.
// ---------------------------------------------------------------------------

function jobDe(channel: ConversationChannel): JobReclamado {
  return {
    id: "job-1",
    organizationId: "org-1",
    messageId: "msg-1",
    channel,
    channelAccountId: channel === "WHATSAPP" ? "phone-1" : "pagina-1",
    externalUserId: channel === "WHATSAPP" ? "5491155550000" : `${channel.toLowerCase()}-sid-1`,
    attempts: 1,
    responseMessageId: null,
  };
}

function depsQueRegistran() {
  const whatsapp: SendWhatsappTextInput[] = [];
  const meta: SendMetaTextInput[] = [];
  const tokensPedidos: [string, string][] = [];
  const deps: DepsDeEnvio = {
    accessToken: () => "token-whatsapp",
    sendText: async (input) => {
      whatsapp.push(input);
      return { wamid: "wamid.del-doble" };
    },
    downloadMedia: () => Promise.reject(new Error("no debería bajar nada")),
    pageAccessToken: async (organizationId, pageId) => {
      tokensPedidos.push([organizationId, pageId]);
      return "token-de-pagina";
    },
    sendMetaText: async (input) => {
      meta.push(input);
    },
  };
  return { deps, whatsapp, meta, tokensPedidos };
}

for (const channel of ["MESSENGER", "INSTAGRAM"] as const) {
  test(`${channel}: el token se pide por organización y Page ID, y la respuesta sale por el Send API al ${channel === "MESSENGER" ? "PSID" : "IGSID"}, sin tocar WhatsApp`, async () => {
    const { deps, whatsapp, meta, tokensPedidos } = depsQueRegistran();
    const job = jobDe(channel);

    const token = await resolverTokenDePagina(job, deps);
    assert.equal(token, "token-de-pagina");
    assert.deepEqual(tokensPedidos, [["org-1", "pagina-1"]]);

    // WA-1: Messenger e Instagram no tienen wamid que guardar.
    assert.equal(await enviarPorElCanal(job, { id: "m-1", content: "¡Hola!" }, token, deps), null);
    assert.deepEqual(meta, [
      { pageAccessToken: "token-de-pagina", recipientId: job.externalUserId, text: "¡Hola!" },
    ]);
    assert.equal(whatsapp.length, 0);
  });
}

test("WHATSAPP: no pide token de página y manda exactamente como antes", async () => {
  const { deps, whatsapp, meta, tokensPedidos } = depsQueRegistran();
  const job = jobDe("WHATSAPP");

  const token = await resolverTokenDePagina(job, deps);
  assert.equal(token, null);
  assert.equal(tokensPedidos.length, 0);

  // WA-1: devuelve el wamid que dio Meta, para guardarlo en el Message.
  assert.equal(
    await enviarPorElCanal(job, { id: "m-1", content: "¡Hola!" }, token, deps),
    "wamid.del-doble",
  );
  assert.deepEqual(whatsapp, [
    {
      phoneNumberId: "phone-1",
      to: "5491155550000",
      body: "¡Hola!",
      accessToken: "token-whatsapp",
    },
  ]);
  assert.equal(meta.length, 0);
});

test("procesarJob: página reconectada o conexión REVOKED/ERROR → falla PERMANENTE antes del turno, sin llamar a Meta", async () => {
  for (const mensaje of [MENSAJE_PAGINA_RECONECTADA, MENSAJE_CONEXION_INACTIVA]) {
    const { deps, meta } = depsQueRegistran();
    deps.pageAccessToken = () => Promise.reject(new AppError(mensaje, 409));
    for (const channel of ["MESSENGER", "INSTAGRAM"] as const) {
      await assert.rejects(procesarJob(jobDe(channel), deps), (err: unknown) => {
        assert.ok(err instanceof AppError, channel);
        assert.equal(err.message, mensaje);
        assert.equal(clasificarFallo(err), "PERMANENTE");
        return true;
      });
    }
    assert.equal(meta.length, 0);
  }
});

test("clasificarFallo: MetaSendError — rate limits por código (aun con 400) y 5xx transitorios; fuera de ventana, token y bloqueo permanentes", () => {
  const envio = (status: number, codigo: number | null, subcodigo: number | null = null) =>
    new ErrorDeEnvio(new MetaSendError(status, "x", codigo, subcodigo), "MESSENGER");
  assert.equal(clasificarFallo(envio(400, 4)), "TRANSITORIO");
  assert.equal(clasificarFallo(envio(400, 613)), "TRANSITORIO");
  assert.equal(clasificarFallo(envio(500, 2)), "TRANSITORIO");
  assert.equal(clasificarFallo(envio(503, null)), "TRANSITORIO");
  assert.equal(
    clasificarFallo(envio(400, 10, 2018278)),
    "PERMANENTE",
    "fuera de la ventana de 24 h",
  );
  assert.equal(clasificarFallo(envio(401, 190)), "PERMANENTE", "token inválido");
  assert.equal(clasificarFallo(envio(400, 551)), "PERMANENTE", "el usuario no recibe");
  // Sin respuesta de Meta (red, timeout): se reintenta, igual que WhatsApp.
  assert.equal(
    clasificarFallo(new ErrorDeEnvio(new Error("fetch failed"), "INSTAGRAM")),
    "TRANSITORIO",
  );
});

test("ErrorDeEnvio nombra el canal por el que no salió la respuesta", () => {
  assert.match(new ErrorDeEnvio(new Error("x"), "INSTAGRAM").message, /por Instagram/);
  assert.match(new ErrorDeEnvio(new Error("x")).message, /por WhatsApp/);
});

// ---------------------------------------------------------------------------
// OPUS-D-01 (docs-privados/auditoria-2026-10-04-OPUS.md, local): los límites de
// envío de WhatsApp llegan con HTTP 400 y antes se trataban como permanentes.
// ---------------------------------------------------------------------------

const errorDeWhatsapp = (status: number, code: number) =>
  new WhatsappGraphError(status, JSON.stringify({ error: { message: "x", code } }));

test("OPUS-D-01: un límite de envío de WhatsApp (HTTP 400 con su código) se reintenta; un 400 cualquiera sigue siendo permanente", () => {
  for (const codigo of [4, 80007, 130429, 131056]) {
    assert.equal(
      clasificarFallo(new ErrorDeEnvio(errorDeWhatsapp(400, codigo))),
      "TRANSITORIO",
      String(codigo),
    );
  }
  // Fuera de la ventana de 24 h (131047), destinatario inválido (131026),
  // parámetro inválido (100): reintentar no los arregla.
  for (const codigo of [131047, 131026, 100]) {
    assert.equal(
      clasificarFallo(new ErrorDeEnvio(errorDeWhatsapp(400, codigo))),
      "PERMANENTE",
      String(codigo),
    );
  }
  // Un cuerpo que no es el JSON de Meta: decide el status, como antes.
  assert.equal(clasificarFallo(new ErrorDeEnvio(new WhatsappGraphError(400, "x"))), "PERMANENTE");
  assert.equal(clasificarFallo(new ErrorDeEnvio(new WhatsappGraphError(503, "x"))), "TRANSITORIO");
});

// ---------------------------------------------------------------------------
// OPUS-B-02 / FABLE-B-05 (docs-privados, local): una respuesta más larga que el
// tope del canal sale en varios mensajes en vez de fallar para siempre.
// ---------------------------------------------------------------------------

const RESPUESTA_LARGA = Array.from(
  { length: 10 },
  (_, i) =>
    `${String(i + 1)}. Volkswagen T-Cross Comfortline 2023 — 35.000 km, caja automática, nafta, gris plata. Precio de lista: USD 25.400. Acepta permuta y tiene financiación disponible.`,
).join("\n\n");

test("OPUS-B-02: por Instagram una respuesta larga sale en varios mensajes, en orden y cada uno dentro del tope", async () => {
  olvidarPartesEnviadasParaTests();
  const { deps, meta } = depsQueRegistran();
  const job = jobDe("INSTAGRAM");
  assert.ok(Buffer.byteLength(RESPUESTA_LARGA, "utf8") > 1000);

  await enviarPorElCanal(job, { id: "m-largo", content: RESPUESTA_LARGA }, "token-de-pagina", deps);

  assert.ok(meta.length > 1, "más de un mensaje");
  for (const envio of meta) {
    assert.ok(Buffer.byteLength(envio.text, "utf8") <= 950);
    assert.equal(envio.recipientId, job.externalUserId);
  }
  assert.equal(meta.map((e) => e.text).join("\n\n"), RESPUESTA_LARGA);
});

test("OPUS-B-02: si una parte falla, el reintento sigue desde esa parte y no repite las que ya salieron", async () => {
  olvidarPartesEnviadasParaTests();
  const { deps, meta } = depsQueRegistran();
  const job = jobDe("INSTAGRAM");
  const mensaje = { id: "m-reintento", content: RESPUESTA_LARGA };
  const enviar = deps.sendMetaText;
  let fallarLaSegunda = true;
  deps.sendMetaText = async (input) => {
    if (fallarLaSegunda && meta.length === 1) {
      fallarLaSegunda = false;
      throw new MetaSendError(400, "rate limit", 613, null);
    }
    await enviar(input);
  };

  await assert.rejects(enviarPorElCanal(job, mensaje, "token-de-pagina", deps), MetaSendError);
  assert.equal(meta.length, 1, "salió solo la primera");

  await enviarPorElCanal(job, mensaje, "token-de-pagina", deps);

  assert.equal(
    meta.map((e) => e.text).join("\n\n"),
    RESPUESTA_LARGA,
    "el cliente recibe el texto completo una sola vez",
  );
});

test("OPUS-B-02: un mensaje corto sigue siendo UN envío, igual que antes", async () => {
  olvidarPartesEnviadasParaTests();
  const { deps, meta, whatsapp } = depsQueRegistran();
  await enviarPorElCanal(jobDe("MESSENGER"), { id: "m-corto", content: "¡Hola!" }, "t", deps);
  await enviarPorElCanal(jobDe("WHATSAPP"), { id: "m-corto-wa", content: "¡Hola!" }, null, deps);
  assert.equal(meta.length, 1);
  assert.equal(whatsapp.length, 1);
});
