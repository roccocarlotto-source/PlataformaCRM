import assert from "node:assert/strict";
import { test } from "node:test";
import { VARIABLES_DE_PRODUCCION, variablesQueFaltan, versionDesplegada } from "./operacion";

test("versionDesplegada: los 7 primeros caracteres del commit, o 'local' sin ninguno", () => {
  const commit = "f259de6150a1e8c2056662adf0f9d41a9d364194";
  assert.equal(versionDesplegada({ RENDER_GIT_COMMIT: commit }), "f259de6");
  assert.equal(versionDesplegada({}), "local");
  assert.equal(versionDesplegada({ RENDER_GIT_COMMIT: "  ", GIT_COMMIT: " " }), "local");
});

test("versionDesplegada: fuera de Render usa GIT_COMMIT (la imagen Docker); Render gana si están las dos", () => {
  assert.equal(versionDesplegada({ GIT_COMMIT: "a1b2c3d4e5f6" }), "a1b2c3d");
  assert.equal(
    versionDesplegada({ RENDER_GIT_COMMIT: " ", GIT_COMMIT: "a1b2c3d4e5f6" }),
    "a1b2c3d",
  );
  assert.equal(
    versionDesplegada({ RENDER_GIT_COMMIT: "f259de6150a1", GIT_COMMIT: "a1b2c3d4e5f6" }),
    "f259de6",
  );
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
