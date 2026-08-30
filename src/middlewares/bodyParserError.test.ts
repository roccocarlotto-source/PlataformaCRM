import assert from "node:assert/strict";
import { test } from "node:test";
import { clasificarErrorDeBodyParser } from "./bodyParserError";

// M-11 (a) de docs/auditoria-2026-08-29.md — la clasificación compartida entre
// el parser de la ingesta y los globales. Sin mensaje ni status: eso lo decide
// cada call site.

test("entity.too.large se clasifica como demasiado_grande", () => {
  assert.equal(clasificarErrorDeBodyParser({ type: "entity.too.large" }), "demasiado_grande");
});

test("entity.parse.failed se clasifica como cuerpo_invalido", () => {
  assert.equal(clasificarErrorDeBodyParser({ type: "entity.parse.failed" }), "cuerpo_invalido");
});

test("charset.unsupported y encoding.unsupported se clasifican como codificacion_no_soportada", () => {
  assert.equal(
    clasificarErrorDeBodyParser({ type: "charset.unsupported" }),
    "codificacion_no_soportada",
  );
  assert.equal(
    clasificarErrorDeBodyParser({ type: "encoding.unsupported" }),
    "codificacion_no_soportada",
  );
});

// Un type desconocido NO se clasifica: inventarle un 4xx a un error que no
// entendemos sería decirle al cliente que la culpa es suya sin saberlo.
test("un type desconocido, un error sin type, null y undefined devuelven undefined", () => {
  assert.equal(clasificarErrorDeBodyParser({ type: "request.aborted" }), undefined);
  assert.equal(clasificarErrorDeBodyParser({ type: "stream.encoding.set" }), undefined);
  assert.equal(clasificarErrorDeBodyParser(new Error("sin type")), undefined);
  assert.equal(clasificarErrorDeBodyParser(null), undefined);
  assert.equal(clasificarErrorDeBodyParser(undefined), undefined);
});
