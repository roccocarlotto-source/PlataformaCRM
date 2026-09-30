import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, afterEach, before, test } from "node:test";
import { app } from "../app";
import { env } from "../config/env";
import { resetClaveDeFirmaMetaParaTests } from "../utils/metaOauthState";
import { urlDeVueltaAlFrontend, vueltaDelCallback } from "./metaPageConnection.controller";

// ---------------------------------------------------------------------------
// Ítem 173 de docs/frontend-cambios-pendientes.md — el callback de Meta deja de
// responder text/plain y vuelve a /organization con un 302, salvo que no haya
// un origen utilizable en CORS_ORIGIN. Mismo esquema que
// googleCalendarConnection.controller.test.ts (ítem 75).
//
// Dos niveles, sin base y sin Meta:
//   1. urlDeVueltaAlFrontend, pura: qué URL arma para cada caso.
//   2. El handler montado en la app REAL. Desde A-07 el callback no toca la
//      base ni habla con Meta: rebota al CRM con el code y el state en el
//      fragmento, o con ?metaError=. El canje (POST /complete) lo cubre
//      metaPageConnection.controller.integration-test.ts.
// ---------------------------------------------------------------------------

const PENDIENTE = { code: "el-code", state: "el.state.firmado" };

test("urlDeVueltaAlFrontend: code y state → /organization con los dos en el FRAGMENTO, nada en la query (A-07)", () => {
  const url = urlDeVueltaAlFrontend("http://localhost:5173", PENDIENTE);
  assert.ok(url);
  const parsed = new URL(url);
  assert.equal(parsed.origin, "http://localhost:5173");
  assert.equal(parsed.pathname, "/organization");
  assert.equal(parsed.search, "");
  const fragmento = new URLSearchParams(parsed.hash.slice(1));
  assert.equal(fragmento.get("metaCode"), "el-code");
  assert.equal(fragmento.get("metaState"), "el.state.firmado");
});

test("vueltaDelCallback: cancelar, Meta rechaza, falta state o code → error; si no, code y state", () => {
  assert.deepEqual(vueltaDelCallback({ state: "s", error: "access_denied" }), {
    error: "Se canceló la autorización en Facebook. La página quedó sin conectar.",
  });
  assert.deepEqual(vueltaDelCallback({ error: "server_error" }), {
    error: "Facebook rechazó la autorización (server_error)",
  });
  assert.deepEqual(vueltaDelCallback({ code: "c" }), { error: "Falta el parámetro state" });
  assert.deepEqual(vueltaDelCallback({ state: "s" }), { error: "Falta el parámetro code" });
  assert.deepEqual(vueltaDelCallback({ state: "s", code: "c" }), { state: "s", code: "c" });
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
    urlDeVueltaAlFrontend(" https://crm.example.com/algo , http://localhost:5173", { error: "x" }),
    "https://crm.example.com/organization?metaError=x",
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
      urlDeVueltaAlFrontend(corsOrigin, PENDIENTE),
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

test("callback con error=access_denied: 302 a /organization con el mensaje de cancelación", async () => {
  env.CORS_ORIGIN = "http://localhost:5173";

  const res = await callback("?state=cualquiera&error=access_denied");

  assert.equal(res.status, 302);
  const destino = new URL(res.headers.get("location") ?? "");
  assert.equal(destino.pathname, "/organization");
  assert.equal(
    destino.searchParams.get("metaError"),
    "Se canceló la autorización en Facebook. La página quedó sin conectar.",
  );
});

test("A-07: callback con code y state: 302 a /organization con los dos en el fragmento, sin canjear nada", async () => {
  env.CORS_ORIGIN = "http://localhost:5173";
  // Sin SECRET_ENCRYPTION_KEY: si el callback intentara verificar el state o
  // canjear, fallaría. Solo rebota.
  env.SECRET_ENCRYPTION_KEY = undefined;
  resetClaveDeFirmaMetaParaTests();

  const res = await callback("?state=el.state&code=el-code");

  assert.equal(res.status, 302);
  const destino = new URL(res.headers.get("location") ?? "");
  assert.equal(destino.pathname, "/organization");
  assert.equal(destino.search, "");
  const fragmento = new URLSearchParams(destino.hash.slice(1));
  assert.equal(fragmento.get("metaCode"), "el-code");
  assert.equal(fragmento.get("metaState"), "el.state");
});

test("callback sin un CORS_ORIGIN utilizable: el text/plain de siempre, con el status del error", async () => {
  env.CORS_ORIGIN = "";

  const res = await callback("");

  assert.equal(res.status, 400);
  assert.match(res.headers.get("content-type") ?? "", /^text\/plain/);
  assert.equal(await res.text(), "No se pudo conectar Facebook.\n\nFalta el parámetro state");
});
