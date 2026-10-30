import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { despertar } from "../lib/despertador";
import { crearTemporizadorDeSondeo, VENTANA_DESPIERTA_MS } from "./temporizadorDeSondeo";

// El ritmo de los workers que sondean la base (ancho de banda, 2026-10-30):
// timers simulados, así cada espera se mide en milisegundos exactos.

let ahora = 0;

beforeEach(() => {
  ahora = 0;
  mock.timers.enable({ apis: ["setTimeout"] });
});

afterEach(() => {
  mock.timers.reset();
});

function avanzar(ms: number) {
  ahora += ms;
  mock.timers.tick(ms);
}

function crear(pasadas: { n: number }) {
  return crearTemporizadorDeSondeo({
    cola: "outbox",
    minimoMs: 1_000,
    maximoMs: 8_000,
    pasada: () => {
      pasadas.n++;
    },
    ahora: () => ahora,
  });
}

// Cuánto tarda en llegar la próxima pasada, en pasos de 1 s.
function esperaHastaLaPasada(pasadas: { n: number }): number {
  const antes = pasadas.n;
  for (let ms = 1_000; ms <= 120_000; ms += 1_000) {
    avanzar(1_000);
    if (pasadas.n > antes) return ms;
  }
  throw new Error("no hubo pasada");
}

test("sin trabajo, la espera se duplica hasta el tope; con trabajo, vuelve al mínimo", () => {
  const pasadas = { n: 0 };
  const reloj = crear(pasadas);
  reloj.arrancar(1_000);
  assert.equal(esperaHastaLaPasada(pasadas), 1_000);

  const esperas: number[] = [];
  for (let i = 0; i < 4; i++) {
    reloj.programar(false);
    esperas.push(esperaHastaLaPasada(pasadas));
  }
  assert.deepEqual(esperas, [2_000, 4_000, 8_000, 8_000]);

  reloj.programar(true);
  assert.equal(esperaHastaLaPasada(pasadas), 1_000);
  reloj.detener();
});

test("despertar con el worker esperando: la pasada va en el acto", () => {
  const pasadas = { n: 0 };
  const reloj = crear(pasadas);
  reloj.arrancar(60_000);
  despertar("outbox");
  mock.timers.tick(0);
  assert.equal(pasadas.n, 1);
  // Y no queda la pasada vieja de los 60 s agendada aparte.
  reloj.programar(true);
  avanzar(1_000);
  assert.equal(pasadas.n, 2);
  reloj.detener();
});

test("despertar con una pasada en curso: la siguiente va sin esperar", () => {
  const pasadas = { n: 0 };
  const reloj = crear(pasadas);
  reloj.arrancar(0);
  mock.timers.tick(0);
  assert.equal(pasadas.n, 1);

  despertar("outbox");
  mock.timers.tick(0);
  assert.equal(pasadas.n, 1, "no arranca otra pasada encima de la que corre");

  reloj.programar(false);
  mock.timers.tick(0);
  assert.equal(pasadas.n, 2);
  reloj.detener();
});

test("después de despertar, queda a ritmo normal durante la ventana aunque no encuentre nada", () => {
  const pasadas = { n: 0 };
  const reloj = crear(pasadas);
  reloj.arrancar(60_000);
  despertar("outbox");
  mock.timers.tick(0);

  // El aviso llegó antes del COMMIT: las primeras pasadas no ven nada.
  let transcurrido = 0;
  while (transcurrido < VENTANA_DESPIERTA_MS - 1_000) {
    reloj.programar(false);
    const espera = esperaHastaLaPasada(pasadas);
    assert.equal(espera, 1_000);
    transcurrido += espera;
  }

  // Pasada la ventana, vuelve a espaciar.
  reloj.programar(false);
  avanzar(1_000);
  reloj.programar(false);
  assert.equal(esperaHastaLaPasada(pasadas), 2_000);
  reloj.detener();
});

test("detener() cancela la próxima pasada y deja de escuchar el despertador", () => {
  const pasadas = { n: 0 };
  const reloj = crear(pasadas);
  reloj.arrancar(1_000);
  reloj.detener();
  despertar("outbox");
  avanzar(120_000);
  assert.equal(pasadas.n, 0);
});
