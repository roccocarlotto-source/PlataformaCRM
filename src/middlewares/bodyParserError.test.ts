import assert from "node:assert/strict";
import { test } from "node:test";
import type { AddressInfo } from "node:net";
import express from "express";
import {
  clasificarErrorDeBodyParser,
  jsonParser,
  MAX_ELEMENTOS_DE_LISTA_POR_PEDIDO,
  superaElTopeDeListas,
} from "./bodyParserError";
import { errorHandler } from "./errorHandler";

// M-11 (a) de docs-privados/auditoria-2026-08-29.md (local, no está en GitHub) — la clasificación compartida entre
// el parser de la ingesta y los globales. Sin mensaje ni status: eso lo decide
// cada call site.

test("entity.too.large se clasifica como demasiado_grande", () => {
  assert.equal(clasificarErrorDeBodyParser({ type: "entity.too.large" }), "demasiado_grande");
});

test("entity.parse.failed se clasifica como cuerpo_invalido", () => {
  assert.equal(clasificarErrorDeBodyParser({ type: "entity.parse.failed" }), "cuerpo_invalido");
});

test("charset.unsupported y encoding.unsupported se clasifican como codificacion_no_soportada", () => {
  assert.equal(
    clasificarErrorDeBodyParser({ type: "charset.unsupported" }),
    "codificacion_no_soportada",
  );
  assert.equal(
    clasificarErrorDeBodyParser({ type: "encoding.unsupported" }),
    "codificacion_no_soportada",
  );
});

// Un type desconocido NO se clasifica: inventarle un 4xx a un error que no
// entendemos sería decirle al cliente que la culpa es suya sin saberlo.
test("un type desconocido, un error sin type, null y undefined devuelven undefined", () => {
  assert.equal(clasificarErrorDeBodyParser({ type: "request.aborted" }), undefined);
  assert.equal(clasificarErrorDeBodyParser({ type: "stream.encoding.set" }), undefined);
  assert.equal(clasificarErrorDeBodyParser(new Error("sin type")), undefined);
  assert.equal(clasificarErrorDeBodyParser(null), undefined);
  assert.equal(clasificarErrorDeBodyParser(undefined), undefined);
});

// ---------------------------------------------------------------------------
// Límite de tamaño de las listas de un pedido JSON.
// ---------------------------------------------------------------------------

test("superaElTopeDeListas: hasta el tope pasa, uno más no", () => {
  assert.equal(superaElTopeDeListas(new Array(MAX_ELEMENTOS_DE_LISTA_POR_PEDIDO).fill(1)), false);
  assert.equal(
    superaElTopeDeListas(new Array(MAX_ELEMENTOS_DE_LISTA_POR_PEDIDO + 1).fill(1)),
    true,
  );
});

test("superaElTopeDeListas cuenta el total de todas las listas, anidadas incluidas", () => {
  const mitad = MAX_ELEMENTOS_DE_LISTA_POR_PEDIDO / 2;
  // Dos listas de 1000 dentro de objetos: 2000 exactos, pasa.
  assert.equal(
    superaElTopeDeListas({ a: new Array(mitad).fill({}), b: { c: new Array(mitad).fill(0) } }),
    false,
  );
  // Muchas listas chicas que suman más que el tope: no se esquiva partiéndolas.
  const muchasChicas = Array.from({ length: 300 }, () => new Array(10).fill(0));
  assert.equal(superaElTopeDeListas({ items: muchasChicas }), true);
});

test("superaElTopeDeListas no se ve afectado por escalares ni por objetos sin listas", () => {
  for (const valor of [null, undefined, 0, "texto", true, {}, { a: { b: { c: "d" } } }]) {
    assert.equal(superaElTopeDeListas(valor), false);
  }
});

test("superaElTopeDeListas recorre un anidamiento muy profundo sin agotar la pila", () => {
  let profundo: unknown = [];
  for (let i = 0; i < 100_000; i++) profundo = { x: profundo };
  assert.equal(superaElTopeDeListas(profundo), false);
});

function levantarAppConParserGlobal(): Promise<{ url: string; close: () => Promise<void> }> {
  const app = express();
  app.use(jsonParser);
  app.post("/eco", (req, res) => {
    res.status(200).json({ largo: (req.body as { items: unknown[] }).items.length });
  });
  app.use(errorHandler);
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${String(port)}`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

test("el parser global responde 400 a un pedido con 2001 elementos de lista y deja pasar 2000", async () => {
  const { url, close } = await levantarAppConParserGlobal();
  try {
    const mandar = (n: number) =>
      fetch(`${url}/eco`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: new Array(n).fill({}) }),
      });

    const pasa = await mandar(MAX_ELEMENTOS_DE_LISTA_POR_PEDIDO);
    assert.equal(pasa.status, 200);
    assert.deepEqual(await pasa.json(), { largo: MAX_ELEMENTOS_DE_LISTA_POR_PEDIDO });

    const corta = await mandar(MAX_ELEMENTOS_DE_LISTA_POR_PEDIDO + 1);
    assert.equal(corta.status, 400);
    const cuerpo = (await corta.json()) as { message?: string; error?: string };
    assert.match(JSON.stringify(cuerpo), /más de 2000 elementos/);
  } finally {
    await close();
  }
});
