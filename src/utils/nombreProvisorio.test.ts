import assert from "node:assert/strict";
import { test } from "node:test";
import {
  esNombreProvisorio,
  FUENTES_CON_NOMBRE_DE_PERFIL,
  tieneNombreCompleto,
  vieneDeUnPerfilDeCanal,
} from "./nombreProvisorio";

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

test("el genérico de Messenger e Instagram y el @usuario de Instagram son provisorios", () => {
  assert.equal(esNombreProvisorio({ firstName: "Messenger", lastName: "…08366039" }), true);
  assert.equal(esNombreProvisorio({ firstName: "Instagram", lastName: "…a1b2c3d4" }), true);
  assert.equal(esNombreProvisorio({ firstName: "@autos.del.sur", lastName: "" }), true);
  assert.equal(esNombreProvisorio({ firstName: "@autos.del.sur", lastName: null }), true);
});

test("'Instagram' o un @ con un apellido de verdad los escribió alguien: no son provisorios", () => {
  assert.equal(esNombreProvisorio({ firstName: "Instagram", lastName: "Gómez" }), false);
  assert.equal(esNombreProvisorio({ firstName: "Messenger", lastName: "" }), false);
  assert.equal(esNombreProvisorio({ firstName: "@ana", lastName: "Pérez" }), false);
});

// ---------------------------------------------------------------------------
// Decisión de Rocco (08/10/2026): nombre completo = nombre y apellido con
// letras. Es lo que hace falta antes de una oportunidad o una reserva.
// ---------------------------------------------------------------------------

test("tieneNombreCompleto: nombre y apellido con letras, venga de donde venga", () => {
  assert.equal(tieneNombreCompleto({ firstName: "Martín", lastName: "Pérez" }), true);
  assert.equal(tieneNombreCompleto({ firstName: "Ana María", lastName: "de los Santos" }), true);
  // "Visitante" con apellido real lo escribió alguien: cuenta.
  assert.equal(tieneNombreCompleto({ firstName: "Visitante", lastName: "Gómez" }), true);
});

test("tieneNombreCompleto: un perfil de una palabra, sin letras o provisorio está incompleto", () => {
  // Perfil de WhatsApp de una sola palabra.
  assert.equal(tieneNombreCompleto({ firstName: "Martín", lastName: "" }), false);
  assert.equal(tieneNombreCompleto({ firstName: "Martín", lastName: null }), false);
  // Apellido sin letras: un emoji, puntos, espacios.
  assert.equal(tieneNombreCompleto({ firstName: "Juancho", lastName: "🚗" }), false);
  assert.equal(tieneNombreCompleto({ firstName: "Juancho", lastName: "..." }), false);
  assert.equal(tieneNombreCompleto({ firstName: "Juancho", lastName: "   " }), false);
  // Nombre sin letras.
  assert.equal(tieneNombreCompleto({ firstName: ".", lastName: "" }), false);
  assert.equal(tieneNombreCompleto({ firstName: "123", lastName: "Pérez" }), false);
  // Los provisorios, aunque tengan letras en las dos partes.
  assert.equal(tieneNombreCompleto({ firstName: "Visitante", lastName: "caa2c873" }), false);
  assert.equal(tieneNombreCompleto({ firstName: "Messenger", lastName: "…08366039" }), false);
  assert.equal(tieneNombreCompleto({ firstName: "WhatsApp", lastName: "+59899123456" }), false);
  assert.equal(tieneNombreCompleto({ firstName: "@autos.del.sur", lastName: "" }), false);
});

test("vieneDeUnPerfilDeCanal: WhatsApp, Messenger e Instagram; el panel y una importación no", () => {
  assert.deepEqual([...FUENTES_CON_NOMBRE_DE_PERFIL], ["WhatsApp", "Instagram", "Messenger"]);
  assert.equal(vieneDeUnPerfilDeCanal("WhatsApp"), true);
  assert.equal(vieneDeUnPerfilDeCanal("Messenger"), true);
  assert.equal(vieneDeUnPerfilDeCanal("Instagram"), true);
  assert.equal(vieneDeUnPerfilDeCanal(null), false);
  assert.equal(vieneDeUnPerfilDeCanal(undefined), false);
  assert.equal(vieneDeUnPerfilDeCanal("Importación Excel"), false);
  assert.equal(
    vieneDeUnPerfilDeCanal("whatsapp"),
    false,
    "la fuente es exacta, como la escribe el canal",
  );
});
