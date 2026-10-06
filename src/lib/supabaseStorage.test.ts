import assert from "node:assert/strict";
import { test } from "node:test";
import { bucketAlineado, type BucketSpec } from "./supabaseStorage";

// ensureBucket alinea un bucket que ya existe con su spec (WebP en las fotos
// de vehículos, 06/10/2026). Lo que decide si hace falta tocarlo es esta
// función: el contra Storage real está en vehiclePhoto.integration-test.ts.

const SPEC: BucketSpec = {
  name: "ejemplo",
  fileSizeLimit: 5 * 1024 * 1024,
  allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
};

test("bucketAlineado: mismo tamaño, mismos tipos en cualquier orden y privado → no se toca", () => {
  assert.equal(
    bucketAlineado(
      {
        public: false,
        file_size_limit: SPEC.fileSizeLimit,
        allowed_mime_types: ["image/webp", "image/jpeg", "image/png"],
      },
      SPEC,
    ),
    true,
  );
});

test("bucketAlineado: un tipo de menos (el bucket viejo sin WebP), un tamaño distinto, sin tipos o público → hay que alinearlo", () => {
  const base = { public: false, file_size_limit: SPEC.fileSizeLimit };
  assert.equal(
    bucketAlineado({ ...base, allowed_mime_types: ["image/jpeg", "image/png"] }, SPEC),
    false,
  );
  assert.equal(
    bucketAlineado(
      { ...base, file_size_limit: 1024, allowed_mime_types: SPEC.allowedMimeTypes },
      SPEC,
    ),
    false,
  );
  assert.equal(bucketAlineado({ ...base, allowed_mime_types: null }, SPEC), false);
  assert.equal(
    bucketAlineado(
      { ...base, file_size_limit: null, allowed_mime_types: SPEC.allowedMimeTypes },
      SPEC,
    ),
    false,
  );
  assert.equal(
    bucketAlineado({ ...base, public: true, allowed_mime_types: SPEC.allowedMimeTypes }, SPEC),
    false,
  );
});
