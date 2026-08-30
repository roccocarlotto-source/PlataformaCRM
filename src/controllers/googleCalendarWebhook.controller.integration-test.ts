import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import express from "express";
import { prisma } from "../lib/prisma";
import { errorHandler } from "../middlewares/errorHandler";
import { notFound } from "../middlewares/notFound";
import { createBranch } from "../services/branch.service";
import { getCifrador } from "../utils/encryption";
import { firmarWebhookToken } from "../utils/webhookToken";
import { googleCalendarWebhookHandler } from "./googleCalendarWebhook.controller";

// ---------------------------------------------------------------------------
// POST /api/webhooks/google-calendar por HTTP real, contra Postgres real, sin
// mocks — mismo criterio que ingest.controller.integration-test. La app monta
// SOLO esta ruta con la cadena real (handler + notFound + errorHandler).
//
// LO QUE ESTE ARCHIVO FIJA es la política de códigos de respuesta del
// controller, que es el mecanismo de reintento de Google: 200 corta el
// reintento, 403 lo rechaza, 503 lo pide. El caso central es M-4 de
// docs/auditoria-2026-08-29.md: una conexión en ERROR no es transitoria —exige
// que un humano reconecte— y responder 503 hacía que Google reintentara con
// backoff durante días una notificación imposible de procesar.
//
// SIN CLIENTE DE GOOGLE, y no es una omisión: para una conexión YA en ERROR,
// obtenerAccessToken tira el 409 en su primer `if` (status !== "ACTIVE"),
// antes de descifrar nada y antes de hablar con Google. La otra forma de llegar
// al mismo 409 —Google rechaza el grant en caliente y la conexión pasa a ERROR
// en ese momento— necesitaría un doble del cliente, y no se prueba acá porque
// el controller no distingue los dos casos (statusCode === 409): probar uno
// alcanza para el fix de ESTE archivo. La transición a ERROR en sí la cubre
// google-calendar-connection.integration-test.
// ---------------------------------------------------------------------------

let orgId: string;
let branchId: string;
let baseUrl: string;
let closeApp: () => Promise<void>;

function startTestApp(): Promise<{ url: string; close: () => Promise<void> }> {
  const app = express();
  app.post("/api/webhooks/google-calendar", googleCalendarWebhookHandler);
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

// Los tres headers que el handler exige, con los nombres de la guía de push.
// El cuerpo va vacío porque así lo manda Google.
function notificar(headers: {
  channelId: string;
  token: string;
  resourceState?: string;
}): Promise<Response> {
  return fetch(`${baseUrl}/api/webhooks/google-calendar`, {
    method: "POST",
    headers: {
      "x-goog-channel-id": headers.channelId,
      "x-goog-channel-token": headers.token,
      "x-goog-resource-state": headers.resourceState ?? "exists",
      "x-goog-message-number": "1",
    },
  });
}

// Una sucursal NUEVA por cada conexión: (organization_id, branch_id) es único
// en google_calendar_connections —una conexión por sucursal—, así que dos tests
// no pueden compartir la sucursal del fixture. Devuelve lo que hace falta para
// firmar el token de ese canal.
async function sucursalConConexion(
  status: "ACTIVE" | "ERROR",
): Promise<{ branchId: string; channelId: string }> {
  const branch = await createBranch(orgId, {
    name: `Sucursal ${randomUUID().slice(0, 8)}`,
    timezone: "America/Argentina/Buenos_Aires",
  });
  const channelId = randomUUID();

  await prisma.googleCalendarConnection.create({
    data: {
      organizationId: orgId,
      branchId: branch.id,
      refreshToken: getCifrador().encrypt("1//refresh"),
      calendarId: "primary",
      channelId,
      channelResourceId: randomUUID(),
      channelExpiration: new Date(Date.now() + 6 * 24 * 60 * 60 * 1000),
      status,
      ...(status === "ERROR"
        ? { lastErrorAt: new Date(), lastErrorMessage: "invalid_grant: Token has been revoked" }
        : {}),
    },
    select: { id: true },
  });

  return { branchId: branch.id, channelId };
}

before(async () => {
  const started = await startTestApp();
  baseUrl = started.url;
  closeApp = started.close;

  const org = await prisma.organization.create({
    data: {
      name: `Webhook GCal test org ${randomUUID()}`,
      slug: `gcal-webhook-${Date.now()}-${randomUUID().slice(0, 8)}`,
    },
  });
  orgId = org.id;

  const branch = await createBranch(orgId, {
    name: "Centro",
    timezone: "America/Argentina/Buenos_Aires",
  });
  branchId = branch.id;
});

after(async () => {
  if (closeApp) await closeApp();
  if (!orgId) return;

  const where = { organizationId: orgId };
  await prisma.googleCalendarConnection.deleteMany({ where });
  await prisma.workingHours.deleteMany({ where });
  await prisma.branch.deleteMany({ where });
  await prisma.organization.delete({ where: { id: orgId } });
});

// ---------------------------------------------------------------------------
// El caso de M-4.
// ---------------------------------------------------------------------------

test("una notificación válida para una conexión en ERROR responde 200, no 503 (M-4)", async () => {
  const { branchId, channelId } = await sucursalConConexion("ERROR");
  const token = await firmarWebhookToken({ organizationId: orgId, branchId, channelId });

  const res = await notificar({ channelId, token });

  // 503 era el bug: Google reintentaría con backoff hasta 7 días una
  // notificación que no se puede procesar sin que alguien reconecte.
  assert.equal(res.status, 200);

  // La conexión sigue exactamente como estaba: el fix no la "arregla" ni la
  // toca; solo deja de pedirle reintentos a Google.
  const conexion = await prisma.googleCalendarConnection.findUniqueOrThrow({
    where: { channelId },
    select: { status: true, channelId: true },
  });
  assert.equal(conexion.status, "ERROR");
  assert.equal(
    conexion.channelId,
    channelId,
    "el canal sigue registrado: no se cierra en este fix",
  );
});

// ---------------------------------------------------------------------------
// Regresiones: la rama nueva no interceptó lo que ya andaba.
// ---------------------------------------------------------------------------

test("un token que no salió de acá sigue dando 403 — la rama nueva no lo intercepta", async () => {
  const { channelId } = await sucursalConConexion("ERROR");

  const res = await notificar({ channelId, token: "no-es-un-token-firmado" });

  assert.equal(res.status, 403);
});

test("un token válido pero de OTRO canal sigue dando 403, aunque la conexión esté en ERROR", async () => {
  const { branchId, channelId } = await sucursalConConexion("ERROR");
  const tokenDeOtroCanal = await firmarWebhookToken({
    organizationId: orgId,
    branchId,
    channelId: randomUUID(),
  });

  const res = await notificar({ channelId, token: tokenDeOtroCanal });

  assert.equal(res.status, 403);
});

test("un canal que no está en la base sigue dando 200 por el camino de canal desconocido", async () => {
  const canalFantasma = randomUUID();
  const token = await firmarWebhookToken({
    organizationId: orgId,
    branchId,
    channelId: canalFantasma,
  });

  const res = await notificar({ channelId: canalFantasma, token });

  assert.equal(res.status, 200);
});

test("sin los headers de Google es 400, antes de cualquier verificación", async () => {
  const res = await fetch(`${baseUrl}/api/webhooks/google-calendar`, { method: "POST" });
  assert.equal(res.status, 400);
});
