import assert from "node:assert/strict";
import { test } from "node:test";
import { termino } from "../config/terminos";
import { TERMINO_DEL_CONTACTO } from "./config/rubro";
import {
  PREFIJO_NOTA_CONFIRMADO,
  PREFIJO_TAREA_CANCELO_POR_RECORDATORIO,
} from "./recordatorios/config";
import {
  alContacto,
  elContacto,
  elContactoAlEmpezar,
  nombreOElContacto,
  prefijoNotaConfirmado,
  prefijoTareaCanceloPorRecordatorio,
} from "./textosDelContacto";

const { PACIENTE, CLIENTE } = TERMINO_DEL_CONTACTO;

test("con paciente, los textos de siempre", () => {
  assert.equal(prefijoNotaConfirmado(PACIENTE), PREFIJO_NOTA_CONFIRMADO);
  assert.equal(
    prefijoTareaCanceloPorRecordatorio(PACIENTE),
    PREFIJO_TAREA_CANCELO_POR_RECORDATORIO,
  );
  assert.equal(elContactoAlEmpezar(PACIENTE), "El paciente");
});

test("con cliente, el término de la organización", () => {
  assert.equal(prefijoNotaConfirmado(CLIENTE), "Turno confirmado por el cliente: ");
  assert.equal(prefijoTareaCanceloPorRecordatorio(CLIENTE), "Turno cancelado por el cliente: ");
  assert.equal(elContactoAlEmpezar(CLIENTE), "El cliente");
  assert.equal(alContacto(CLIENTE), "al cliente");
});

test("el nombre, y sin nombre el término; un término femenino lleva su artículo", () => {
  assert.equal(nombreOElContacto({ firstName: "Ana", lastName: "Pérez" }, CLIENTE), "Ana Pérez");
  assert.equal(nombreOElContacto({ firstName: " ", lastName: "" }, CLIENTE), "el cliente");
  assert.equal(nombreOElContacto(null, PACIENTE), "el paciente");
  const clienta = termino("clienta", "clientas", "femenino");
  assert.equal(elContacto(clienta), "la clienta");
  assert.equal(alContacto(clienta), "a la clienta");
});
