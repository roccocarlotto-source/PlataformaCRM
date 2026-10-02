import assert from "node:assert/strict";
import { test } from "node:test";
import { mensajeDeLaRegla } from "./mensajeDeWhatsapp";
import { configDeCuponSchema } from "./sendDiscountVoucherFollowup";
import { configDeSeguimientoQrSchema } from "./sendQrFollowup";

// ---------------------------------------------------------------------------
// Formato y texto del WhatsApp dentro del actionConfig de las dos reglas que
// mandan uno. Sin base ni red.
// ---------------------------------------------------------------------------

const QR = { qrCodeId: "5b0f7a4e-2c1d-4f3a-9e8b-1a2b3c4d5e6f", delayMinutes: 1440 };
const CUPON = {
  label: "15% en el taller",
  delayMinutes: 1440,
  expiresInDays: 30,
  branchId: "5b0f7a4e-2c1d-4f3a-9e8b-1a2b3c4d5e6f",
};
const CON_LINK = "Hola {nombre}, gracias. Tu opinión: {link} ¡Gracias!";
const SIN_LINK = "Hola {nombre}, te dejamos el QR. ¡Gracias!";

test("una regla vieja, sin formato ni texto, sigue siendo válida (y es solo link)", () => {
  assert.deepEqual(configDeSeguimientoQrSchema.parse(QR), QR);
  assert.deepEqual(configDeCuponSchema.parse(CUPON), CUPON);
  assert.deepEqual(mensajeDeLaRegla(QR), { formato: "LINK", texto: null });
});

test("formato y texto se guardan (sin que zod los descarte) y se leen de vuelta", () => {
  const config = configDeSeguimientoQrSchema.parse({
    ...QR,
    whatsappFormat: "LINK_AND_IMAGE",
    messageText: `  ${CON_LINK} `,
  });
  assert.equal(config.whatsappFormat, "LINK_AND_IMAGE");
  assert.equal(config.messageText, CON_LINK);
  assert.deepEqual(mensajeDeLaRegla(config), { formato: "LINK_AND_IMAGE", texto: CON_LINK });
});

test("el texto tiene que servir para el formato: solo imagen sin {link}, los otros con", () => {
  assert.ok(
    configDeCuponSchema.safeParse({ ...CUPON, whatsappFormat: "IMAGE", messageText: SIN_LINK })
      .success,
  );
  const conLinkEnImagen = configDeCuponSchema.safeParse({
    ...CUPON,
    whatsappFormat: "IMAGE",
    messageText: CON_LINK,
  });
  assert.equal(conLinkEnImagen.success, false);
  assert.match(conLinkEnImagen.error?.issues[0].message ?? "", /sacá \{link\}/);

  const sinLinkEnLink = configDeSeguimientoQrSchema.safeParse({ ...QR, messageText: SIN_LINK });
  assert.equal(sinLinkEnLink.success, false);
  assert.match(sinLinkEnLink.error?.issues[0].message ?? "", /\{link\}/);
});

test("un formato que no existe es un 400 del schema", () => {
  const r = configDeSeguimientoQrSchema.safeParse({ ...QR, whatsappFormat: "VIDEO" });
  assert.equal(r.success, false);
  assert.match(
    r.error?.issues[0].message ?? "",
    /whatsappFormat debe ser LINK, IMAGE, LINK_AND_IMAGE/,
  );
});

test("mensajeDeLaRegla tolera un Json raro: formato desconocido es LINK, texto vacío es null", () => {
  assert.deepEqual(mensajeDeLaRegla({ whatsappFormat: "X", messageText: "  " }), {
    formato: "LINK",
    texto: null,
  });
  assert.deepEqual(mensajeDeLaRegla(null), { formato: "LINK", texto: null });
});
