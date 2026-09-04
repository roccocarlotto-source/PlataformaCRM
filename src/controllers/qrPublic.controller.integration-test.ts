import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import express from "express";
import { env } from "../config/env";
import { prisma } from "../lib/prisma";
import { errorHandler } from "../middlewares/errorHandler";
import { notFound } from "../middlewares/notFound";
import { INTERNAL_PROXY_SECRET_HEADER } from "../middlewares/requireInternalProxySecret";
import { qrPublicRouter } from "../routes/qrPublic.routes";
import { createBranch } from "../services/branch.service";
import { createDigitalQrCode, deleteQrCode } from "../services/qr.service";

// ---------------------------------------------------------------------------
// GET /qr/resolve/:qrId por HTTP real, contra Postgres real, sin mocks —
// mismo criterio que googleCalendarWebhook.controller.integration-test. La app
// monta SOLO este router con la cadena real (router + notFound + errorHandler).
//
// Lo que este archivo fija: los 3 casos de estado del árbol de la guía para el
// GET (no encontrado, activo -> redirect, inactivo -> landing), y (Fase 4) que
// el gate de secreto compartido está montado en el router real y que su
// respuesta de falla es byte a byte la de un QR inexistente.
//
// El router lleva requireInternalProxySecret (Fase 4), así que el secreto se
// configura en `env` en el before() y get() manda el header en todos los casos
// de negocio — igual que lo haría el Worker. Los casos del gate en sí están al
// final, y son los únicos que piden sin header o con otro valor.
//
// fetch con redirect: "manual" en todos los casos: lo que se afirma es la
// respuesta de ESTE servidor (302 + Location), nunca se sigue el destino.
//
// HASTA 20260904120000_remove_qr_claim_and_single_use este archivo también
// probaba el POST de consumo de un single-use (y el GET tenía 6 casos, no 3)
// — se eliminaron junto con esa funcionalidad. Ver docs/qr-integration.md,
// sección "Qué se desvió".
// ---------------------------------------------------------------------------

const TZ = "America/Argentina/Buenos_Aires";
const DESTINO = "https://g.page/r/test/review";
const SECRETO = "secreto-de-prueba-qr-resolve";
const SECRETO_ANTERIOR = "secreto-anterior-qr-resolve";

let baseUrl: string;
let closeApp: () => Promise<void>;
const secretoOriginal = env.QR_RESOLVE_PROXY_SECRET;
const secretoAnteriorOriginal = env.QR_RESOLVE_PROXY_SECRET_PREVIOUS;

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
  env.QR_RESOLVE_PROXY_SECRET = SECRETO;
  env.QR_RESOLVE_PROXY_SECRET_PREVIOUS = SECRETO_ANTERIOR;
  const started = await startTestApp();
  baseUrl = started.url;
  closeApp = started.close;
});

after(async () => {
  env.QR_RESOLVE_PROXY_SECRET = secretoOriginal;
  env.QR_RESOLVE_PROXY_SECRET_PREVIOUS = secretoAnteriorOriginal;
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

function crear(e: Escenario) {
  return createDigitalQrCode(e.organizationId, {
    branchId: e.branchId,
    name: "Mostrador",
    destinationUrl: DESTINO,
    message: null,
  });
}

// `secreto` explícito solo lo usan los casos del gate (al final); todo el
// resto manda el actual, como el Worker. `null` = sin header.
function get(qrId: string, secreto: string | null = SECRETO) {
  return fetch(`${baseUrl}/qr/resolve/${qrId}`, {
    redirect: "manual",
    headers: secreto === null ? {} : { [INTERNAL_PROXY_SECRET_HEADER]: secreto },
  });
}

async function esLandingGenerica(res: Response) {
  assert.ok(res.headers.get("content-type")?.startsWith("text/html"));
  const html = await res.text();
  assert.ok(html.includes("Este código todavía no está activo"), "landing genérica");
  return html;
}

// ---------------------------------------------------------------------------
// GET — los 3 casos de estado
// ---------------------------------------------------------------------------

test("no encontrado, malformado y borrado -> 404 con la MISMA landing (DEC-007)", async () => {
  const e = await montar("404");
  try {
    const borrado = await crear(e);
    await deleteQrCode(e.organizationId, borrado.id);

    const htmls: string[] = [];
    for (const id of [randomUUID(), "no-es-un-uuid", borrado.id]) {
      const res = await get(id);
      assert.equal(res.status, 404, id);
      htmls.push(await esLandingGenerica(res));
    }
    assert.equal(new Set(htmls).size, 1, "las tres respuestas son byte a byte idénticas");
  } finally {
    await desmontar(e);
  }
});

test("con organización activa -> 302 al destino", async () => {
  const e = await montar("activo");
  try {
    const qr = await crear(e);
    const res = await get(qr.id);
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), DESTINO);
  } finally {
    await desmontar(e);
  }
});

test("con organización inactiva -> 200 landing genérica; con billing exempt -> 302 igual", async () => {
  const inactiva = await montar("inactivo", { qrSubscriptionStatus: "INACTIVE" });
  const exenta = await montar("exento", {
    qrSubscriptionStatus: "INACTIVE",
    qrBillingExempt: true,
  });
  try {
    const qrInactivo = await crear(inactiva);
    const res = await get(qrInactivo.id);
    assert.equal(res.status, 200);
    await esLandingGenerica(res);

    const qrExento = await crear(exenta);
    const res2 = await get(qrExento.id);
    assert.equal(res2.status, 302);
    assert.equal(res2.headers.get("location"), DESTINO);
  } finally {
    await desmontar(inactiva);
    await desmontar(exenta);
  }
});

// ---------------------------------------------------------------------------
// Gate de secreto compartido (Fase 4) — montado en el router REAL, delante del
// handler. Lo que estos casos afirman y el unitario del middleware no puede:
// que la respuesta de falla es byte a byte la MISMA que el controller produce
// para un QR inexistente (la misma función, no una copia), y que sin el
// header un QR activo de verdad NO redirige — el gate corre antes de tocar la
// base.
// ---------------------------------------------------------------------------

test("gate: sin el header, o con otro valor, un QR ACTIVO responde el mismo 404 que uno inexistente, byte a byte — nunca el redirect ni un 401/403", async () => {
  const e = await montar("gate-falla");
  try {
    const qr = await crear(e);

    // Referencia: el 404 real del controller para un id que no existe, CON el
    // secreto correcto (así lo que responde es el handler, no el gate).
    const referencia = await get(randomUUID());
    assert.equal(referencia.status, 404);
    const htmlReferencia = await esLandingGenerica(referencia);

    const casos: Array<[string, string | null]> = [
      ["sin header", null],
      ["header vacío", ""],
      ["otro valor", "no-es-el-secreto"],
      // Un byte de más (no un espacio: HTTP recorta el whitespace de los
      // bordes de un header antes de que llegue a Express).
      ["casi el secreto", `${SECRETO}x`],
    ];
    for (const [etiqueta, secreto] of casos) {
      const res = await get(qr.id, secreto);
      assert.equal(res.status, 404, etiqueta);
      assert.equal(res.headers.get("location"), null, `${etiqueta}: sin redirect`);
      assert.equal(await res.text(), htmlReferencia, `${etiqueta}: mismo HTML`);
    }

    // Y el QR sigue activo: el gate fallando no tocó nada.
    const ok = await get(qr.id);
    assert.equal(ok.status, 302);
    assert.equal(ok.headers.get("location"), DESTINO);
  } finally {
    await desmontar(e);
  }
});

test("gate: el secreto anterior (rotación) también pasa", async () => {
  const e = await montar("gate-rotacion");
  try {
    const qr = await crear(e);
    const res = await get(qr.id, SECRETO_ANTERIOR);
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), DESTINO);
  } finally {
    await desmontar(e);
  }
});

test("gate: sin NINGÚN secreto configurado falla cerrado — un QR activo da 404 incluso con el header que antes pasaba", async () => {
  const e = await montar("gate-cerrado");
  try {
    const qr = await crear(e);
    const referencia = await esLandingGenerica(await get(randomUUID()));

    env.QR_RESOLVE_PROXY_SECRET = undefined;
    env.QR_RESOLVE_PROXY_SECRET_PREVIOUS = undefined;
    try {
      for (const secreto of [SECRETO, SECRETO_ANTERIOR, null]) {
        const res = await get(qr.id, secreto);
        assert.equal(res.status, 404, String(secreto));
        assert.equal(await res.text(), referencia);
      }
    } finally {
      env.QR_RESOLVE_PROXY_SECRET = SECRETO;
      env.QR_RESOLVE_PROXY_SECRET_PREVIOUS = SECRETO_ANTERIOR;
    }

    // Reconfigurado, vuelve a funcionar sin reiniciar nada: se lee por request.
    assert.equal((await get(qr.id)).status, 302);
  } finally {
    await desmontar(e);
  }
});
