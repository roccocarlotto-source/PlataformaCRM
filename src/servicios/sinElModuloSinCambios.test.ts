import assert from "node:assert/strict";
import { before, test } from "node:test";
import type { Express } from "express";
import { MODULOS, RUTAS_POR_MODULO } from "../config/ediciones";
import { rutasMontadas, type RutaMontada } from "../routes/rutasMontadas.test-helper";

// ---------------------------------------------------------------------------
// Suite "sin el módulo, sin cambios" (docs/servicios.md §13.1), sin base. Cada
// PR del plan que toca el núcleo le suma su caso; su par de integración es
// sinElModuloSinCambios.integration-test.ts. Los casos de S2 (catálogo, gate,
// /me) están en src/clinicas/automotoraSinCambios.test.ts y se quedan ahí.
//
// La regla que sostiene esta suite: para una organización sin el módulo,
// ninguna respuesta, menú ni evento cambia (§0.3).
// ---------------------------------------------------------------------------

let montadas: RutaMontada[];

before(async () => {
  process.env.LOG_LEVEL = "fatal";
  const { app }: { app: Express } = await import("../app.js");
  montadas = rutasMontadas(app);
});

test("S3: todo lo del taller vive bajo /api/servicios y está gateado por el módulo", () => {
  const delTaller = montadas.filter((r) => r.ruta.split(" ")[1].startsWith("/api/servicios"));
  assert.ok(delTaller.length >= 8, "configuración y las siete de vehículos");
  for (const r of delTaller) {
    assert.ok(r.autenticada, `${r.ruta}: con authenticate (y con eso, el gate)`);
    assert.ok(RUTAS_POR_MODULO.servicios.includes(r.ruta), `${r.ruta} en servicios`);
  }
});

test("S3: el módulo no suma rutas fuera de /api/servicios ni clasifica rutas de otros módulos", () => {
  // §1.6: no hay campos de servicios en rutas de otros módulos. La ficha del
  // contacto pide sus vehículos a /api/servicios/vehiculos?contactId=.
  for (const ruta of RUTAS_POR_MODULO.servicios) {
    assert.match(ruta, /^[A-Z]+ \/api\/servicios\//, ruta);
  }
  for (const m of MODULOS.filter((m) => m !== "servicios")) {
    for (const ruta of RUTAS_POR_MODULO[m]) {
      assert.doesNotMatch(ruta, /\/api\/servicios\//, `${ruta} clasificada en ${m}`);
    }
  }
});
