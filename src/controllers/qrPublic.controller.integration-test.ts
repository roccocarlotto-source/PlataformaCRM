import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import express from "express";
import { prisma } from "../lib/prisma";
import { errorHandler } from "../middlewares/errorHandler";
import { notFound } from "../middlewares/notFound";
import { qrPublicRouter } from "../routes/qrPublic.routes";
import { createBranch } from "../services/branch.service";
import { createDigitalQrCode, deleteQrCode } from "../services/qr.service";

// ---------------------------------------------------------------------------
// GET/POST /qr/resolve/:qrId por HTTP real, contra Postgres real, sin mocks —
// mismo criterio que googleCalendarWebhook.controller.integration-test. La app
// monta SOLO este router con la cadena real (router + notFound + errorHandler).
//
// Lo que este archivo fija: los 6 casos de estado del árbol de la guía para el
// GET, el consumo atómico + fallback a lectura real para el POST, y la carrera
// "dos POST concurrentes al mismo single-use: solo uno consume".
//
// fetch con redirect: "manual" en todos los casos: lo que se afirma es la
// respuesta de ESTE servidor (302 + Location), nunca se sigue el destino.
// ---------------------------------------------------------------------------

const TZ = "America/Argentina/Buenos_Aires";
const DESTINO = "https://g.page/r/test/review";

let baseUrl: string;
let closeApp: () => Promise<void>;

function startTestApp(): Promise<{ url: string; close: () => Promise<void> }> {
  const app = express();
  app.use(qrPublicRouter);
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

interface Escenario {
  organizationId: string;
  branchId: string;
}

async function montar(
  etiqueta: string,
  billing: { qrSubscriptionStatus?: "ACTIVE" | "INACTIVE"; qrBillingExempt?: boolean } = {},
): Promise<Escenario> {
  const org = await prisma.organization.create({
    data: {
      name: `QR público ${etiqueta} ${randomUUID()}`,
      slug: `qr-pub-${etiqueta}-${Date.now()}-${randomUUID().slice(0, 8)}`,
      qrSubscriptionStatus: billing.qrSubscriptionStatus ?? "ACTIVE",
      qrBillingExempt: billing.qrBillingExempt ?? false,
    },
  });
  const branch = await createBranch(org.id, { name: "Centro", timezone: TZ });
  return { organizationId: org.id, branchId: branch.id };
}

async function desmontar(e: Escenario) {
  await prisma.qrCode.deleteMany({ where: { organizationId: e.organizationId } });
  await prisma.branch.deleteMany({ where: { organizationId: e.organizationId } });
  await prisma.organization.delete({ where: { id: e.organizationId } });
}

function crear(e: Escenario, qrType: "REUSABLE" | "SINGLE_USE") {
  return createDigitalQrCode(e.organizationId, {
    branchId: e.branchId,
    name: "Mostrador",
    destinationUrl: DESTINO,
    message: null,
    qrType,
  });
}

function get(qrId: string) {
  return fetch(`${baseUrl}/qr/resolve/${qrId}`, { redirect: "manual" });
}

function post(qrId: string) {
  return fetch(`${baseUrl}/qr/resolve/${qrId}`, { method: "POST", redirect: "manual" });
}

async function esLandingGenerica(res: Response) {
  assert.ok(res.headers.get("content-type")?.startsWith("text/html"));
  const html = await res.text();
  assert.ok(html.includes("Este código todavía no está activo"), "landing genérica");
  return html;
}

// ---------------------------------------------------------------------------
// GET — los 6 casos de estado
// ---------------------------------------------------------------------------

test("GET: no encontrado, malformado y borrado -> 404 con la MISMA landing y sin link de claim (DEC-007)", async () => {
  const e = await montar("404");
  try {
    const borrado = await crear(e, "REUSABLE");
    await deleteQrCode(e.organizationId, borrado.id);

    const htmls: string[] = [];
    for (const id of [randomUUID(), "no-es-un-uuid", borrado.id]) {
      const res = await get(id);
      assert.equal(res.status, 404, id);
      htmls.push(await esLandingGenerica(res));
    }
    assert.equal(new Set(htmls).size, 1, "las tres respuestas son byte a byte idénticas");
    assert.equal(htmls[0].includes("¿Sos el dueño"), false);
  } finally {
    await desmontar(e);
  }
});

test("GET: reusable con organización activa -> 302 al destino", async () => {
  const e = await montar("reusable-activo");
  try {
    const qr = await crear(e, "REUSABLE");
    const res = await get(qr.id);
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), DESTINO);
  } finally {
    await desmontar(e);
  }
});

test("GET: reusable con organización inactiva -> 200 landing genérica; con billing exempt -> 302 igual", async () => {
  const inactiva = await montar("reusable-inactivo", { qrSubscriptionStatus: "INACTIVE" });
  const exenta = await montar("reusable-exento", {
    qrSubscriptionStatus: "INACTIVE",
    qrBillingExempt: true,
  });
  try {
    const qrInactivo = await crear(inactiva, "REUSABLE");
    const res = await get(qrInactivo.id);
    assert.equal(res.status, 200);
    await esLandingGenerica(res);

    const qrExento = await crear(exenta, "REUSABLE");
    const res2 = await get(qrExento.id);
    assert.equal(res2.status, 302);
    assert.equal(res2.headers.get("location"), DESTINO);
  } finally {
    await desmontar(inactiva);
    await desmontar(exenta);
  }
});

test("GET: single-use sin usar y activo -> 200 con el form de Continuar, sin la URL de destino, y NUNCA consume", async () => {
  const e = await montar("single-confirm");
  try {
    const qr = await crear(e, "SINGLE_USE");

    for (let i = 0; i < 3; i++) {
      const res = await get(qr.id);
      assert.equal(res.status, 200);
      const html = await res.text();
      assert.ok(html.includes('<form method="POST">'));
      assert.equal(
        html.includes(DESTINO),
        false,
        "la página no revela el destino antes del consumo",
      );
    }

    const fila = await prisma.qrCode.findUnique({ where: { id: qr.id } });
    assert.equal(fila?.usedAt, null, "tres GET seguidos no consumieron nada");
  } finally {
    await desmontar(e);
  }
});

test("GET: single-use sin usar con organización inactiva -> landing genérica (NO 'ya usado')", async () => {
  const e = await montar("single-inactivo", { qrSubscriptionStatus: "INACTIVE" });
  try {
    const qr = await crear(e, "SINGLE_USE");
    const res = await get(qr.id);
    assert.equal(res.status, 200);
    const html = await esLandingGenerica(res);
    assert.equal(html.includes("ya fue utilizado"), false);
    assert.equal(html.includes("Continuar"), false);
  } finally {
    await desmontar(e);
  }
});

test("GET: single-use ya usado -> 200 'ya fue utilizado' — la única excepción a DEC-007", async () => {
  const e = await montar("single-usado");
  try {
    const qr = await crear(e, "SINGLE_USE");
    await prisma.qrCode.update({ where: { id: qr.id }, data: { usedAt: new Date() } });
    const res = await get(qr.id);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes("Este código ya fue utilizado"));
    assert.equal(html.includes("<form"), false);
  } finally {
    await desmontar(e);
  }
});

// ---------------------------------------------------------------------------
// POST — consumo atómico + fallback a lectura real
// ---------------------------------------------------------------------------

test("POST: el primer consumo redirige y setea usedAt; el segundo y el tercero muestran 'ya usado' sin mover usedAt", async () => {
  const e = await montar("consume");
  try {
    const qr = await crear(e, "SINGLE_USE");

    const primero = await post(qr.id);
    assert.equal(primero.status, 302);
    assert.equal(primero.headers.get("location"), DESTINO);

    const despues = await prisma.qrCode.findUnique({ where: { id: qr.id } });
    assert.notEqual(despues?.usedAt, null);

    for (let i = 0; i < 2; i++) {
      const otra = await post(qr.id);
      assert.equal(otra.status, 200);
      assert.ok((await otra.text()).includes("Este código ya fue utilizado"));
    }
    const final = await prisma.qrCode.findUnique({ where: { id: qr.id } });
    assert.equal(final?.usedAt?.getTime(), despues?.usedAt?.getTime());
  } finally {
    await desmontar(e);
  }
});

test("POST: con la organización inactiva NO consume (usedAt sigue null) y muestra la landing genérica", async () => {
  const e = await montar("consume-inactivo", { qrSubscriptionStatus: "INACTIVE" });
  try {
    const qr = await crear(e, "SINGLE_USE");
    const res = await post(qr.id);
    assert.equal(res.status, 200);
    await esLandingGenerica(res);

    const fila = await prisma.qrCode.findUnique({ where: { id: qr.id } });
    assert.equal(fila?.usedAt, null);

    // Reactivada, el mismo QR se puede consumir: nada se perdió en el intento.
    await prisma.organization.update({
      where: { id: e.organizationId },
      data: { qrSubscriptionStatus: "ACTIVE" },
    });
    const ahora = await post(qr.id);
    assert.equal(ahora.status, 302);
  } finally {
    await desmontar(e);
  }
});

test("POST: sobre un reusable es un no-op seguro — responde exactamente como el GET y no escribe nada", async () => {
  const e = await montar("consume-reusable");
  try {
    const qr = await crear(e, "REUSABLE");
    const res = await post(qr.id);
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), DESTINO);

    const fila = await prisma.qrCode.findUnique({ where: { id: qr.id } });
    assert.equal(fila?.usedAt, null);
  } finally {
    await desmontar(e);
  }
});

test("POST: no encontrado / malformado / borrado -> 404 landing, igual que el GET", async () => {
  const e = await montar("consume-404");
  try {
    const borrado = await crear(e, "SINGLE_USE");
    await deleteQrCode(e.organizationId, borrado.id);
    for (const id of [randomUUID(), "no-es-un-uuid", borrado.id]) {
      const res = await post(id);
      assert.equal(res.status, 404, id);
      await esLandingGenerica(res);
    }
    const fila = await prisma.qrCode.findUnique({ where: { id: borrado.id } });
    assert.equal(fila?.usedAt, null, "un borrado no se consume");
  } finally {
    await desmontar(e);
  }
});

test("POST: dos consumos concurrentes del mismo single-use — exactamente uno redirige, nunca los dos", async () => {
  const e = await montar("consume-carrera");
  try {
    const qr = await crear(e, "SINGLE_USE");

    const [a, b] = await Promise.all([post(qr.id), post(qr.id)]);
    const statuses = [a.status, b.status].sort();
    assert.deepEqual(statuses, [200, 302], "uno consume (302), el otro ve 'ya usado' (200)");

    const perdedor = a.status === 200 ? a : b;
    assert.ok((await perdedor.text()).includes("Este código ya fue utilizado"));
  } finally {
    await desmontar(e);
  }
});
