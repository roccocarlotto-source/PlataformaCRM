import assert from "node:assert/strict";
import { test } from "node:test";
import {
  anotarEnvioEnConversacion,
  textoDePlantilla,
  type EnvioDePlantilla,
} from "./automationWhatsappConversation.service";

// F1 de docs-privados/prueba-en-vivo-2026-09-29.md (local, no está en GitHub): el WhatsApp de una automatización
// queda en la conversación. El camino contra la base está en
// qrFollowUpWorker.integration-test.ts y discountVoucherFollowUpWorker
// .integration-test.ts; acá, el texto y la garantía de que anotar no afecta el
// envío.

test("F1: textoDePlantilla reemplaza {nombre} y {link} (guardados como los escribió el negocio) por los parámetros, normalizados como viajaron a Meta", () => {
  assert.equal(
    textoDePlantilla(
      {
        name: "seguimiento_postventa",
        bodyText: "Hola {nombre}, gracias por tu compra. Dejanos tu reseña: {link} ¡Gracias!",
      },
      ["Ana\n", "https://g.page/r/abc/review"],
    ),
    "Hola Ana, gracias por tu compra. Dejanos tu reseña: https://g.page/r/abc/review ¡Gracias!",
  );
});

test("F1: textoDePlantilla también acepta un cuerpo ya en la forma de Meta ({{n}})", () => {
  // Un mismo parámetro dos veces, y uno que no existe queda tal cual.
  assert.equal(
    textoDePlantilla({ name: "x", bodyText: "{{1}} y {{1}}, {{3}}" }, ["Ana", "link"]),
    "Ana y Ana, {{3}}",
  );
});

test("F1: sin el cuerpo de la plantilla, una línea descriptiva con el nombre y los parámetros", () => {
  const esperado = "[Plantilla seguimiento_postventa] Ana · https://g.page/r/abc/review";
  for (const bodyText of [undefined, null, "", "   "]) {
    assert.equal(
      textoDePlantilla({ name: "seguimiento_postventa", bodyText }, [
        "Ana",
        "https://g.page/r/abc/review",
      ]),
      esperado,
    );
  }
  assert.equal(textoDePlantilla({ name: "hello_world" }, []), "[Plantilla hello_world]");
});

const ENVIO: EnvioDePlantilla = {
  organizationId: "org",
  contactId: "contacto",
  phoneNumberId: "1234567890",
  destino: "59899123456",
  plantilla: { name: "seguimiento_postventa" },
  parametros: ["Ana", "https://g.page/r/abc/review"],
  wamid: "wamid.X",
};

test("F1: anotarEnvioEnConversacion nunca lanza — si anotar falla, el envío no se entera", async () => {
  let llamadas = 0;
  await anotarEnvioEnConversacion(ENVIO, () => {
    llamadas++;
    return Promise.reject(new Error("la base se cayó"));
  });
  assert.equal(llamadas, 1, "se intenta una sola vez: no hay reintento de nada");
});

test("F1: anotarEnvioEnConversacion le pasa el envío tal cual al registro", async () => {
  const recibidos: EnvioDePlantilla[] = [];
  await anotarEnvioEnConversacion(ENVIO, (envio) => {
    recibidos.push(envio);
    return Promise.resolve();
  });
  assert.deepEqual(recibidos, [ENVIO]);
});
