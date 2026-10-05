import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buscarPorMarcaYModelo,
  idsDelMismoModelo,
  palabrasDeBusqueda,
  type VehiculoBuscable,
} from "./busquedaDeVehiculo";

// ---------------------------------------------------------------------------
// FABLE-B-09 (docs-privados/auditoria-2026-10-05-FABLE.md, local): la búsqueda
// por marca y modelo que hace el agente, sin base. El recorrido real contra
// Postgres está en agentReadTools.integration-test.ts.
// ---------------------------------------------------------------------------

const STOCK: VehiculoBuscable[] = [
  {
    id: "tcross-comfortline",
    make: "Volkswagen",
    model: "T-Cross",
    trim: "Comfortline",
    year: 2023,
  },
  { id: "tcross-highline", make: "Volkswagen", model: "T-Cross", trim: "Highline", year: 2022 },
  { id: "hilux-srv", make: "Toyota", model: "Hilux", trim: "SRV", year: 2020 },
  { id: "hilux-dx", make: "Toyota", model: "Hilux", trim: "DX", year: 2021 },
  { id: "c3", make: "Citroën", model: "C3", trim: null, year: 2019 },
  { id: "up", make: "Volkswagen", model: "Up", trim: "Move", year: 2018 },
];

const buscar = (pedido: { make?: string; model?: string }) => buscarPorMarcaYModelo(STOCK, pedido);

test("palabrasDeBusqueda: sin acentos, sin mayúsculas, y el guion separa", () => {
  assert.deepEqual(palabrasDeBusqueda("T-Cross Comfortline 2023"), [
    "t",
    "cross",
    "comfortline",
    "2023",
  ]);
  assert.deepEqual(palabrasDeBusqueda("  CITROËN  c3 "), ["citroen", "c3"]);
  assert.deepEqual(palabrasDeBusqueda(" - "), []);
});

test("el caso del informe: el modelo con versión y año encuentra la unidad", () => {
  assert.deepEqual(buscar({ model: "T-Cross Comfortline 2023" }), {
    nivel: "exacta",
    ids: ["tcross-comfortline"],
  });
  // Lo mismo con la marca adentro del modelo, o repartida en los dos campos.
  assert.deepEqual(buscar({ model: "Volkswagen T-Cross Comfortline 2023" })?.ids, [
    "tcross-comfortline",
  ]);
  assert.deepEqual(buscar({ make: "volkswagen", model: "t-cross comfortline" })?.ids, [
    "tcross-comfortline",
  ]);
});

test("solo el modelo, escrito de cualquier forma, encuentra todas sus unidades", () => {
  for (const model of ["T-Cross", "t-cross", "T CROSS", "tcross", "TCross"]) {
    assert.deepEqual(buscar({ model }), {
      nivel: "exacta",
      ids: ["tcross-comfortline", "tcross-highline"],
    });
  }
});

test("la versión o el año afinan: Hilux SRV es una, Hilux son las dos", () => {
  assert.deepEqual(buscar({ model: "Hilux SRV" })?.ids, ["hilux-srv"]);
  assert.deepEqual(buscar({ model: "hilux 2021" })?.ids, ["hilux-dx"]);
  assert.deepEqual(buscar({ make: "TOYOTA", model: "hilux" })?.ids, ["hilux-srv", "hilux-dx"]);
});

test("la marca sola, con o sin acento, encuentra todo lo de esa marca", () => {
  assert.deepEqual(buscar({ make: "citroen" })?.ids, ["c3"]);
  assert.deepEqual(buscar({ make: "Citroën" })?.ids, ["c3"]);
  assert.deepEqual(buscar({ make: "volkswagen" })?.ids, [
    "tcross-comfortline",
    "tcross-highline",
    "up",
  ]);
});

test("una versión o un año que no hay en stock no niega el modelo: devuelve las del mismo modelo", () => {
  assert.deepEqual(buscar({ model: "T-Cross Highline 2024" }), {
    nivel: "mismo-modelo",
    ids: ["tcross-comfortline", "tcross-highline"],
  });
  assert.deepEqual(buscar({ make: "Toyota", model: "Hilux SRX 4x4" }), {
    nivel: "mismo-modelo",
    ids: ["hilux-srv", "hilux-dx"],
  });
});

test("lo que de verdad no hay sigue sin aparecer", () => {
  assert.deepEqual(buscar({ make: "Ford" }), { nivel: "ninguna", ids: [] });
  assert.deepEqual(buscar({ make: "Ford", model: "Ranger XLT 2022" }), {
    nivel: "ninguna",
    ids: [],
  });
});

test("mismo modelo exige el modelo como palabra entera: un Up no aparece por un coupé", () => {
  assert.deepEqual(buscar({ model: "Peugeot 208 coupe" }), { nivel: "ninguna", ids: [] });
  assert.deepEqual(idsDelMismoModelo(STOCK, { model: "supra" }), []);
  assert.deepEqual(idsDelMismoModelo(STOCK, { model: "Up 2030" }), ["up"]);
});

test("sin marca ni modelo, o con texto sin palabras, no hay nada que filtrar", () => {
  assert.equal(buscar({}), null);
  assert.equal(buscar({ make: " ", model: "--" }), null);
});
