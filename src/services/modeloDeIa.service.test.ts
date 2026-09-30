import assert from "node:assert/strict";
import { test } from "node:test";
import { AppError } from "../utils/AppError";
import {
  MENSAJE_MODELO_LO_ELIGE_LA_PLATAFORMA,
  assertModeloSinCambios,
} from "./modeloDeIa.service";

// B-05 (docs-privados/auditoria-2026-09-24-punta-a-punta.md, local): el tenant
// no cambia el modelo. Lo que pasa y lo que no, sin base.

const VIGENTE = { modelProvider: "openrouter", modelName: "a/modelo" };

test("sin modelo en el pedido, o con el mismo, pasa", () => {
  assert.doesNotThrow(() => assertModeloSinCambios(VIGENTE, {}));
  assert.doesNotThrow(() => assertModeloSinCambios(VIGENTE, { ...VIGENTE }));
  assert.doesNotThrow(() => assertModeloSinCambios(VIGENTE, { modelName: "a/modelo" }));
});

test("otro modelo u otro proveedor es 403 con el mensaje de la plataforma", () => {
  for (const pedido of [{ modelName: "b/otro" }, { modelProvider: "otro" }]) {
    assert.throws(
      () => assertModeloSinCambios(VIGENTE, pedido),
      (err: unknown) =>
        err instanceof AppError &&
        err.statusCode === 403 &&
        err.message === MENSAJE_MODELO_LO_ELIGE_LA_PLATAFORMA,
    );
  }
});
