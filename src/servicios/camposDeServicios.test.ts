import assert from "node:assert/strict";
import { test } from "node:test";
import { CAMPOS_DE_SERVICIOS, sinCamposDeServicios } from "./camposDeServicios";

// Sin el módulo, la fila sale con las claves de antes; con el módulo, entera.
const fila = { id: "a1", subject: "Llamar", sourceNoticeId: null, sourceServiceOrderId: null };

test("sin el módulo Servicios, la tarea no lleva las columnas del taller", () => {
  for (const modulos of [undefined, [], ["comun", "agenda"]]) {
    assert.deepEqual(sinCamposDeServicios(fila, modulos, CAMPOS_DE_SERVICIOS.activity), {
      id: "a1",
      subject: "Llamar",
    });
  }
});

test("con el módulo Servicios, la tarea sale entera", () => {
  assert.deepEqual(
    sinCamposDeServicios(fila, ["comun", "servicios"], CAMPOS_DE_SERVICIOS.activity),
    fila,
  );
});
