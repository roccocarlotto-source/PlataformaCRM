import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { app } from "./app";
import { env } from "./config/env";

// ---------------------------------------------------------------------------
// docs/frontend-cambios-pendientes.md §16 Parte B — el preflight de CORS
// lleva Access-Control-Max-Age, así el navegador no manda un OPTIONS antes
// de CADA request mutante.
//
// Contra la app REAL de app.ts (mismo patrón que errorHandler.integration-
// test.ts: app.listen(0) + fetch), porque lo que se fija es la configuración
// del middleware tal como está montado, no la del paquete `cors`. Va en la
// suite unitaria y no en la de integración: un preflight lo responde el
// middleware antes de cualquier router, no toca la base ni necesita
// identidad — CORS_ORIGIN es la única variable que hace falta, y la suite
// unitaria ya la tiene (ver ci.yml).
// ---------------------------------------------------------------------------

let baseUrl: string;
let cerrar: () => Promise<void>;

// El primer origen configurado: el test tiene que valer con cualquier valor
// de CORS_ORIGIN (local, CI), no solo con http://localhost:5173.
const origenPermitido = env.CORS_ORIGIN.split(",")[0].trim();

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

after(async () => {
  await cerrar();
});

function preflight(origin: string) {
  return fetch(`${baseUrl}/api/stages/00000000-0000-0000-0000-000000000000`, {
    method: "OPTIONS",
    headers: {
      origin,
      "access-control-request-method": "PATCH",
      "access-control-request-headers": "authorization,content-type",
    },
  });
}

test("§16 B — el preflight de un origen permitido responde con Access-Control-Max-Age: 600 y la política de siempre", async () => {
  const res = await preflight(origenPermitido);

  assert.equal(res.status, 204);
  assert.equal(res.headers.get("access-control-max-age"), "600");

  // La política no cambió: mismo origen reflejado, mismas credenciales, y el
  // método que el editor de etapas usa para mover sigue permitido.
  assert.equal(res.headers.get("access-control-allow-origin"), origenPermitido);
  assert.equal(res.headers.get("access-control-allow-credentials"), "true");
  assert.match(res.headers.get("access-control-allow-methods") ?? "", /PATCH/);
});

test("§16 B — un origen NO permitido sigue sin recibir Access-Control-Allow-Origin (maxAge no abre nada)", async () => {
  const res = await preflight("https://otro-origen.example.invalid");

  assert.equal(res.headers.get("access-control-allow-origin"), null);
  // Sin origen permitido, el navegador descarta el preflight entero: que el
  // max-age viaje o no es irrelevante, pero se deja constancia de que el
  // origen no se refleja.
});
