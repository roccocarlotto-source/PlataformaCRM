import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { AppError } from "./AppError";
import {
  MAX_PAYLOAD_DEPTH,
  canonicalStringify,
  deriveExternalId,
} from "./externalId";

// El contrato de deriveExternalId es exactamente uno: DOS PAYLOADS CON EL MISMO
// CONTENIDO DAN EL MISMO externalId, Y DOS CON CONTENIDO DISTINTO NO. Todo lo
// que sigue son formas de que ese contrato se rompa.
//
// Los casos se escriben sobre lo que produce JSON.parse, que es lo único que
// esta función llega a ver en producción (express.json corre antes).

test("el orden de las claves no cambia el externalId — es el caso que motiva la canonicalización", () => {
  const original = JSON.parse('{"email":"a@b.com","nombre":"Ana","tel":null}');
  const reintento = JSON.parse('{"tel":null,"nombre":"Ana","email":"a@b.com"}');

  assert.equal(deriveExternalId(original), deriveExternalId(reintento));
});

test("el espaciado del JSON original no cambia el externalId", () => {
  const compacto = JSON.parse('{"a":1,"b":[2,3]}');
  const formateado = JSON.parse('{\n  "a": 1,\n  "b": [ 2, 3 ]\n}');

  assert.equal(deriveExternalId(compacto), deriveExternalId(formateado));
});

test("el orden de las claves ANIDADAS tampoco cambia el externalId", () => {
  const uno = JSON.parse('{"lead":{"email":"a@b.com","utm":{"src":"x","med":"y"}}}');
  const otro = JSON.parse('{"lead":{"utm":{"med":"y","src":"x"},"email":"a@b.com"}}');

  assert.equal(deriveExternalId(uno), deriveExternalId(otro));
});

// El complemento del test anterior, y hace falta: una función que devolviera
// siempre la misma constante pasaría todos los de arriba.
test("un contenido distinto da un externalId distinto (control negativo)", () => {
  const base = { email: "a@b.com", nombre: "Ana" };

  assert.notEqual(deriveExternalId(base), deriveExternalId({ ...base, nombre: "Ana " }));
  assert.notEqual(deriveExternalId(base), deriveExternalId({ ...base, extra: null }));
  assert.notEqual(deriveExternalId(base), deriveExternalId({ email: "a@b.com" }));
});

// En un array el orden ES contenido, no presentación: [1,2] y [2,1] son dos
// listas distintas. Si canonicalize los ordenara "para normalizar", dos eventos
// realmente distintos colapsarían en uno y se perdería el segundo sin rastro.
test("el orden de un array SÍ cambia el externalId — un array no es un objeto", () => {
  assert.notEqual(
    deriveExternalId({ tags: ["a", "b"] }),
    deriveExternalId({ tags: ["b", "a"] }),
  );
});

test("canonicalStringify ordena claves y respeta arrays", () => {
  assert.equal(
    canonicalStringify({ b: 1, a: { d: 4, c: [3, 1, 2] } }),
    '{"a":{"c":[3,1,2],"d":4},"b":1}',
  );
});

test("el externalId es un SHA-256 hex y entra en el VarChar(255) de la columna", () => {
  const id = deriveExternalId({ a: 1 });

  assert.equal(id.length, 64);
  assert.match(id, /^[0-9a-f]{64}$/);
  assert.equal(
    id,
    createHash("sha256").update('{"a":1}', "utf8").digest("hex"),
    "el hash es sobre el JSON canónico, no sobre otra representación",
  );
});

// Defensa contra el desborde de pila, no una regla de negocio: canonicalize es
// recursiva y un payload permitido por el límite de body puede tener decenas de
// miles de niveles. Un AppError(400) es un rechazo; un stack overflow es el
// proceso caído.
test("un anidamiento excesivo da 400, no un desborde de pila", () => {
  let profundo: unknown = "fondo";
  for (let i = 0; i <= MAX_PAYLOAD_DEPTH + 5; i++) {
    profundo = [profundo];
  }

  assert.throws(
    () => deriveExternalId({ payload: profundo }),
    (err: unknown) => err instanceof AppError && err.statusCode === 400,
  );
});

test("el anidamiento justo en el límite se acepta (control del borde)", () => {
  let dentro: unknown = "fondo";
  // -1 porque el objeto que envuelve ya cuenta como un nivel.
  for (let i = 0; i < MAX_PAYLOAD_DEPTH - 1; i++) {
    dentro = [dentro];
  }

  assert.doesNotThrow(() => deriveExternalId({ payload: dentro }));
});
