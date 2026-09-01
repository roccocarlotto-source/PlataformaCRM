import assert from "node:assert/strict";
import { test } from "node:test";
import { traducirConMapeo } from "./promotion.service";

// ---------------------------------------------------------------------------
// B-28 (docs/auditoria-2026-08-29.md): `"constructor" in fila` es true aunque la
// fila no tenga esa columna, porque `in` recorre toda la cadena de prototipos.
// Con un fieldMapping cuya columna origen se llame como algo heredado de
// Object.prototype ("constructor", "toString", "hasOwnProperty"…), el código
// seguía de largo, fila["constructor"] devolvía la función Object heredada,
// comoTextoDeCelda la dejaba pasar (no es null y no es primitivo) y terminaba
// en datos[destino] un valor que no es un dato. Object.hasOwn mira solo las
// propiedades propias. Sin base: traducirConMapeo es pura; se exporta para esto.
// ---------------------------------------------------------------------------

const HEREDADAS = ["constructor", "toString", "hasOwnProperty"];

test("B-28: una columna origen heredada de Object.prototype que la fila NO tiene se trata como ausente, no como dato", () => {
  for (const heredada of HEREDADAS) {
    const resultado = traducirConMapeo(JSON.parse('{"Nombre":"Ana"}'), {
      Nombre: "firstName",
      [heredada]: "lastName",
    });

    assert.equal(resultado.ok, true, `${heredada}: la fila sí tiene Nombre, la traducción procede`);
    assert.deepEqual(
      resultado.ok && resultado.datos,
      { firstName: "Ana" },
      `${heredada}: lastName no puede recibir la función heredada como valor`,
    );
  }
});

test("B-28: si la ÚNICA columna mapeada es heredada y la fila no la tiene, es 'ninguna columna existe', con su nombre en la lista", () => {
  const resultado = traducirConMapeo(JSON.parse('{"Nombre":"Ana"}'), { constructor: "lastName" });

  assert.equal(resultado.ok, false);
  assert.match(!resultado.ok ? resultado.motivo : "", /ninguna columna del fieldMapping existe/);
  assert.match(!resultado.ok ? resultado.motivo : "", /se buscaban: constructor\)/);
});

test("B-28: control — si la fila SÍ trae una columna llamada constructor, su valor real se usa", () => {
  const resultado = traducirConMapeo(JSON.parse('{"Nombre":"Ana","constructor":"Pérez"}'), {
    Nombre: "firstName",
    constructor: "lastName",
  });

  assert.equal(resultado.ok, true);
  assert.deepEqual(resultado.ok && resultado.datos, { firstName: "Ana", lastName: "Pérez" });
});
