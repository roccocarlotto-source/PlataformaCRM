import assert from "node:assert/strict";
import { test } from "node:test";
import { enParalelo } from "./enParalelo";

// F6 (PR "menos idas a la base"): paralelo, pero con el error del orden
// declarado, no el del primero que terminó.

function despues<T>(ms: number, valor: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(valor), ms));
}

function fallaDespues(ms: number, mensaje: string): Promise<never> {
  return new Promise((_, reject) => setTimeout(() => reject(new Error(mensaje)), ms));
}

test("F6: devuelve los valores en el orden declarado", async () => {
  const [a, b, c] = await enParalelo([despues(20, "a"), despues(1, 2), Promise.resolve(null)]);
  assert.deepEqual([a, b, c], ["a", 2, null]);
});

test("F6: corre en paralelo — el total es el de la más lenta, no la suma", async () => {
  const inicio = Date.now();
  await enParalelo([despues(60, 1), despues(60, 2), despues(60, 3)]);
  assert.ok(Date.now() - inicio < 150, "tres esperas de 60 ms en serie serían 180 ms");
});

test("F6: si fallan varias, relanza la PRIMERA EN EL ORDEN, aunque otra haya fallado antes", async () => {
  await assert.rejects(
    enParalelo([fallaDespues(40, "primera en el orden"), fallaDespues(1, "primera en el tiempo")]),
    /primera en el orden/,
  );
});

test("F6: espera a que terminen todas antes de rechazar", async () => {
  let termino = false;
  const lenta = despues(40, 1).then((v) => {
    termino = true;
    return v;
  });
  await assert.rejects(enParalelo([Promise.reject(new Error("x")), lenta]));
  assert.equal(termino, true);
});
