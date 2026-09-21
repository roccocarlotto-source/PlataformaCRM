import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { after, afterEach, before, test } from "node:test";
import { app } from "../app";
import { env } from "../config/env";
import { firmarState, resetClaveDeFirmaParaTests } from "../utils/oauthState";
import { urlDeVueltaAlFrontend } from "./googleCalendarConnection.controller";

// ---------------------------------------------------------------------------
// Ítem 75 de docs/frontend-cambios-pendientes.md — el callback de Google deja
// de responder text/plain y vuelve al frontend con un 302, salvo que no haya un
// origen utilizable en CORS_ORIGIN.
//
// Dos niveles, sin base y sin Google:
//   1. urlDeVueltaAlFrontend, pura: qué URL arma para cada caso.
//   2. El handler montado en la app REAL (app.listen(0) + fetch, mismo patrón
//      que app.test.ts), por los dos caminos de error que el service resuelve
//      ANTES de tocar la base o hablar con Google: sin state, y con un state
//      válido pero `error=access_denied` (la persona canceló en Google). El
//      camino feliz necesita Postgres y un cliente de Google doblado; su URL de
//      vuelta la cubre el nivel 1.
// ---------------------------------------------------------------------------

const BRANCH_ID = "9b2f6a53-3f2c-4a3e-8a8e-6d1f5c2b7a10";
const ORG_ID = "1c7e2d44-5b6a-4f1e-9c3d-2a8b7e6f5d40";

test("urlDeVueltaAlFrontend: éxito → formulario de la sucursal con calendarConnected=true", () => {
  assert.equal(
    urlDeVueltaAlFrontend("http://localhost:5173", { branchId: BRANCH_ID }),
    `http://localhost:5173/branches/${BRANCH_ID}/edit?calendarConnected=true`,
  );
});

test("urlDeVueltaAlFrontend: error con sucursal → su formulario con el mensaje url-encoded", () => {
  const url = urlDeVueltaAlFrontend("https://crm.example.com", {
    branchId: BRANCH_ID,
    error: "Se canceló la autorización en Google. La sucursal quedó sin conectar.",
  });
  assert.ok(url);
  const parsed = new URL(url);
  assert.equal(parsed.origin, "https://crm.example.com");
  assert.equal(parsed.pathname, `/branches/${BRANCH_ID}/edit`);
  assert.equal(
    parsed.searchParams.get("calendarError"),
    "Se canceló la autorización en Google. La sucursal quedó sin conectar.",
  );
  assert.equal(parsed.searchParams.has("calendarConnected"), false);
});

test("urlDeVueltaAlFrontend: error sin sucursal verificada → vuelve al listado", () => {
  const url = urlDeVueltaAlFrontend("http://localhost:5173", {
    error: "El parámetro state es inválido",
  });
  assert.ok(url);
  const parsed = new URL(url);
  assert.equal(parsed.pathname, "/branches");
  assert.equal(parsed.searchParams.get("calendarError"), "El parámetro state es inválido");
});

test("urlDeVueltaAlFrontend: el mensaje se recorta — el `error` de Google sale de la query y puede ser cualquier cosa", () => {
  const url = urlDeVueltaAlFrontend("http://localhost:5173", { error: "x".repeat(5000) });
  assert.ok(url);
  assert.equal(new URL(url).searchParams.get("calendarError")?.length, 200);
});

test("urlDeVueltaAlFrontend: con varios orígenes usa el primero, y solo su origin (sin path)", () => {
  assert.equal(
    urlDeVueltaAlFrontend(" https://crm.example.com/algo , http://localhost:5173", {
      branchId: BRANCH_ID,
    }),
    `https://crm.example.com/branches/${BRANCH_ID}/edit?calendarConnected=true`,
  );
});

test("urlDeVueltaAlFrontend: sin un origen utilizable devuelve undefined (el handler cae al text/plain)", () => {
  for (const corsOrigin of [
    undefined,
    "",
    "   ",
    " , http://localhost:5173",
    "no-es-una-url",
    "ftp://x.com",
  ]) {
    assert.equal(
      urlDeVueltaAlFrontend(corsOrigin, { branchId: BRANCH_ID }),
      undefined,
      `CORS_ORIGIN ${JSON.stringify(corsOrigin)}`,
    );
  }
});

// ---------------------------------------------------------------------------
// El handler, por HTTP.
// ---------------------------------------------------------------------------

let baseUrl: string;
let cerrar: () => Promise<void>;
const corsOriginOriginal = env.CORS_ORIGIN;
const claveOriginal = env.SECRET_ENCRYPTION_KEY;

before(async () => {
  await new Promise<void>((resolve) => {
    const server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${port}`;
      cerrar = () => new Promise((r) => server.close(() => r()));
      resolve();
    });
  });
});

afterEach(() => {
  env.CORS_ORIGIN = corsOriginOriginal;
  env.SECRET_ENCRYPTION_KEY = claveOriginal;
  resetClaveDeFirmaParaTests();
});

after(async () => {
  await cerrar();
});

function callback(query: string) {
  return fetch(`${baseUrl}/api/integrations/google-calendar/callback${query}`, {
    redirect: "manual",
  });
}

test("callback sin state, con CORS_ORIGIN: 302 al listado de sucursales con calendarError", async () => {
  env.CORS_ORIGIN = "http://localhost:5173";

  const res = await callback("");

  assert.equal(res.status, 302);
  const destino = new URL(res.headers.get("location") ?? "");
  assert.equal(destino.origin, "http://localhost:5173");
  assert.equal(destino.pathname, "/branches");
  assert.equal(destino.searchParams.get("calendarError"), "Falta el parámetro state");
});

test("callback con state válido y error=access_denied: 302 al formulario de ESA sucursal, que sale del state firmado", async () => {
  env.CORS_ORIGIN = "http://localhost:5173";
  env.SECRET_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  resetClaveDeFirmaParaTests();
  const state = await firmarState({ organizationId: ORG_ID, branchId: BRANCH_ID });

  const res = await callback(`?state=${encodeURIComponent(state)}&error=access_denied`);

  assert.equal(res.status, 302);
  const destino = new URL(res.headers.get("location") ?? "");
  assert.equal(destino.pathname, `/branches/${BRANCH_ID}/edit`);
  assert.equal(
    destino.searchParams.get("calendarError"),
    "Se canceló la autorización en Google. La sucursal quedó sin conectar.",
  );
});

test("callback con un state manipulado: la sucursal NO se toma de ahí — vuelve al listado", async () => {
  env.CORS_ORIGIN = "http://localhost:5173";
  env.SECRET_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  resetClaveDeFirmaParaTests();
  // Firmado con OTRA clave: tiene la forma de un state, pero no salió de acá.
  const ajeno = await firmarState(
    { organizationId: ORG_ID, branchId: BRANCH_ID },
    new Uint8Array(randomBytes(32)),
  );

  const res = await callback(`?state=${encodeURIComponent(ajeno)}&code=abc`);

  assert.equal(res.status, 302);
  const destino = new URL(res.headers.get("location") ?? "");
  assert.equal(destino.pathname, "/branches");
  assert.equal(destino.searchParams.get("calendarError"), "El parámetro state es inválido");
});

test("callback sin un CORS_ORIGIN utilizable: el text/plain de siempre, con el status del error", async () => {
  env.CORS_ORIGIN = "";

  const res = await callback("");

  assert.equal(res.status, 400);
  assert.match(res.headers.get("content-type") ?? "", /^text\/plain/);
  assert.equal(
    await res.text(),
    "No se pudo conectar Google Calendar.\n\nFalta el parámetro state",
  );
});
