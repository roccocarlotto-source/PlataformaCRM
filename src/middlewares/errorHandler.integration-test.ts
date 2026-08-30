import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import express from "express";
import { app } from "../app";
import { prisma } from "../lib/prisma";
import { errorHandler } from "./errorHandler";
import { notFound } from "./notFound";

// ---------------------------------------------------------------------------
// Lo de M-11 que SÍ necesita la base o la app real — el resto está en
// errorHandler.test.ts, sin base.
//
//   1. Un P2003 REAL: no un PrismaClientKnownRequestError construido a mano
//      sino el que Postgres produce al violar una FK, para fijar que el código
//      que llega por el cliente real es el que errorHandler traduce.
//   2. La app REAL de app.ts: que los parsers globales montados ahí —con su
//      orden real respecto de pinoHttp, el router de ingesta y routes— traducen
//      413/400 en un endpoint que no es /api/ingest. El cuerpo se rechaza en el
//      parser, antes de authenticate, así que no hace falta ninguna identidad.
// ---------------------------------------------------------------------------

let realUrl: string;
let miniUrl: string;
const cerrar: (() => Promise<void>)[] = [];

function escuchar(instancia: express.Express): Promise<string> {
  return new Promise((resolve) => {
    const server = instancia.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      cerrar.push(() => new Promise((r) => server.close(() => r())));
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

before(async () => {
  realUrl = await escuchar(app);

  // Una ruta que hace una escritura real referenciando una organización que no
  // existe: la FK (organization_id) -> organizations la rechaza con P2003.
  const mini = express();
  mini.post("/fk-rota", async (_req, _res, next) => {
    try {
      await prisma.source.create({
        data: { organizationId: randomUUID(), name: "huérfana", type: "WEBHOOK" },
      });
      next(new Error("el INSERT no debería haber pasado"));
    } catch (err) {
      next(err);
    }
  });
  mini.use(notFound);
  mini.use(errorHandler);
  miniUrl = await escuchar(mini);
});

after(async () => {
  for (const c of cerrar) await c();
});

test("(c) un P2003 real de Postgres responde 400 con el mensaje genérico, no el 500 crudo de Prisma", async () => {
  const res = await fetch(`${miniUrl}/fk-rota`, { method: "POST" });

  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: { message: string } };
  assert.equal(body.error.message, "La operación hace referencia a un recurso que no existe.");
  assert.ok(!JSON.stringify(body).includes("organization"), "nada del detalle crudo llega");
});

test("(a) en la app real, un JSON mal formado a un endpoint que no es /api/ingest da 400, no 500", async () => {
  const res = await fetch(`${realUrl}/api/companies`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{no es json",
  });

  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: { message: string } };
  assert.equal(body.error.message, "El cuerpo del request no es JSON válido");
});

test("(a) en la app real, un cuerpo por encima del default de 100 KB a un endpoint que no es /api/ingest da 413, no 500", async () => {
  const res = await fetch(`${realUrl}/api/companies`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ relleno: "x".repeat(120 * 1024) }),
  });

  assert.equal(res.status, 413);
});

test("(a) en la app real, /api/ingest conserva SU mensaje de 413, que nombra su propio tope", async () => {
  const res = await fetch(`${realUrl}/api/ingest`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": "crm_no-importa" },
    body: JSON.stringify({ relleno: "x".repeat(70 * 1024) }),
  });

  // 70 KB: por encima de INGEST_MAX_BODY_BYTES (64 KB) y por debajo del default
  // global (100 KB). Solo el parser de la ingesta puede haberlo rechazado, y
  // con su texto — la traducción global no lo pisó.
  assert.equal(res.status, 413);
  const body = (await res.json()) as { error: { message: string } };
  assert.match(body.error.message, /supera el máximo de 65536 bytes/);
});
