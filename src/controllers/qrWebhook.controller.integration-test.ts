import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import express from "express";
import { prisma } from "../lib/prisma";
import { envolverParserConTraduccion } from "../middlewares/bodyParserError";
import { errorHandler } from "../middlewares/errorHandler";
import { notFound } from "../middlewares/notFound";
import { AppError } from "../utils/AppError";
import { buildManifest, hmacSha256Hex } from "../utils/mercadopagoSignature";
import type { PreapprovalResource } from "../services/qrWebhook.service";
import {
  createQrWebhookHandler,
  createVerifyMercadopagoSignature,
  type QrWebhookDeps,
} from "./qrWebhook.controller";

// ---------------------------------------------------------------------------
// POST /webhooks/mercadopago por HTTP real, contra Postgres real, con la MISMA
// cadena de middlewares que routes/qrWebhook.routes.ts pero con las
// dependencias inyectadas: un secreto conocido, un reloj fijo y un doble de la
// API de MercadoPago que devuelve lo que cada test decide. Nunca se habla con
// MercadoPago.
//
// Lo que este archivo fija (docs/qr-integration.md, "Verificación"):
//   - firma inválida -> 401 SIN tocar la base;
//   - idempotencia real: la misma notificación dos veces -> la segunda es un
//     no-op (200 duplicate), nunca dos QrSubscriptionStatusChange;
//   - TF-005: dos notificaciones con el mismo data.id pero distinto id de
//     notificación se procesan AMBAS;
//   - los 200 "ignored" (tipo que no importa, estado sin mapeo, preapproval
//     sin organización) y el 502 si MercadoPago no responde.
// ---------------------------------------------------------------------------

const SECRET = "test_webhook_secret";
const ACCESS_TOKEN = "test_access_token";
const NOW_MS = 1_800_000_000_000;

// El doble de MercadoPago: cada test registra qué devuelve para cada
// preapprovalId. Una entrada ausente simula "MercadoPago no responde".
const preapprovals = new Map<string, PreapprovalResource>();
let llamadasAMercadoPago = 0;

const deps: QrWebhookDeps = {
  webhookSecret: () => SECRET,
  accessToken: () => ACCESS_TOKEN,
  nowMs: () => NOW_MS,
  fetchPreapproval: async (preapprovalId, accessToken) => {
    llamadasAMercadoPago++;
    assert.equal(accessToken, ACCESS_TOKEN, "el re-fetch va con el access token del entorno");
    const recurso = preapprovals.get(preapprovalId);
    if (!recurso) {
      throw new Error(`MercadoPago API returned 500 for preapproval ${preapprovalId}`);
    }
    return recurso;
  },
};

let baseUrl: string;
let closeApp: () => Promise<void>;

// Réplica exacta de la cadena de routes/qrWebhook.routes.ts, con los factories.
// No se importa el router real porque ese ya está atado a las deps del entorno.
function startTestApp(): Promise<{ url: string; close: () => Promise<void> }> {
  const app = express();
  const parser = envolverParserConTraduccion(
    express.json({ limit: 64 * 1024, type: "application/json" }),
    {
      demasiado_grande: { message: "demasiado grande", statusCode: 413 },
      cuerpo_invalido: { message: "El cuerpo del request no es JSON válido", statusCode: 400 },
      codificacion_no_soportada: { message: "codificación", statusCode: 415 },
    },
  );
  app.post(
    "/webhooks/mercadopago",
    createVerifyMercadopagoSignature(deps),
    (req, _res, next) => {
      if (!req.is("application/json")) {
        next(new AppError("El webhook solo acepta application/json", 400));
        return;
      }
      next();
    },
    parser,
    createQrWebhookHandler(deps),
  );
  app.use(notFound);
  app.use(errorHandler);

  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

before(async () => {
  const started = await startTestApp();
  baseUrl = started.url;
  closeApp = started.close;
});

after(async () => {
  if (closeApp) await closeApp();
});

// Un request firmado como lo firmaría MercadoPago: ts dentro de la ventana del
// reloj fijo, manifiesto sobre data.id + x-request-id + ts.
function notificar(opts: {
  dataId: string;
  body: unknown;
  firma?: "valida" | "invalida" | "ausente" | "vencida";
  contentType?: string;
  rawBody?: string;
}): Promise<Response> {
  const requestId = randomUUID();
  const ts =
    opts.firma === "vencida"
      ? String(Math.floor(NOW_MS / 1000) - 3600)
      : String(Math.floor(NOW_MS / 1000) - 5);
  const secreto = opts.firma === "invalida" ? "otro_secreto" : SECRET;
  const v1 = hmacSha256Hex(secreto, buildManifest(opts.dataId, requestId, ts));

  const headers: Record<string, string> = {
    "x-request-id": requestId,
    "content-type": opts.contentType ?? "application/json",
  };
  if (opts.firma !== "ausente") {
    headers["x-signature"] = `ts=${ts},v1=${v1}`;
  }

  return fetch(`${baseUrl}/webhooks/mercadopago?data.id=${encodeURIComponent(opts.dataId)}`, {
    method: "POST",
    headers,
    body: opts.rawBody ?? JSON.stringify(opts.body),
  });
}

function evento(
  notificationId: string | number,
  preapprovalId: string,
  type = "subscription_preapproval",
) {
  return { id: notificationId, type, action: "updated", data: { id: preapprovalId } };
}

interface Escenario {
  organizationId: string;
  preapprovalId: string;
}

async function montar(etiqueta: string): Promise<Escenario> {
  const preapprovalId = `PA-${randomUUID()}`;
  const org = await prisma.organization.create({
    data: {
      name: `QR webhook ${etiqueta} ${randomUUID()}`,
      slug: `qr-wh-${etiqueta}-${Date.now()}-${randomUUID().slice(0, 8)}`,
      qrMercadopagoSubscriptionId: preapprovalId,
    },
  });
  return { organizationId: org.id, preapprovalId };
}

async function desmontar(e: Escenario) {
  preapprovals.delete(e.preapprovalId);
  await prisma.qrSubscriptionStatusChange.deleteMany({
    where: { organizationId: e.organizationId },
  });
  await prisma.paymentEvent.deleteMany({ where: { organizationId: e.organizationId } });
  await prisma.organization.delete({ where: { id: e.organizationId } });
}

async function estado(e: Escenario) {
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: e.organizationId },
    select: { qrSubscriptionStatus: true },
  });
  const cambios = await prisma.qrSubscriptionStatusChange.findMany({
    where: { organizationId: e.organizationId },
    orderBy: { createdAt: "asc" },
  });
  const eventos = await prisma.paymentEvent.count({ where: { organizationId: e.organizationId } });
  return { status: org.qrSubscriptionStatus, cambios, eventos };
}

// ---------------------------------------------------------------------------
// Firma (pasos 1 y 2): nada de esto toca la base ni a MercadoPago
// ---------------------------------------------------------------------------

test("firma inválida, ausente o vencida -> 401, sin llamar a MercadoPago y sin escribir nada", async () => {
  const e = await montar("firma");
  try {
    preapprovals.set(e.preapprovalId, { id: e.preapprovalId, status: "authorized" });
    const antes = llamadasAMercadoPago;

    for (const firma of ["invalida", "ausente", "vencida"] as const) {
      const res = await notificar({
        dataId: e.preapprovalId,
        body: evento(1, e.preapprovalId),
        firma,
      });
      assert.equal(res.status, 401, firma);
    }

    assert.equal(llamadasAMercadoPago, antes, "ninguna llamada a MercadoPago");
    const s = await estado(e);
    assert.equal(s.status, "INACTIVE");
    assert.equal(s.eventos, 0);
    assert.equal(s.cambios.length, 0);
  } finally {
    await desmontar(e);
  }
});

test("sin data.id -> 400 antes de la firma", async () => {
  const res = await fetch(`${baseUrl}/webhooks/mercadopago`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-request-id": "r" },
    body: "{}",
  });
  assert.equal(res.status, 400);
});

test("firma válida pero body que no es JSON -> 400, y Content-Type que no es JSON -> 400", async () => {
  const e = await montar("body");
  try {
    const invalido = await notificar({
      dataId: e.preapprovalId,
      body: null,
      rawBody: "{no es json",
    });
    assert.equal(invalido.status, 400);

    const texto = await notificar({
      dataId: e.preapprovalId,
      body: evento(1, e.preapprovalId),
      contentType: "text/plain",
    });
    assert.equal(texto.status, 400);
  } finally {
    await desmontar(e);
  }
});

// ---------------------------------------------------------------------------
// Camino feliz y los 200 que no son errores
// ---------------------------------------------------------------------------

test("authorized -> ACTIVE con PaymentEvent + QrSubscriptionStatusChange (source webhook, sin admin)", async () => {
  const e = await montar("feliz");
  try {
    preapprovals.set(e.preapprovalId, { id: e.preapprovalId, status: "authorized" });

    const res = await notificar({ dataId: e.preapprovalId, body: evento(1001, e.preapprovalId) });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });

    const s = await estado(e);
    assert.equal(s.status, "ACTIVE");
    assert.equal(s.eventos, 1);
    assert.equal(s.cambios.length, 1);
    assert.equal(s.cambios[0].previousStatus, "INACTIVE");
    assert.equal(s.cambios[0].newStatus, "ACTIVE");
    assert.equal(s.cambios[0].source, "MERCADOPAGO_WEBHOOK");
    assert.equal(s.cambios[0].changedByPlatformAdminId, null);

    const evt = await prisma.paymentEvent.findUnique({ where: { mercadopagoEventId: "1001" } });
    assert.equal(evt?.eventType, "authorized");
    assert.equal(evt?.organizationId, e.organizationId);
  } finally {
    await desmontar(e);
  }
});

test("idempotencia: la misma notificación dos veces -> 200 duplicate, un solo cambio de estado", async () => {
  const e = await montar("dup");
  try {
    preapprovals.set(e.preapprovalId, { id: e.preapprovalId, status: "authorized" });

    const primera = await notificar({
      dataId: e.preapprovalId,
      body: evento(2001, e.preapprovalId),
    });
    assert.equal(primera.status, 200);

    // Entre medio, un platform admin la desactiva a mano: el replay NO tiene
    // que volver a activarla.
    await prisma.organization.update({
      where: { id: e.organizationId },
      data: { qrSubscriptionStatus: "INACTIVE" },
    });

    const replay = await notificar({
      dataId: e.preapprovalId,
      body: evento(2001, e.preapprovalId),
    });
    assert.equal(replay.status, 200);
    assert.deepEqual(await replay.json(), { ok: true, duplicate: true });

    const s = await estado(e);
    assert.equal(s.status, "INACTIVE", "el replay no reaplicó el cambio");
    assert.equal(s.eventos, 1);
    assert.equal(s.cambios.length, 1);
  } finally {
    await desmontar(e);
  }
});

test("TF-005: dos notificaciones con el MISMO data.id y distinto id se procesan ambas (authorized -> cancelled)", async () => {
  const e = await montar("tf005");
  try {
    preapprovals.set(e.preapprovalId, { id: e.preapprovalId, status: "authorized" });
    const a = await notificar({ dataId: e.preapprovalId, body: evento(3001, e.preapprovalId) });
    assert.equal(a.status, 200);

    preapprovals.set(e.preapprovalId, { id: e.preapprovalId, status: "cancelled" });
    const b = await notificar({ dataId: e.preapprovalId, body: evento(3002, e.preapprovalId) });
    assert.equal(b.status, 200);
    assert.deepEqual(await b.json(), { ok: true });

    const s = await estado(e);
    assert.equal(s.status, "INACTIVE");
    assert.equal(s.eventos, 2);
    assert.deepEqual(
      s.cambios.map((c) => `${c.previousStatus}->${c.newStatus}`),
      ["INACTIVE->ACTIVE", "ACTIVE->INACTIVE"],
    );
  } finally {
    await desmontar(e);
  }
});

test("mismo estado que el actual: se registra el PaymentEvent pero NO se audita un cambio", async () => {
  const e = await montar("sin-cambio");
  try {
    preapprovals.set(e.preapprovalId, { id: e.preapprovalId, status: "paused" });
    const res = await notificar({ dataId: e.preapprovalId, body: evento(4001, e.preapprovalId) });
    assert.equal(res.status, 200);

    const s = await estado(e);
    assert.equal(s.status, "INACTIVE");
    assert.equal(s.eventos, 1);
    assert.equal(s.cambios.length, 0);
  } finally {
    await desmontar(e);
  }
});

test("tipo de evento que no importa -> 200 ignored, sin re-fetch y sin escribir", async () => {
  const e = await montar("tipo");
  try {
    preapprovals.set(e.preapprovalId, { id: e.preapprovalId, status: "authorized" });
    const antes = llamadasAMercadoPago;
    const res = await notificar({
      dataId: e.preapprovalId,
      body: evento(5001, e.preapprovalId, "payment"),
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, ignored: true });
    assert.equal(llamadasAMercadoPago, antes);
    assert.equal((await estado(e)).eventos, 0);
  } finally {
    await desmontar(e);
  }
});

test("estado sin mapeo (pending) -> 200 ignored con el status; preapproval sin organización -> 200 ignored", async () => {
  const e = await montar("ignored");
  try {
    preapprovals.set(e.preapprovalId, { id: e.preapprovalId, status: "pending" });
    const pending = await notificar({
      dataId: e.preapprovalId,
      body: evento(6001, e.preapprovalId),
    });
    assert.equal(pending.status, 200);
    assert.deepEqual(await pending.json(), { ok: true, ignored: true, status: "pending" });

    const huerfano = `PA-huerfano-${randomUUID()}`;
    preapprovals.set(huerfano, { id: huerfano, status: "authorized" });
    const sinOrg = await notificar({ dataId: huerfano, body: evento(6002, huerfano) });
    assert.equal(sinOrg.status, 200);
    assert.deepEqual(await sinOrg.json(), { ok: true, ignored: true });
    preapprovals.delete(huerfano);

    assert.equal((await estado(e)).eventos, 0);
    assert.equal(await prisma.paymentEvent.count({ where: { mercadopagoEventId: "6002" } }), 0);
  } finally {
    await desmontar(e);
  }
});

test("payload sin id de notificación -> 400 (no hay clave de idempotencia con la que registrarlo)", async () => {
  const e = await montar("sin-id");
  try {
    const res = await notificar({
      dataId: e.preapprovalId,
      body: { type: "subscription_preapproval", data: { id: e.preapprovalId } },
    });
    assert.equal(res.status, 400);
    assert.equal((await estado(e)).eventos, 0);
  } finally {
    await desmontar(e);
  }
});

test("MercadoPago no responde al re-fetch -> 502 (para que reintente), sin escribir nada", async () => {
  const e = await montar("502");
  try {
    // Sin entrada en el doble: el fetch tira.
    const res = await notificar({ dataId: e.preapprovalId, body: evento(7001, e.preapprovalId) });
    assert.equal(res.status, 502);
    assert.equal((await estado(e)).eventos, 0);
  } finally {
    await desmontar(e);
  }
});
