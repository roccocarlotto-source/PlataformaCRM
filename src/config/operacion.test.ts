import assert from "node:assert/strict";
import { test } from "node:test";
import { VARIABLES_DE_PRODUCCION, variablesQueFaltan, versionDesplegada } from "./operacion";

test("versionDesplegada: los 7 primeros caracteres del commit, o 'local' sin Render", () => {
  assert.equal(versionDesplegada("f259de6150a1e8c2056662adf0f9d41a9d364194"), "f259de6");
  assert.equal(versionDesplegada(undefined), "local");
  assert.equal(versionDesplegada("  "), "local");
});

test("variablesQueFaltan: nombra cada variable que falta o está vacía, con lo que deja de andar", () => {
  const completo = Object.fromEntries(VARIABLES_DE_PRODUCCION.map(({ nombre }) => [nombre, "x"]));
  assert.deepEqual(variablesQueFaltan(completo), []);

  const faltan = variablesQueFaltan({
    ...completo,
    QR_RESOLVE_PROXY_SECRET: undefined,
    WHATSAPP_ACCESS_TOKEN: " ",
  });
  assert.equal(faltan.length, 2);
  assert.match(faltan.join(" "), /WHATSAPP_ACCESS_TOKEN \(/);
  assert.match(faltan.join(" "), /QR_RESOLVE_PROXY_SECRET \(todos los escaneos de QR dan 404\)/);
});
