import assert from "node:assert/strict";
import { test } from "node:test";
import { esNombreProvisorio } from "./nombreProvisorio";

// ---------------------------------------------------------------------------
// OPUS-B-03 / FABLE-B-10 (docs-privados, local): qué cuenta como nombre
// provisorio (el que pone el canal) y qué como un nombre de verdad.
// ---------------------------------------------------------------------------

test("el visitante del widget, el de WhatsApp sin perfil y el vacío son provisorios", () => {
  assert.equal(esNombreProvisorio({ firstName: "Visitante", lastName: "caa2c873" }), true);
  assert.equal(esNombreProvisorio({ firstName: "WhatsApp", lastName: "+59899123456" }), true);
  assert.equal(esNombreProvisorio({ firstName: "", lastName: null }), true);
  assert.equal(esNombreProvisorio({ firstName: "   ", lastName: "Pérez" }), true);
});

test("un nombre que cargó una persona no es provisorio, aunque se parezca", () => {
  assert.equal(esNombreProvisorio({ firstName: "Ana", lastName: "Pérez" }), false);
  assert.equal(esNombreProvisorio({ firstName: ".", lastName: "" }), false);
  // "Visitante" con un apellido de verdad: alguien lo escribió así a mano.
  assert.equal(esNombreProvisorio({ firstName: "Visitante", lastName: "Gómez" }), false);
  assert.equal(esNombreProvisorio({ firstName: "Visitante", lastName: null }), false);
  // El sufijo del widget son exactamente 8 caracteres en hexadecimal.
  assert.equal(esNombreProvisorio({ firstName: "Visitante", lastName: "caa2c87" }), false);
  assert.equal(esNombreProvisorio({ firstName: "Visitante", lastName: "CAA2C873" }), false);
});
