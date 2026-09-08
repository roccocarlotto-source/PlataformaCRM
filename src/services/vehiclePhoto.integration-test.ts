import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { prisma } from "../lib/prisma";
import { getSupabaseAdmin } from "../lib/supabaseAdmin";
import { type DetectedImage } from "../utils/vehiclePhoto";
import { updateVehicle } from "./vehicle.service";
import {
  VEHICLE_PHOTO_BUCKET,
  deleteVehiclePhoto,
  getVehiclePhotos,
  reorderVehiclePhotos,
  updateVehiclePhoto,
  uploadVehiclePhoto,
} from "./vehiclePhoto.service";
import {
  assertAppError,
  borrador,
  capturar,
  completoUsado,
  desmontar,
  montar,
  type Escenario,
} from "./vehicle.test-helper";

// ---------------------------------------------------------------------------
// La galería contra Postgres Y Supabase Storage reales (Fase 2b) — la primera
// vez que el proyecto habla con Storage, y por eso no se mockea: el bucket se
// crea desde el código, un objeto se sube, se firma una URL de lectura y se
// descarga con ella, y al borrar el objeto deja de existir. Sobre eso, las
// reglas de la galería aplicadas a filas reales: portada automática, el
// índice único parcial al cambiar de portada, la herencia al borrar, el
// reorder en transacción, y la unidad publicada que no se queda sin fotos.
//
// Dos organizaciones (vehicle.test-helper.ts). Los objetos que quedan en
// Storage se borran en `after` por prefijo de organización, para que una
// corrida abortada no acumule basura en el bucket del .env.
// ---------------------------------------------------------------------------

const JPEG: DetectedImage = { mimeType: "image/jpeg", extension: "jpg" };
const PNG: DetectedImage = { mimeType: "image/png", extension: "png" };

// Bytes con firma válida y un relleno distinto por foto, para poder
// verificar que lo que se descarga es lo que se subió.
function jpegBytes(marca: string) {
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(marca)]);
}
function pngBytes(marca: string) {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from(marca),
  ]);
}

let a: Escenario;
let b: Escenario;

before(async () => {
  a = await montar("fa");
  b = await montar("fb");
});

async function limpiarStorage(organizationId: string) {
  const storage = getSupabaseAdmin().storage.from(VEHICLE_PHOTO_BUCKET.name);
  const { data: carpetas } = await storage.list(organizationId);
  for (const carpeta of carpetas ?? []) {
    const { data: objetos } = await storage.list(`${organizationId}/${carpeta.name}`);
    const rutas = (objetos ?? []).map((o) => `${organizationId}/${carpeta.name}/${o.name}`);
    if (rutas.length > 0) {
      await storage.remove(rutas);
    }
  }
}

after(async () => {
  const vivos = [a, b].filter(Boolean);
  for (const e of vivos) {
    await limpiarStorage(e.organizationId);
  }
  await desmontar(...vivos);
});

// Por list() —que consulta la tabla de objetos— y NO por download(): en el
// Supabase alojado las descargas pasan por un CDN que puede seguir sirviendo
// un objeto unos segundos después de borrado, y un test que descarga, borra
// y vuelve a descargar lee la copia cacheada. La tabla no miente.
async function objetoExiste(storagePath: string): Promise<boolean> {
  const corte = storagePath.lastIndexOf("/");
  const carpeta = storagePath.slice(0, corte);
  const nombre = storagePath.slice(corte + 1);
  const { data, error } = await getSupabaseAdmin()
    .storage.from(VEHICLE_PHOTO_BUCKET.name)
    .list(carpeta, { search: nombre });
  if (error) {
    throw new Error(`list(${carpeta}) falló: ${error.message}`);
  }
  return data.some((objeto) => objeto.name === nombre);
}

// ---------------------------------------------------------------------------
// Storage de verdad
// ---------------------------------------------------------------------------

test("subir: el bucket existe (privado) sin pasos manuales, el objeto queda en <org>/<vehicle>/<uuid>.<ext>, la URL firmada devuelve los bytes, y la primera foto es la portada", async () => {
  const v = await borrador(a);
  const galeria = await uploadVehiclePhoto(a.organizationId, v.id, {
    buffer: jpegBytes("primera"),
    image: JPEG,
    slot: "frente",
  });

  const bucket = await getSupabaseAdmin().storage.getBucket(VEHICLE_PHOTO_BUCKET.name);
  assert.ok(bucket.data, `el bucket tendría que existir: ${bucket.error?.message}`);
  assert.equal(bucket.data.public, false);

  assert.equal(galeria.length, 1);
  const [foto] = galeria;
  assert.equal(foto.isCover, true);
  assert.equal(foto.position, 0);
  assert.equal(foto.slot, "frente");
  assert.match(foto.storagePath, new RegExp(`^${a.organizationId}/${v.id}/[0-9a-f-]{36}\\.jpg$`));
  assert.equal(await objetoExiste(foto.storagePath), true);

  // La URL firmada se generó al responder, apunta al objeto y sirve para
  // leerlo sin ninguna credencial.
  assert.ok(foto.url, "la foto tiene que traer url firmada");
  assert.ok(foto.url.includes("token="), "la url tiene que estar firmada");
  const res = await fetch(foto.url);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/jpeg");
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), jpegBytes("primera"));

  // Y no se guardó ninguna URL en la base: solo la ruta.
  const fila = await prisma.vehiclePhoto.findUniqueOrThrow({ where: { id: foto.id } });
  assert.equal(fila.storagePath, foto.storagePath);
  assert.equal(fila.storagePath.startsWith("http"), false);
});

test("borrar: el objeto desaparece de Storage y la fila de la base; sin portada no queda si hay más fotos", async () => {
  const v = await borrador(a);
  await uploadVehiclePhoto(a.organizationId, v.id, { buffer: jpegBytes("uno"), image: JPEG });
  await uploadVehiclePhoto(a.organizationId, v.id, { buffer: pngBytes("dos"), image: PNG });
  const antes = await getVehiclePhotos(a.organizationId, v.id);
  const [portada, otra] = antes;
  assert.equal(portada.isCover, true);
  assert.equal(otra.isCover, false);
  assert.match(otra.storagePath, /\.png$/);

  const despues = await deleteVehiclePhoto(a.organizationId, v.id, portada.id);
  assert.equal(await objetoExiste(portada.storagePath), false);
  assert.equal(await prisma.vehiclePhoto.count({ where: { id: portada.id } }), 0);

  // La que quedó hereda la portada.
  assert.equal(despues.length, 1);
  assert.equal(despues[0].id, otra.id);
  assert.equal(despues[0].isCover, true);
  assert.equal(await objetoExiste(otra.storagePath), true);
});

// ---------------------------------------------------------------------------
// Reglas de la galería sobre filas reales
// ---------------------------------------------------------------------------

test("portada: subir con isCover cambia la portada; PATCH isCover pasa por el índice único parcial sin fallar; desmarcarla es 400", async () => {
  const v = await borrador(a);
  const [primera] = await uploadVehiclePhoto(a.organizationId, v.id, {
    buffer: jpegBytes("1"),
    image: JPEG,
  });
  assert.equal(primera.isCover, true);

  // Segunda con isCover: true — la primera deja de serlo en la misma
  // transacción.
  const conSegunda = await uploadVehiclePhoto(a.organizationId, v.id, {
    buffer: jpegBytes("2"),
    image: JPEG,
    isCover: true,
  });
  assert.deepEqual(
    conSegunda.map((p) => [p.position, p.isCover]),
    [
      [0, false],
      [1, true],
    ],
  );

  // Tercera sin pedirlo: no es portada.
  const conTercera = await uploadVehiclePhoto(a.organizationId, v.id, {
    buffer: jpegBytes("3"),
    image: JPEG,
  });
  assert.equal(conTercera[2].isCover, false);
  assert.equal(conTercera[2].position, 2);

  // PATCH: la primera vuelve a ser portada. Si el service marcara antes de
  // desmarcar, esto fallaría con el unique de la Fase 1.
  const vuelta = await updateVehiclePhoto(a.organizationId, v.id, primera.id, { isCover: true });
  assert.deepEqual(
    vuelta.map((p) => p.isCover),
    [true, false, false],
  );
  assert.equal(await prisma.vehiclePhoto.count({ where: { vehicleId: v.id, isCover: true } }), 1);

  // Desmarcar la portada sin elegir otra: 400 y nada cambia.
  const desmarcar = await capturar(() =>
    updateVehiclePhoto(a.organizationId, v.id, primera.id, { isCover: false }),
  );
  assertAppError(desmarcar, 400, "portada");
  // isCover: false sobre una que no es portada es un no-op válido; slot se
  // edita y se vacía.
  const slot = await updateVehiclePhoto(a.organizationId, v.id, conTercera[2].id, {
    isCover: false,
    slot: "interior",
  });
  assert.equal(slot[2].slot, "interior");
  const vaciado = await updateVehiclePhoto(a.organizationId, v.id, conTercera[2].id, {
    slot: null,
  });
  assert.equal(vaciado[2].slot, null);
});

test("reordenar: reescribe position para todas en una transacción; un set incompleto o ajeno es 400 y no toca nada", async () => {
  const v = await borrador(a);
  const ids: string[] = [];
  for (const marca of ["a", "b", "c"]) {
    const galeria = await uploadVehiclePhoto(a.organizationId, v.id, {
      buffer: jpegBytes(marca),
      image: JPEG,
    });
    ids.push(galeria[galeria.length - 1].id);
  }
  const [pa, pb, pc] = ids;

  const reordenada = await reorderVehiclePhotos(a.organizationId, v.id, [pc, pa, pb]);
  assert.deepEqual(
    reordenada.map((p) => [p.id, p.position]),
    [
      [pc, 0],
      [pa, 1],
      [pb, 2],
    ],
  );
  // La portada no cambia por reordenar: sigue siendo la primera que se subió.
  assert.equal(reordenada.find((p) => p.id === pa)?.isCover, true);

  const incompleto = await capturar(() => reorderVehiclePhotos(a.organizationId, v.id, [pa, pb]));
  assertAppError(incompleto, 400, "todas las fotos");
  const ajeno = await capturar(() =>
    reorderVehiclePhotos(a.organizationId, v.id, [pa, pb, randomUUID()]),
  );
  assertAppError(ajeno, 400, "no son de esta unidad");
  const intacta = await getVehiclePhotos(a.organizationId, v.id);
  assert.deepEqual(
    intacta.map((p) => p.id),
    [pc, pa, pb],
  );

  // Después de reordenar, borrar la portada: hereda la de posición más baja
  // (pc, que ahora está en 0), no la siguiente que se subió.
  const sinPortada = await deleteVehiclePhoto(a.organizationId, v.id, pa);
  assert.deepEqual(
    sinPortada.map((p) => [p.id, p.isCover]),
    [
      [pc, true],
      [pb, false],
    ],
  );
});

test("completitud: una unidad publicada no puede quedarse sin fotos — borrar la última es 422 y el objeto sigue en Storage; despublicada, se borra", async () => {
  const v = await borrador(a, { ...completoUsado, vin: "VINFOTO1", licensePlate: "FT0001" });
  const [foto] = await uploadVehiclePhoto(a.organizationId, v.id, {
    buffer: jpegBytes("unica"),
    image: JPEG,
  });
  const publicada = await updateVehicle(a.organizationId, a.userId, v.id, {
    publishOnWebsite: true,
  });
  assert.equal(publicada.publishOnWebsite, true);

  const borrar = await capturar(() => deleteVehiclePhoto(a.organizationId, v.id, foto.id));
  assert.deepEqual(assertAppError(borrar, 422, "photos").details, { missingFields: ["photos"] });
  assert.equal(await objetoExiste(foto.storagePath), true);
  assert.equal(await prisma.vehiclePhoto.count({ where: { id: foto.id } }), 1);

  // Con dos fotos sí se puede borrar una.
  const [, segunda] = await uploadVehiclePhoto(a.organizationId, v.id, {
    buffer: jpegBytes("segunda"),
    image: JPEG,
  });
  const quedaUna = await deleteVehiclePhoto(a.organizationId, v.id, segunda.id);
  assert.equal(quedaUna.length, 1);

  await updateVehicle(a.organizationId, a.userId, v.id, { publishOnWebsite: false });
  const vacia = await deleteVehiclePhoto(a.organizationId, v.id, foto.id);
  assert.deepEqual(vacia, []);
  assert.equal(await objetoExiste(foto.storagePath), false);
});

test("anti-enumeración: unidad ajena, inexistente o dada de baja es 404 en todas las escrituras y nada llega a Storage; una foto ajena por id es 404", async () => {
  const propia = await borrador(a);
  const [fotoPropia] = await uploadVehiclePhoto(a.organizationId, propia.id, {
    buffer: jpegBytes("propia"),
    image: JPEG,
  });
  const ajena = await borrador(b);
  const [fotoAjena] = await uploadVehiclePhoto(b.organizationId, ajena.id, {
    buffer: jpegBytes("ajena"),
    image: JPEG,
  });

  for (const id of [ajena.id, randomUUID()]) {
    for (const fn of [
      () => uploadVehiclePhoto(a.organizationId, id, { buffer: jpegBytes("x"), image: JPEG }),
      () => updateVehiclePhoto(a.organizationId, id, fotoAjena.id, { isCover: true }),
      () => deleteVehiclePhoto(a.organizationId, id, fotoAjena.id),
      () => reorderVehiclePhotos(a.organizationId, id, [fotoAjena.id]),
    ]) {
      assertAppError(await capturar(fn), 404, "Vehículo no encontrado");
    }
  }
  // La foto ajena sigue donde estaba, con su objeto.
  assert.equal(await objetoExiste(fotoAjena.storagePath), true);
  assert.equal((await getVehiclePhotos(b.organizationId, ajena.id))[0].isCover, true);

  // Unidad propia pero photoId de otra unidad (o inexistente): 404 de foto.
  for (const photoId of [fotoAjena.id, randomUUID()]) {
    assertAppError(
      await capturar(() => updateVehiclePhoto(a.organizationId, propia.id, photoId, { slot: "x" })),
      404,
      "Foto no encontrada",
    );
    assertAppError(
      await capturar(() => deleteVehiclePhoto(a.organizationId, propia.id, photoId)),
      404,
      "Foto no encontrada",
    );
  }
  assert.equal(await objetoExiste(fotoPropia.storagePath), true);

  // Las fotos de una unidad ajena, leídas desde la otra organización, son
  // una lista vacía (el WHERE), nunca las de la otra.
  assert.deepEqual(await getVehiclePhotos(a.organizationId, ajena.id), []);
});
