import assert from "node:assert/strict";
import { test } from "node:test";
import { opportunityRouter } from "./opportunity.routes";

// ---------------------------------------------------------------------------
// §30 — GET /opportunities/dashboard-summary tiene que estar declarada ANTES
// que GET /opportunities/:id: Express recorre las capas en orden de
// declaración y, al revés, "dashboard-summary" matchearía el :id y el handler
// de detalle respondería 400 por uuid inválido. Sin base ni HTTP: se lee la
// pila de capas del router real, que es exactamente lo que Express recorre.
// ---------------------------------------------------------------------------

interface Capa {
  route?: { path: string; methods: Record<string, boolean> };
}

function rutasGet(): string[] {
  const stack = (opportunityRouter as unknown as { stack: Capa[] }).stack;
  return stack.filter((capa) => capa.route?.methods.get).map((capa) => capa.route?.path ?? "");
}

test("GET /opportunities/dashboard-summary está montada y va antes que GET /opportunities/:id", () => {
  const rutas = rutasGet();
  const resumen = rutas.indexOf("/opportunities/dashboard-summary");
  const detalle = rutas.indexOf("/opportunities/:id");
  assert.notEqual(resumen, -1, "la ruta del resumen no está montada");
  assert.notEqual(detalle, -1, "la ruta de detalle no está montada");
  assert.ok(resumen < detalle, `el resumen (${resumen}) tiene que ir antes que :id (${detalle})`);
});
