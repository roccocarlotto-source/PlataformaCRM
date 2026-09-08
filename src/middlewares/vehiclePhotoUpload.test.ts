import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import express, { type NextFunction, type Request, type Response } from "express";
import { AppError } from "../utils/AppError";
import { VEHICLE_PHOTO_MAX_BYTES } from "../utils/vehiclePhoto";
import { vehiclePhotoUpload, type VehiclePhotoUploadRequest } from "./vehiclePhotoUpload";

// ---------------------------------------------------------------------------
// El middleware contra HTTP real, sin base y sin Storage: lo que importa acá
// es que NINGÚN rechazo de multer ni del filtro llegue como 500. Un express
// mínimo con el middleware y un handler que devuelve lo que el middleware
// dejó en el request, más un errorHandler que solo distingue AppError de lo
// demás (mismo criterio que el real).
// ---------------------------------------------------------------------------

let baseUrl: string;
let cerrar: () => Promise<void>;

before(async () => {
  const app = express();
  app.post("/photos", vehiclePhotoUpload, (req: Request, res: Response) => {
    const { file, detectedImage, body } = req as VehiclePhotoUploadRequest;
    res.status(200).json({
      size: file?.buffer.length,
      declared: file?.mimetype,
      detected: detectedImage,
      body,
    });
  });
  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ error: { message: err.message } });
      return;
    }
    res.status(500).json({ error: { message: "crudo" } });
  });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  cerrar = () => new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
});

after(async () => {
  await cerrar();
});

const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function archivo(bytes: Buffer, mimeType: string) {
  return new Blob([bytes], { type: mimeType });
}

async function subir(form: FormData) {
  const res = await fetch(`${baseUrl}/photos`, { method: "POST", body: form });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

test("camino feliz: JPEG y PNG pasan, con el tipo detectado por firma y los campos de texto en body", async () => {
  const form = new FormData();
  form.append(
    "photo",
    archivo(Buffer.concat([JPEG_HEADER, Buffer.alloc(100)]), "image/jpeg"),
    "x.jpg",
  );
  form.append("slot", "frente");
  form.append("isCover", "true");
  const jpeg = await subir(form);
  assert.equal(jpeg.status, 200);
  assert.equal(jpeg.json.size, 104);
  assert.deepEqual(jpeg.json.detected, { mimeType: "image/jpeg", extension: "jpg" });
  assert.deepEqual(jpeg.json.body, { slot: "frente", isCover: "true" });

  const formPng = new FormData();
  formPng.append(
    "photo",
    archivo(Buffer.concat([PNG_HEADER, Buffer.alloc(10)]), "image/png"),
    "y.png",
  );
  const png = await subir(formPng);
  assert.equal(png.status, 200);
  assert.deepEqual(png.json.detected, { mimeType: "image/png", extension: "png" });
});

test("tipo declarado no admitido: 415 desde el fileFilter, nunca 500", async () => {
  const form = new FormData();
  form.append("photo", archivo(Buffer.from("%PDF-1.4"), "application/pdf"), "doc.pdf");
  const res = await subir(form);
  assert.equal(res.status, 415);
  assert.match(String((res.json.error as { message: string }).message), /JPEG o PNG/);
});

test("declara image/png pero los bytes no son PNG (ni JPEG): 415 por la firma", async () => {
  const form = new FormData();
  form.append("photo", archivo(Buffer.from("GIF89a...."), "image/png"), "fake.png");
  const res = await subir(form);
  assert.equal(res.status, 415);
});

test("más de 5 MB: 413 traducido de LIMIT_FILE_SIZE, no 500", async () => {
  const form = new FormData();
  const grande = Buffer.concat([JPEG_HEADER, Buffer.alloc(VEHICLE_PHOTO_MAX_BYTES)]);
  form.append("photo", archivo(grande, "image/jpeg"), "grande.jpg");
  const res = await subir(form);
  assert.equal(res.status, 413);
  assert.match(String((res.json.error as { message: string }).message), /5 MB/);
});

// Dónde cae exactamente el borde (5 MB justos) lo decide busboy, no este
// middleware; lo que importa es que un archivo grande pero admitido pase.
test("un byte por debajo del máximo pasa: el límite acota, no rechaza fotos grandes válidas", async () => {
  const form = new FormData();
  const justo = Buffer.concat([
    JPEG_HEADER,
    Buffer.alloc(VEHICLE_PHOTO_MAX_BYTES - JPEG_HEADER.length - 1),
  ]);
  form.append("photo", archivo(justo, "image/jpeg"), "justo.jpg");
  const res = await subir(form);
  assert.equal(res.status, 200);
  assert.equal(res.json.size, VEHICLE_PHOTO_MAX_BYTES - 1);
});

test("sin archivo, o en otro campo, o dos archivos: 400 con el nombre del campo esperado", async () => {
  const sinArchivo = new FormData();
  sinArchivo.append("slot", "frente");
  const r1 = await subir(sinArchivo);
  assert.equal(r1.status, 400);
  assert.match(String((r1.json.error as { message: string }).message), /"photo"/);

  const otroCampo = new FormData();
  otroCampo.append("file", archivo(JPEG_HEADER, "image/jpeg"), "x.jpg");
  const r2 = await subir(otroCampo);
  assert.equal(r2.status, 400);

  const dos = new FormData();
  dos.append("photo", archivo(JPEG_HEADER, "image/jpeg"), "a.jpg");
  dos.append("photo", archivo(JPEG_HEADER, "image/jpeg"), "b.jpg");
  const r3 = await subir(dos);
  assert.equal(r3.status, 400);
});

test("un body que no es multipart: 400, no 500", async () => {
  const res = await fetch(`${baseUrl}/photos`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ photo: "x" }),
  });
  assert.equal(res.status, 400);
});
