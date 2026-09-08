import assert from "node:assert/strict";
import { test } from "node:test";
import { detectImageType, isVehiclePhotoMimeType } from "./vehiclePhoto";

// Firmas reales: lo que un cliente declare en Content-Type no cuenta, cuentan
// los bytes. Fase 2b del módulo de stock de vehículos.

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);

test("detectImageType: JPEG por FF D8 FF, PNG por su firma de ocho bytes", () => {
  assert.deepEqual(detectImageType(JPEG), { mimeType: "image/jpeg", extension: "jpg" });
  assert.deepEqual(detectImageType(PNG), { mimeType: "image/png", extension: "png" });
});

test("detectImageType: cualquier otra cosa es undefined — PDF, GIF, WebP, texto, vacío, o una firma cortada", () => {
  assert.equal(detectImageType(Buffer.from("%PDF-1.4")), undefined);
  assert.equal(detectImageType(Buffer.from("GIF89a")), undefined);
  assert.equal(detectImageType(Buffer.from("RIFF....WEBPVP8 ")), undefined);
  assert.equal(detectImageType(Buffer.from("<svg xmlns=")), undefined);
  assert.equal(detectImageType(Buffer.alloc(0)), undefined);
  // Dos bytes de JPEG no alcanzan; siete de PNG tampoco.
  assert.equal(detectImageType(Buffer.from([0xff, 0xd8])), undefined);
  assert.equal(detectImageType(PNG.subarray(0, 7)), undefined);
});

test("isVehiclePhotoMimeType: solo image/jpeg e image/png, exactos", () => {
  assert.equal(isVehiclePhotoMimeType("image/jpeg"), true);
  assert.equal(isVehiclePhotoMimeType("image/png"), true);
  assert.equal(isVehiclePhotoMimeType("image/jpg"), false);
  assert.equal(isVehiclePhotoMimeType("image/webp"), false);
  assert.equal(isVehiclePhotoMimeType("application/pdf"), false);
  assert.equal(isVehiclePhotoMimeType("IMAGE/PNG"), false);
});
