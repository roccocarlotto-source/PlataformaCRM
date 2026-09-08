import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import {
  reorderVehiclePhotosSchema,
  updateVehiclePhotoSchema,
  uploadVehiclePhotoBodySchema,
} from "./vehiclePhoto.controller";

// La frontera de validación de la galería (Fase 2b), sin HTTP. El archivo en
// sí lo valida vehiclePhotoUpload (multer + firma); acá solo los campos.

test("POST multipart: slot e isCover opcionales; isCover llega como string y se convierte", () => {
  assert.deepEqual(uploadVehiclePhotoBodySchema.parse({}), {});
  assert.deepEqual(uploadVehiclePhotoBodySchema.parse({ slot: " frente ", isCover: "true" }), {
    slot: "frente",
    isCover: true,
  });
  assert.deepEqual(uploadVehiclePhotoBodySchema.parse({ isCover: "false" }), { isCover: false });
  // Vacío = sin ángulo asignado.
  assert.deepEqual(uploadVehiclePhotoBodySchema.parse({ slot: "   " }), { slot: null });
});

test('POST multipart: isCover distinto de "true"/"false" es inválido (no hay coerción), slot largo también', () => {
  assert.equal(uploadVehiclePhotoBodySchema.safeParse({ isCover: "1" }).success, false);
  assert.equal(uploadVehiclePhotoBodySchema.safeParse({ isCover: "yes" }).success, false);
  assert.equal(uploadVehiclePhotoBodySchema.safeParse({ slot: "x".repeat(31) }).success, false);
  assert.equal(uploadVehiclePhotoBodySchema.safeParse({ slot: "x".repeat(30) }).success, true);
});

test("PATCH: slot (nullable) e isCover (boolean real); body vacío rechazado; desconocidos se descartan", () => {
  assert.deepEqual(updateVehiclePhotoSchema.parse({ slot: null }), { slot: null });
  assert.deepEqual(updateVehiclePhotoSchema.parse({ isCover: true }), { isCover: true });
  assert.deepEqual(updateVehiclePhotoSchema.parse({ slot: "perfil", isCover: false }), {
    slot: "perfil",
    isCover: false,
  });
  assert.equal(updateVehiclePhotoSchema.safeParse({}).success, false);
  assert.equal(updateVehiclePhotoSchema.safeParse({ isCover: "true" }).success, false);
  // position no se edita por PATCH: el orden se reemplaza entero por reorder.
  assert.equal(updateVehiclePhotoSchema.safeParse({ position: 3 }).success, false);
});

test("PUT reorder: photoIds es un array no vacío de uuids", () => {
  const a = randomUUID();
  const b = randomUUID();
  assert.deepEqual(reorderVehiclePhotosSchema.parse({ photoIds: [b, a] }), { photoIds: [b, a] });
  assert.equal(reorderVehiclePhotosSchema.safeParse({ photoIds: [] }).success, false);
  assert.equal(reorderVehiclePhotosSchema.safeParse({ photoIds: ["no-uuid"] }).success, false);
  assert.equal(reorderVehiclePhotosSchema.safeParse({}).success, false);
});
