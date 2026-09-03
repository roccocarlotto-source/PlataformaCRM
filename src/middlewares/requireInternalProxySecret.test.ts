import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, afterEach, before, test } from "node:test";
import express from "express";
import { env } from "../config/env";
import { buildLandingHtml } from "../utils/qrLanding";
import { errorHandler } from "./errorHandler";
import { notFound } from "./notFound";
import {
  INTERNAL_PROXY_SECRET_HEADER,
  hasValidInternalProxySecret,
  requireInternalProxySecret,
  secretsMatch,
} from "./requireInternalProxySecret";

// ---------------------------------------------------------------------------
// Gate de secreto compartido de /qr/resolve/:qrId (docs/qr-integration.md,
// Fase 4, punto 5 de "Backend"). Unitario, sin base: la función pura primero,
// y después el middleware montado en un express mínimo delante de un handler
// centinela que responde 200 "ok" — así "pasó" y "no pasó" son
// inconfundibles, y lo que se afirma de la respuesta de falla es su forma
// exacta (status, content-type y cuerpo byte a byte), no solo que no pasó.
//
// El cuerpo de referencia es buildLandingHtml() sin argumentos: es lo que el
// controller manda para un QR inexistente (sendQrNotFoundLanding). Que el
// middleware use LA MISMA función y no una copia lo afirma el integration test
// de qrPublic.controller comparando contra un 404 real del controller.
// ---------------------------------------------------------------------------

const SECRET = "secreto-actual-de-prueba";
const PREVIOUS = "secreto-anterior-de-prueba";

// -- Función pura -----------------------------------------------------------

test("secretsMatch: igual -> true; distinto (aunque comparta prefijo o largo) -> false; nunca tira por largos distintos", () => {
  assert.equal(secretsMatch("abc", "abc"), true);
  assert.equal(secretsMatch("abc", "abd"), false);
  assert.equal(secretsMatch("abc", "abcd"), false);
  assert.equal(secretsMatch("", "abc"), false);
  assert.equal(secretsMatch("", ""), true);
});

test("hasValidInternalProxySecret: sin ningún secreto configurado, NADA satisface — ni siquiera un header no vacío", () => {
  assert.equal(hasValidInternalProxySecret(SECRET, undefined, undefined), false);
  assert.equal(hasValidInternalProxySecret(SECRET, null, null), false);
  assert.equal(hasValidInternalProxySecret(SECRET, "", ""), false);
});

test("hasValidInternalProxySecret: header ausente o vacío -> false aunque haya secreto configurado", () => {
  assert.equal(hasValidInternalProxySecret(undefined, SECRET, PREVIOUS), false);
  assert.equal(hasValidInternalProxySecret(null, SECRET, PREVIOUS), false);
  assert.equal(hasValidInternalProxySecret("", SECRET, PREVIOUS), false);
});

test("hasValidInternalProxySecret: acepta el actual o el anterior (rotación), rechaza cualquier otro valor", () => {
  assert.equal(hasValidInternalProxySecret(SECRET, SECRET, undefined), true);
  assert.equal(hasValidInternalProxySecret(SECRET, SECRET, PREVIOUS), true);
  assert.equal(hasValidInternalProxySecret(PREVIOUS, SECRET, PREVIOUS), true);
  // Solo el anterior configurado (rotación a medio camino del otro lado).
  assert.equal(hasValidInternalProxySecret(PREVIOUS, undefined, PREVIOUS), true);
  assert.equal(hasValidInternalProxySecret("otro-valor", SECRET, PREVIOUS), false);
  assert.equal(hasValidInternalProxySecret(`${SECRET} `, SECRET, PREVIOUS), false);
  assert.equal(hasValidInternalProxySecret(SECRET.toUpperCase(), SECRET, PREVIOUS), false);
});

// -- Middleware por HTTP real -----------------------------------------------

let baseUrl: string;
let cerrar: () => Promise<void>;

const originalSecret = env.QR_RESOLVE_PROXY_SECRET;
const originalPrevious = env.QR_RESOLVE_PROXY_SECRET_PREVIOUS;

before(async () => {
  const app = express();
  app.get("/gated/:qrId", requireInternalProxySecret, (_req, res) => {
    res.status(200).type("text").send("ok");
  });
  app.post("/gated/:qrId", requireInternalProxySecret, (_req, res) => {
    res.status(200).type("text").send("ok");
  });
  app.use(notFound);
  app.use(errorHandler);

  await new Promise<void>((resolve) => {
    const server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${port}`;
      cerrar = () => new Promise((r) => server.close(() => r()));
      resolve();
    });
  });
});

after(async () => {
  if (cerrar) await cerrar();
});

afterEach(() => {
  env.QR_RESOLVE_PROXY_SECRET = originalSecret;
  env.QR_RESOLVE_PROXY_SECRET_PREVIOUS = originalPrevious;
});

function configurar(current: string | undefined, previous: string | undefined) {
  env.QR_RESOLVE_PROXY_SECRET = current;
  env.QR_RESOLVE_PROXY_SECRET_PREVIOUS = previous;
}

function pedir(method: "GET" | "POST", header?: string) {
  return fetch(`${baseUrl}/gated/cualquier-id`, {
    method,
    headers: header === undefined ? {} : { [INTERNAL_PROXY_SECRET_HEADER]: header },
  });
}

// La forma EXACTA de la respuesta de falla: 404, HTML, y el cuerpo es
// buildLandingHtml() sin link de claim — lo mismo que un QR inexistente.
async function esElNotFoundDelController(res: Response) {
  assert.equal(res.status, 404);
  assert.ok(res.headers.get("content-type")?.startsWith("text/html"));
  const html = await res.text();
  assert.equal(html, buildLandingHtml());
  assert.equal(html.includes("¿Sos el dueño"), false);
}

test("sin secreto configurado: 404 landing para todo el mundo, incluso con un header no vacío (falla cerrado)", async () => {
  configurar(undefined, undefined);
  for (const method of ["GET", "POST"] as const) {
    await esElNotFoundDelController(await pedir(method));
    await esElNotFoundDelController(await pedir(method, SECRET));
    await esElNotFoundDelController(await pedir(method, "lo-que-sea"));
  }
});

test("con secreto configurado: header ausente, vacío o incorrecto -> el mismo 404 landing, nunca 401/403", async () => {
  configurar(SECRET, PREVIOUS);
  for (const method of ["GET", "POST"] as const) {
    await esElNotFoundDelController(await pedir(method));
    await esElNotFoundDelController(await pedir(method, ""));
    await esElNotFoundDelController(await pedir(method, "otro-valor"));
    await esElNotFoundDelController(await pedir(method, `${SECRET}x`));
  }
});

test("con secreto configurado: el actual pasa, el anterior también (rotación), en GET y en POST", async () => {
  configurar(SECRET, PREVIOUS);
  for (const method of ["GET", "POST"] as const) {
    for (const valor of [SECRET, PREVIOUS]) {
      const res = await pedir(method, valor);
      assert.equal(res.status, 200, `${method} con ${valor}`);
      assert.equal(await res.text(), "ok");
    }
  }
});

test("solo el anterior configurado (rotación a medio camino): el anterior pasa, el que ya no está configurado no", async () => {
  configurar(undefined, PREVIOUS);
  assert.equal((await pedir("GET", PREVIOUS)).status, 200);
  await esElNotFoundDelController(await pedir("GET", SECRET));
});

test("el nombre del header es case-insensitive (Express lo normaliza)", async () => {
  configurar(SECRET, undefined);
  const res = await fetch(`${baseUrl}/gated/cualquier-id`, {
    headers: { "X-Internal-Proxy-Secret": SECRET },
  });
  assert.equal(res.status, 200);
});
