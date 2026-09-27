import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { after, afterEach, before, test } from "node:test";
import { app } from "../app";
import { env } from "../config/env";
import { firmarMetaState, resetClaveDeFirmaMetaParaTests } from "../utils/metaOauthState";
import { urlDeVueltaAlFrontend } from "./metaPageConnection.controller";

// ---------------------------------------------------------------------------
// Ítem 173 de docs/frontend-cambios-pendientes.md — el callback de Meta deja de
// responder text/plain y vuelve a /organization con un 302, salvo que no haya
// un origen utilizable en CORS_ORIGIN. Mismo esquema que
// googleCalendarConnection.controller.test.ts (ítem 75).
//
// Dos niveles, sin base y sin Meta:
//   1. urlDeVueltaAlFrontend, pura: qué URL arma para cada caso.
//   2. El handler montado en la app REAL, por los dos caminos de error que el
//      service resuelve ANTES de tocar la base o hablar con Meta: sin state, y
//      con un state válido pero `error=access_denied`. El camino feliz lo cubre
//      metaPageConnection.controller.integration-test.ts.
// ---------------------------------------------------------------------------

const ORG_ID = "1c7e2d44-5b6a-4f1e-9c3d-2a8b7e6f5d40";

test("urlDeVueltaAlFrontend: éxito → /organization con metaConnected=true", () => {
  assert.equal(
    urlDeVueltaAlFrontend("http://localhost:5173", {}),
    "http://localhost:5173/organization?metaConnected=true",
  );
});

test("urlDeVueltaAlFrontend: error → /organization con el mensaje url-encoded", () => {
  const url = urlDeVueltaAlFrontend("https://crm.example.com", {
    error: "Se canceló la autorización en Facebook. La página quedó sin conectar.",
  });
  assert.ok(url);
  const parsed = new URL(url);
  assert.equal(parsed.origin, "https://crm.example.com");
  assert.equal(parsed.pathname, "/organization");
  assert.equal(
    parsed.searchParams.get("metaError"),
    "Se canceló la autorización en Facebook. La página quedó sin conectar.",
  );
  assert.equal(parsed.searchParams.has("metaConnected"), false);
});

test("urlDeVueltaAlFrontend: el mensaje se recorta — el `error` de Meta sale de la query y puede ser cualquier cosa", () => {
  const url = urlDeVueltaAlFrontend("http://localhost:5173", { error: "x".repeat(5000) });
  assert.ok(url);
  assert.equal(new URL(url).searchParams.get("metaError")?.length, 200);
});

test("urlDeVueltaAlFrontend: con varios orígenes usa el primero, y solo su origin (sin path)", () => {
  assert.equal(
    urlDeVueltaAlFrontend(" https://crm.example.com/algo , http://localhost:5173", {}),
    "https://crm.example.com/organization?metaConnected=true",
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
      urlDeVueltaAlFrontend(corsOrigin, {}),
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
  resetClaveDeFirmaMetaParaTests();
});

after(async () => {
  await cerrar();
});

function callback(query: string) {
  return fetch(`${baseUrl}/api/integrations/meta/callback${query}`, { redirect: "manual" });
}

test("callback sin state, con CORS_ORIGIN: 302 a /organization con metaError", async () => {
  env.CORS_ORIGIN = "http://localhost:5173";

  const res = await callback("");

  assert.equal(res.status, 302);
  const destino = new URL(res.headers.get("location") ?? "");
  assert.equal(destino.origin, "http://localhost:5173");
  assert.equal(destino.pathname, "/organization");
  assert.equal(destino.searchParams.get("metaError"), "Falta el parámetro state");
});

test("callback con state válido y error=access_denied: 302 a /organization con el mensaje de cancelación", async () => {
  env.CORS_ORIGIN = "http://localhost:5173";
  env.SECRET_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  resetClaveDeFirmaMetaParaTests();
  const state = await firmarMetaState({ organizationId: ORG_ID });

  const res = await callback(`?state=${encodeURIComponent(state)}&error=access_denied`);

  assert.equal(res.status, 302);
  const destino = new URL(res.headers.get("location") ?? "");
  assert.equal(destino.pathname, "/organization");
  assert.equal(
    destino.searchParams.get("metaError"),
    "Se canceló la autorización en Facebook. La página quedó sin conectar.",
  );
});

test("callback sin un CORS_ORIGIN utilizable: el text/plain de siempre, con el status del error", async () => {
  env.CORS_ORIGIN = "";

  const res = await callback("");

  assert.equal(res.status, 400);
  assert.match(res.headers.get("content-type") ?? "", /^text\/plain/);
  assert.equal(await res.text(), "No se pudo conectar Facebook.\n\nFalta el parámetro state");
});
