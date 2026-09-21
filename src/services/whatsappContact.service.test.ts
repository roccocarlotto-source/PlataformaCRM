import assert from "node:assert/strict";
import { test } from "node:test";
import {
  WHATSAPP_CONTACT_FALLBACK_FIRST_NAME,
  nombreDelPerfil,
  soloDigitos,
} from "./whatsappContact.service";

test("soloDigitos saca el + y cualquier separador", () => {
  assert.equal(soloDigitos("+598 99-123.456"), "59899123456");
  assert.equal(soloDigitos("59899123456"), "59899123456");
});

test("nombreDelPerfil: primera palabra nombre, el resto apellido", () => {
  assert.deepEqual(nombreDelPerfil("  Ana   María Pérez ", "598"), {
    firstName: "Ana",
    lastName: "María Pérez",
  });
});

test("nombreDelPerfil: una sola palabra deja el apellido vacío, no inventa uno", () => {
  assert.deepEqual(nombreDelPerfil("Ana", "598"), { firstName: "Ana", lastName: "" });
});

test("nombreDelPerfil: sin nombre de perfil, WhatsApp +<número>", () => {
  for (const vacio of [undefined, "", "   "]) {
    assert.deepEqual(nombreDelPerfil(vacio, "59899123456"), {
      firstName: WHATSAPP_CONTACT_FALLBACK_FIRST_NAME,
      lastName: "+59899123456",
    });
  }
});

test("nombreDelPerfil: recorta a los 100 caracteres de las columnas", () => {
  const largo = "x".repeat(150);
  const r = nombreDelPerfil(`${largo} ${largo}`, "1");
  assert.equal(r.firstName.length, 100);
  assert.equal(r.lastName.length, 100);
});
