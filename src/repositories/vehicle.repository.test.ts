import assert from "node:assert/strict";
import { test } from "node:test";
import { aCodigoDeEquipamiento } from "./vehicle.repository";

// La búsqueda de texto de search_vehicles (ítem 86) lleva el texto al formato
// de los códigos de equipamiento para buscarlo con `has`. Tiene que dar el
// mismo código que arma la pantalla del vehículo al cargar el chip
// (finalizeEquipmentCode, frontend/src/features/vehicle/equipment.ts), o un
// "techo solar" nunca encontraría TECHO_SOLAR.

test("aCodigoDeEquipamiento: sin acentos, mayúsculas, separadores a _", () => {
  assert.equal(aCodigoDeEquipamiento("techo solar"), "TECHO_SOLAR");
  assert.equal(aCodigoDeEquipamiento("Cámara de retroceso"), "CAMARA_DE_RETROCESO");
  assert.equal(aCodigoDeEquipamiento("  aire-acondicionado  "), "AIRE_ACONDICIONADO");
  assert.equal(aCodigoDeEquipamiento("ABS!"), "ABS");
});

test("aCodigoDeEquipamiento: un texto sin nada rescatable queda vacío", () => {
  assert.equal(aCodigoDeEquipamiento("¿?"), "");
});
