import assert from "node:assert/strict";
import { test } from "node:test";
import { AppError } from "../utils/AppError";
import {
  VEHICLE_PHOTO_BUCKET,
  VEHICLE_PHOTO_URL_TTL_SECONDS,
  buildStoragePath,
  computeReorderedPositions,
  decideNewPhotoPlacement,
  pickNextCover,
} from "./vehiclePhoto.service";

// ---------------------------------------------------------------------------
// Las reglas puras de la galería (Fase 2b), sin base y sin Storage: dónde
// entra una foto nueva, quién hereda la portada, y qué orden es válido. Su
// aplicación contra Postgres y Storage reales está en
// vehiclePhoto.integration-test.ts.
// ---------------------------------------------------------------------------

function assertAppError(fn: () => unknown, statusCode: number, messageIncludes: string) {
  assert.throws(fn, (err: unknown) => {
    assert.ok(err instanceof AppError, "debería ser un AppError");
    assert.equal(err.statusCode, statusCode);
    assert.ok(
      err.message.includes(messageIncludes),
      `"${err.message}" no contiene "${messageIncludes}"`,
    );
    return true;
  });
}

// ---------------------------------------------------------------------------
// decideNewPhotoPlacement
// ---------------------------------------------------------------------------

test("primera foto: posición 0 y portada aunque no se pida (ni siquiera si se pide que no)", () => {
  assert.deepEqual(decideNewPhotoPlacement([], undefined), { position: 0, isCover: true });
  assert.deepEqual(decideNewPhotoPlacement([], false), { position: 0, isCover: true });
  assert.deepEqual(decideNewPhotoPlacement([], true), { position: 0, isCover: true });
});

test("con galería: va al final (max + 1, no length) y no es portada salvo que se pida", () => {
  // Posiciones con hueco (quedó de un borrado): el final es max + 1, no la
  // cantidad, para no chocar con una existente.
  const galeria = [
    { position: 0, isCover: true },
    { position: 4, isCover: false },
  ];
  assert.deepEqual(decideNewPhotoPlacement(galeria, undefined), { position: 5, isCover: false });
  assert.deepEqual(decideNewPhotoPlacement(galeria, false), { position: 5, isCover: false });
  assert.deepEqual(decideNewPhotoPlacement(galeria, true), { position: 5, isCover: true });
});

test("con galería pero sin portada (estado que no debería darse): la nueva la toma", () => {
  const sinPortada = [{ position: 0, isCover: false }];
  assert.deepEqual(decideNewPhotoPlacement(sinPortada, undefined), {
    position: 1,
    isCover: true,
  });
});

// ---------------------------------------------------------------------------
// pickNextCover
// ---------------------------------------------------------------------------

test("al borrar la portada hereda la de posición más baja, sin confiar en el orden de entrada", () => {
  assert.equal(
    pickNextCover([
      { id: "c", position: 7 },
      { id: "a", position: 2 },
      { id: "b", position: 5 },
    ]),
    "a",
  );
  assert.equal(pickNextCover([{ id: "solo", position: 3 }]), "solo");
  assert.equal(pickNextCover([]), undefined);
});

test("empate de posición: se queda con la primera que llega (el repositorio desempata por createdAt)", () => {
  assert.equal(
    pickNextCover([
      { id: "primera", position: 1 },
      { id: "segunda", position: 1 },
    ]),
    "primera",
  );
});

// ---------------------------------------------------------------------------
// computeReorderedPositions
// ---------------------------------------------------------------------------

test("reordenar: position = índice en la lista recibida, para todas", () => {
  assert.deepEqual(computeReorderedPositions(["a", "b", "c"], ["c", "a", "b"]), [
    { id: "c", position: 0 },
    { id: "a", position: 1 },
    { id: "b", position: 2 },
  ]);
  assert.deepEqual(computeReorderedPositions([], []), []);
});

test("reordenar: repetidos, ajenas y faltantes son 400, en ese orden de detección", () => {
  assertAppError(() => computeReorderedPositions(["a", "b"], ["a", "a"]), 400, "repetidos");
  assertAppError(() => computeReorderedPositions(["a", "b"], ["a", "x"]), 400, "no son de esta");
  assertAppError(
    () => computeReorderedPositions(["a", "b", "c"], ["a", "b"]),
    400,
    "todas las fotos",
  );
  // Una de más que además existe no puede pasar: los ids son únicos, así
  // que "de más" solo puede ser repetida o ajena, y las dos ya se cubren.
});

// ---------------------------------------------------------------------------
// Constantes y ruta en Storage
// ---------------------------------------------------------------------------

test("la ruta en Storage es <organizationId>/<vehicleId>/<uuid>.<ext>, con la extensión detectada", () => {
  const ruta = buildStoragePath("org-1", "veh-2", "png");
  const partes = ruta.split("/");
  assert.equal(partes.length, 3);
  assert.equal(partes[0], "org-1");
  assert.equal(partes[1], "veh-2");
  assert.match(partes[2], /^[0-9a-f-]{36}\.png$/);
  // Dos llamadas, dos uuids: nunca se pisa un objeto.
  assert.notEqual(ruta, buildStoragePath("org-1", "veh-2", "png"));
});

test("bucket privado con nombre fijo, límite de 5 MB y solo JPEG/PNG; URLs firmadas de una hora", () => {
  assert.equal(VEHICLE_PHOTO_BUCKET.name, "vehicle-photos");
  assert.equal(VEHICLE_PHOTO_BUCKET.fileSizeLimit, 5 * 1024 * 1024);
  assert.deepEqual(VEHICLE_PHOTO_BUCKET.allowedMimeTypes, ["image/jpeg", "image/png"]);
  assert.equal(VEHICLE_PHOTO_URL_TTL_SECONDS, 3600);
});
