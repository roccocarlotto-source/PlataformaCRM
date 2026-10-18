import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { AppError } from "../utils/AppError";
import { YA_SE_ESTA_REINICIANDO } from "./modoDemo.service";
import {
  estadoDelReinicioDeDemo,
  FALLO_INESPERADO_DEL_REINICIO,
  iniciarReinicioDeDemo,
  type DepsDelReinicio,
  type ResultadoDelReinicioDeDemo,
} from "./reinicioDeDemo.service";

// El reinicio en segundo plano sin Postgres: `preparar` y su `ejecutar` son
// dobles, y cada test usa una organización distinta (el estado es del módulo).

const RESULTADO = {
  organizationId: "org",
  borrados: {},
  cargados: {},
} as unknown as ResultadoDelReinicioDeDemo;

function diferido<T>() {
  let resolver!: (valor: T) => void;
  let rechazar!: (err: unknown) => void;
  const promesa = new Promise<T>((res, rej) => {
    resolver = res;
    rechazar = rej;
  });
  return { promesa, resolver, rechazar };
}

function dobles() {
  const ejecucion = diferido<ResultadoDelReinicioDeDemo>();
  let preparados = 0;
  const deps: DepsDelReinicio = {
    preparar: () => {
      preparados += 1;
      return Promise.resolve(() => ejecucion.promesa);
    },
    ahora: () => new Date("2026-10-18T17:39:17.000Z"),
  };
  return { deps, ejecucion, preparados: () => preparados };
}

// Deja correr los .then del segundo plano.
const unaVuelta = () => new Promise((r) => setImmediate(r));

test("sin ningún reinicio, el estado es NINGUNO", () => {
  assert.deepEqual(estadoDelReinicioDeDemo(randomUUID()), { estado: "NINGUNO" });
});

test("arranca en REINICIANDO y queda LISTO con el resultado cuando termina", async () => {
  const id = randomUUID();
  const { deps, ejecucion } = dobles();

  const inicial = await iniciarReinicioDeDemo(id, {}, deps);
  assert.deepEqual(inicial, { estado: "REINICIANDO", iniciadoEn: "2026-10-18T17:39:17.000Z" });
  assert.equal(estadoDelReinicioDeDemo(id).estado, "REINICIANDO");

  ejecucion.resolver(RESULTADO);
  await unaVuelta();
  const final = estadoDelReinicioDeDemo(id);
  assert.equal(final.estado, "LISTO");
  assert.equal(final.estado === "LISTO" && final.resultado, RESULTADO);
});

test("un segundo reinicio mientras corre el primero es 409 y no prepara otro", async () => {
  const id = randomUUID();
  const { deps, preparados } = dobles();
  await iniciarReinicioDeDemo(id, {}, deps);

  await assert.rejects(iniciarReinicioDeDemo(id, {}, deps), (err: unknown) => {
    assert.ok(err instanceof AppError);
    assert.equal(err.statusCode, 409);
    assert.equal(err.message, YA_SE_ESTA_REINICIANDO);
    return true;
  });
  assert.equal(preparados(), 1);
});

test("dos POST seguidos sin esperar: solo uno arranca", async () => {
  const id = randomUUID();
  const { deps, preparados } = dobles();
  const resultados = await Promise.allSettled([
    iniciarReinicioDeDemo(id, {}, deps),
    iniciarReinicioDeDemo(id, {}, deps),
  ]);
  assert.deepEqual(resultados.map((r) => r.status).sort(), ["fulfilled", "rejected"]);
  assert.equal(preparados(), 1);
});

test("si la validación lo rechaza, lanza el mismo error y el estado queda como estaba", async () => {
  const id = randomUUID();
  const rechazo = new AppError("La regla del recordatorio de la demo está activa", 409);
  const deps: DepsDelReinicio = {
    preparar: () => Promise.reject(rechazo),
    ahora: () => new Date(),
  };
  await assert.rejects(iniciarReinicioDeDemo(id, {}, deps), rechazo);
  assert.deepEqual(estadoDelReinicioDeDemo(id), { estado: "NINGUNO" });

  // Con un LISTO anterior, sigue el LISTO.
  const ok = dobles();
  await iniciarReinicioDeDemo(id, {}, ok.deps);
  ok.ejecucion.resolver(RESULTADO);
  await unaVuelta();
  await assert.rejects(iniciarReinicioDeDemo(id, {}, deps), rechazo);
  assert.equal(estadoDelReinicioDeDemo(id).estado, "LISTO");
});

test("si falla a mitad con un error conocido, FALLO con ese mensaje", async () => {
  const id = randomUUID();
  const { deps, ejecucion } = dobles();
  await iniciarReinicioDeDemo(id, {}, deps);
  ejecucion.rechazar(new AppError("Al Taller Demo le falta configuración de ejemplo", 409));
  await unaVuelta();
  const estado = estadoDelReinicioDeDemo(id);
  assert.equal(estado.estado, "FALLO");
  assert.equal(
    estado.estado === "FALLO" && estado.mensaje,
    "Al Taller Demo le falta configuración de ejemplo",
  );
});

test("si falla a mitad con un error inesperado, FALLO con el mensaje genérico (sin el detalle interno)", async () => {
  const id = randomUUID();
  const { deps, ejecucion } = dobles();
  await iniciarReinicioDeDemo(id, {}, deps);
  ejecucion.rechazar(new Error("connection terminated unexpectedly"));
  await unaVuelta();
  const estado = estadoDelReinicioDeDemo(id);
  assert.equal(estado.estado === "FALLO" && estado.mensaje, FALLO_INESPERADO_DEL_REINICIO);
});

test("después de LISTO o FALLO se puede volver a reiniciar", async () => {
  const id = randomUUID();
  const primero = dobles();
  await iniciarReinicioDeDemo(id, {}, primero.deps);
  primero.ejecucion.rechazar(new Error("x"));
  await unaVuelta();

  const segundo = dobles();
  const estado = await iniciarReinicioDeDemo(id, {}, segundo.deps);
  assert.equal(estado.estado, "REINICIANDO");
  segundo.ejecucion.resolver(RESULTADO);
  await unaVuelta();
  assert.equal(estadoDelReinicioDeDemo(id).estado, "LISTO");
});
