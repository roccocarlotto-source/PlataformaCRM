import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { Writable } from "node:stream";
import { after, before, test } from "node:test";
import { Prisma } from "@prisma/client";
import express, { type Request as ExpressRequest, type Response as ExpressResponse } from "express";
import pino from "pino";
import pinoHttp from "pino-http";
import { env } from "../config/env";
import { loggerOptions } from "../lib/logger";
import { AppError } from "../utils/AppError";
import { MASTER_KEY_BYTES, crearCifrador } from "../utils/encryption";
import { authorize } from "./authorize";
import { jsonParser, urlencodedParser } from "./bodyParserError";
import { errorHandler } from "./errorHandler";
import { notFound } from "./notFound";

// ---------------------------------------------------------------------------
// errorHandler de punta a punta por HTTP — M-11 de docs/auditoria-2026-08-29.md
// — SIN base de datos: todo lo que decide errorHandler se puede provocar con
// una app Express mínima y rutas que lanzan. Por eso es un .test.ts y no un
// .integration-test.ts. Lo que sí hace falta es la cadena real: pinoHttp con
// las loggerOptions reales (para que exista req.log con su req.id), los parsers
// globales reales de app.ts, notFound y errorHandler.
//
// LAS LÍNEAS DE LOG SE LEEN DEL STREAM, no se infieren: es la única forma de
// afirmar con qué logger y a qué nivel se escribió. Mismo mecanismo que
// ingest.controller.integration-test y logger.test.
// ---------------------------------------------------------------------------

let baseUrl: string;
let closeApp: () => Promise<void>;
let lineas: Record<string, unknown>[] = [];

// Una clave de prueba para el Cifrador: la reproducción del "formato inválido"
// no necesita la clave del entorno, y así el test corre sin variables.
const CLAVE = Buffer.alloc(MASTER_KEY_BYTES, 7);

const MENSAJE_CRUDO_DE_PRISMA =
  "Foreign key constraint violated on the constraint: `sources_organization_id_fkey`";

function errorDePrisma(code: string) {
  return new Prisma.PrismaClientKnownRequestError(MENSAJE_CRUDO_DE_PRISMA, {
    code,
    clientVersion: "x",
  });
}

function startTestApp(): Promise<{ url: string; close: () => Promise<void> }> {
  const sink = new Writable({
    write(chunk, _encoding, callback) {
      for (const cruda of chunk.toString().split("\n")) {
        if (cruda.trim().length > 0) {
          lineas.push(JSON.parse(cruda) as Record<string, unknown>);
        }
      }
      callback();
    },
  });

  // Nivel "warn" a propósito y no "info": así la línea de "request completed"
  // de pinoHttp NO se emite, y lo único que queda en el stream son las líneas
  // que escribe errorHandler.
  const logger = pino({ ...loggerOptions, level: "warn", transport: undefined }, sink);

  const app = express();
  app.use(pinoHttp({ logger }));
  // pinoHttp genera req.id pero no lo expone en la respuesta. Este middleware
  // de test lo copia a un header para poder afirmar, desde afuera, que la
  // línea que escribió errorHandler lleva EXACTAMENTE ese id — cosa que el
  // logger raíz, que no sabe de ningún request, no podría escribir.
  app.use((req, res, next) => {
    res.setHeader("x-test-request-id", String(req.id));
    next();
  });
  app.use(jsonParser);
  app.use(urlencodedParser);

  app.post("/eco", (req: ExpressRequest, res: ExpressResponse) => {
    res.status(200).json({ recibido: req.body as unknown });
  });
  app.get("/operacional", () => {
    throw new AppError("Este mensaje es seguro para el cliente", 500);
  });
  app.get("/no-operacional", () => {
    throw new AppError("SUPABASE_URL no está configurado en el servidor", 500, false);
  });
  app.get("/cuatrocientos", () => {
    throw new AppError("No encontrado", 404);
  });
  app.get("/generico", () => {
    throw new Error("boom interno con detalle");
  });
  app.get("/prisma/:code", (req: ExpressRequest) => {
    throw errorDePrisma(req.params.code);
  });
  // Dos de los diez sitios reclasificados a isOperational: false, reproducidos
  // de verdad y no simulados: authorize() sin authenticate() antes, y un
  // secreto cifrado con formato inválido.
  app.get("/autorizado-sin-autenticar", authorize("ADMIN"), (_req, res) => {
    res.status(200).end();
  });
  app.get("/descifrar", () => {
    crearCifrador(CLAVE).decrypt("esto-no-es-un-secreto-cifrado");
  });
  // Formato válido pero ciphertext manipulado: el que rechaza es el tag de
  // GCM, en el catch de decipher.final() — el sitio 3 de la bitácora §28.7.
  app.get("/descifrar-manipulado", () => {
    const cifrador = crearCifrador(CLAVE);
    const guardado = cifrador.encrypt("un refresh token");
    const partes = guardado.split(".");
    const ultimo = partes[3].at(-1) === "A" ? "B" : "A";
    partes[3] = partes[3].slice(0, -1) + ultimo;
    cifrador.decrypt(partes.join("."));
  });

  app.use(notFound);
  app.use(errorHandler);

  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

async function pedir(path: string, init?: RequestInit): Promise<Response> {
  lineas = [];
  const res = await fetch(`${baseUrl}${path}`, init);
  // errorHandler escribe antes de responder, así que cuando fetch resolvió la
  // línea ya está en el stream. Se afirma igual, para que el test no pase
  // callado si eso cambia.
  assert.ok(lineas.length > 0, "errorHandler tiene que haber dejado una línea de log");
  return res;
}

async function cuerpo(res: Response): Promise<{ error: { message: string; stack?: string } }> {
  return (await res.json()) as { error: { message: string; stack?: string } };
}

function lineaDeError(): Record<string, unknown> {
  assert.equal(lineas.length, 1, "exactamente una línea por request en nivel warn");
  return lineas[0];
}

before(async () => {
  const started = await startTestApp();
  baseUrl = started.url;
  closeApp = started.close;
});

after(async () => {
  if (closeApp) await closeApp();
});

// ---------------------------------------------------------------------------
// (a) Los parsers globales traducen sus errores: 413/400, no 500.
// ---------------------------------------------------------------------------

test("(a) un JSON demasiado grande en un endpoint que NO es /api/ingest da 413, no 500", async () => {
  // El default de body-parser son 100 KB; sin la traducción esto era 500.
  const gigante = JSON.stringify({ relleno: "x".repeat(120 * 1024) });
  const res = await pedir("/eco", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: gigante,
  });

  assert.equal(res.status, 413);
  assert.equal((await cuerpo(res)).error.message, "El cuerpo del request es demasiado grande");
});

test("(a) un JSON mal formado en un endpoint que NO es /api/ingest da 400, no 500", async () => {
  const res = await pedir("/eco", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{no es json",
  });

  assert.equal(res.status, 400);
  assert.equal((await cuerpo(res)).error.message, "El cuerpo del request no es JSON válido");
});

test("(a) un charset no soportado da 415", async () => {
  const res = await pedir("/eco", {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-32" },
    body: '{"a":1}',
  });

  assert.equal(res.status, 415);
  assert.equal((await cuerpo(res)).error.message, "Codificación de cuerpo no soportada");
});

test("(a) un formulario urlencoded demasiado grande da 413", async () => {
  const res = await pedir("/eco", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `campo=${"x".repeat(120 * 1024)}`,
  });

  assert.equal(res.status, 413);
});

test("(a) el caso feliz de los parsers no cambió: JSON válido llega parseado", async () => {
  lineas = [];
  const res = await fetch(`${baseUrl}/eco`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ a: 1 }),
  });

  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { recibido: { a: 1 } });
});

// ---------------------------------------------------------------------------
// (b) isOperational decide si el cliente ve el mensaje real.
// ---------------------------------------------------------------------------

test("(b) un AppError(msg, 500) operacional responde con msg tal cual", async () => {
  const res = await pedir("/operacional");

  assert.equal(res.status, 500);
  const body = await cuerpo(res);
  assert.equal(body.error.message, "Este mensaje es seguro para el cliente");
  // Un AppError operacional ya dice todo en su mensaje: nunca lleva stack.
  assert.equal(body.error.stack, undefined);
});

test("(b) un AppError(msg, 500, false) responde con el mensaje genérico y msg queda solo en el log", async () => {
  const res = await pedir("/no-operacional");

  assert.equal(res.status, 500);
  const body = await cuerpo(res);
  assert.equal(body.error.message, "Error interno del servidor");
  assert.ok(!body.error.message.includes("SUPABASE_URL"), "el detalle interno no llega al cliente");

  // ...pero SÍ está en el log, que es para lo que existe.
  assert.equal(lineaDeError().msg, "SUPABASE_URL no está configurado en el servidor");

  // El stack va solo en desarrollo, y en ese caso SÍ para un AppError no
  // operacional: es un bug/config rota, igual que un error que no es AppError.
  if (env.isDevelopment) {
    assert.ok(typeof body.error.stack === "string" && body.error.stack.length > 0);
  } else {
    assert.equal(body.error.stack, undefined);
  }
});

test("(b) reproducción real: authorize() sin authenticate() antes no filtra su mensaje", async () => {
  const res = await pedir("/autorizado-sin-autenticar");

  assert.equal(res.status, 500);
  assert.equal((await cuerpo(res)).error.message, "Error interno del servidor");
  assert.equal(lineaDeError().msg, "authorize() debe usarse después del middleware authenticate");
});

test("(b) reproducción real: un secreto cifrado con formato inválido no filtra el formato", async () => {
  const res = await pedir("/descifrar");

  assert.equal(res.status, 500);
  assert.equal((await cuerpo(res)).error.message, "Error interno del servidor");
  assert.equal(lineaDeError().msg, "Secreto cifrado con formato inválido");
});

test("(b) reproducción real: un secreto cifrado MANIPULADO no filtra ni la causa ni el nombre de la clave", async () => {
  const res = await pedir("/descifrar-manipulado");

  assert.equal(res.status, 500);
  const body = await cuerpo(res);
  assert.equal(body.error.message, "Error interno del servidor");
  assert.ok(!body.error.message.includes("SECRET_ENCRYPTION_KEY"));
  assert.equal(
    lineaDeError().msg,
    "No se pudo descifrar el secreto: fue manipulado, o SECRET_ENCRYPTION_KEY no es la clave con la que se cifró",
  );
});

test("(b) un error que no es AppError responde genérico, y con stack solo en desarrollo", async () => {
  const res = await pedir("/generico");

  assert.equal(res.status, 500);
  const body = await cuerpo(res);
  assert.equal(body.error.message, "Error interno del servidor");
  assert.ok(!JSON.stringify(body.error.message).includes("boom"));
  assert.equal(lineaDeError().msg, "Unhandled error");
  if (env.isDevelopment) {
    assert.ok(typeof body.error.stack === "string");
  } else {
    assert.equal(body.error.stack, undefined);
  }
});

// ---------------------------------------------------------------------------
// (c) Los códigos genéricos de Prisma se traducen en errorHandler.
// ---------------------------------------------------------------------------

for (const code of ["P2034", "P2028"]) {
  test(`(c) un ${code} de Prisma responde 409 con mensaje de reintento, sin el detalle crudo`, async () => {
    const res = await pedir(`/prisma/${code}`);

    assert.equal(res.status, 409);
    const body = await cuerpo(res);
    assert.match(body.error.message, /conflicto temporal/);
    assert.ok(!JSON.stringify(body).includes("fkey"), "nada del mensaje crudo de Prisma llega");
  });
}

test("(c) un P2003 de Prisma responde 400 — el llamador referenció un id que no existe", async () => {
  const res = await pedir("/prisma/P2003");

  assert.equal(res.status, 400);
  const body = await cuerpo(res);
  assert.match(body.error.message, /recurso que no existe/);
  assert.ok(!JSON.stringify(body).includes("fkey"));
});

test("(c) un P2002 que llega sin traducir por su servicio sigue siendo el 500 genérico de siempre", async () => {
  const res = await pedir("/prisma/P2002");

  assert.equal(res.status, 500);
  const body = await cuerpo(res);
  assert.equal(body.error.message, "Error interno del servidor");
  assert.ok(!JSON.stringify(body.error.message).includes("fkey"));
  assert.equal(lineaDeError().msg, "Unhandled error");
});

// ---------------------------------------------------------------------------
// (d) y (e) Con qué logger y a qué nivel.
// ---------------------------------------------------------------------------

test("(d) la línea de error lleva el req.id del request — es req.log, no el logger raíz", async () => {
  const res = await pedir("/cuatrocientos");

  // El hijo req.log serializa el request con su id en `req.id`.
  const idDelRequest = res.headers.get("x-test-request-id");
  assert.ok(idDelRequest, "el middleware de test tiene que haber expuesto req.id");

  const linea = lineaDeError();
  const req = linea.req as { id?: unknown } | undefined;
  assert.equal(String(req?.id), idDelRequest);
  assert.equal(linea.path, "/cuatrocientos");
  assert.equal(linea.method, "GET");
});

test("(d) dos requests distintos dejan líneas con ids distintos", async () => {
  const primera = await pedir("/cuatrocientos");
  const idA = primera.headers.get("x-test-request-id");
  const segunda = await pedir("/cuatrocientos");
  const idB = segunda.headers.get("x-test-request-id");

  assert.ok(idA && idB);
  assert.notEqual(idA, idB);
  assert.equal(String((lineaDeError().req as { id?: unknown }).id), idB);
});

test("(e) un 4xx se loguea en warn; un 5xx en error", async () => {
  await pedir("/cuatrocientos");
  assert.equal(lineaDeError().level, pino.levels.values.warn);
  assert.equal(lineaDeError().msg, "No encontrado");

  await pedir("/operacional");
  assert.equal(lineaDeError().level, pino.levels.values.error);

  await pedir("/generico");
  assert.equal(lineaDeError().level, pino.levels.values.error);
});

test("(e) el nivel sale del status YA traducido: un P2003 (400 tras traducir) va a warn, un P2002 (500) a error", async () => {
  await pedir("/prisma/P2003");
  assert.equal(lineaDeError().level, pino.levels.values.warn);

  await pedir("/prisma/P2002");
  assert.equal(lineaDeError().level, pino.levels.values.error);
});

test("(e) un 413 de los parsers globales también va a warn: es un error del cliente", async () => {
  await pedir("/eco", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ relleno: "x".repeat(120 * 1024) }),
  });
  assert.equal(lineaDeError().level, pino.levels.values.warn);
});

test("un 404 de notFound pasa por errorHandler como cualquier otro 4xx", async () => {
  const res = await pedir(`/no-existe-${randomUUID()}`);
  assert.equal(res.status, 404);
  assert.equal(lineaDeError().level, pino.levels.values.warn);
});
