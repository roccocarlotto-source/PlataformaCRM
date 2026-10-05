import assert from "node:assert/strict";
import { test } from "node:test";
import { crearMonitorDeLaKey, estadoSegunElSaldo } from "./llmKeyBalance.service";

// ---------------------------------------------------------------------------
// FABLE-G-10 (docs-privados/auditoria-2026-10-05-FABLE.md, local): la alerta
// de saldo de la key del proveedor de LLM. Sin red: el fetch es un doble.
// ---------------------------------------------------------------------------

function fetchConSaldo(saldos: unknown[]) {
  const pedidos: { url: string; auth: string }[] = [];
  const fetch = (url: string, init: RequestInit) => {
    pedidos.push({ url, auth: (init.headers as Record<string, string>).Authorization });
    const siguiente = saldos.shift();
    if (siguiente instanceof Error) {
      return Promise.reject(siguiente);
    }
    return Promise.resolve(
      new Response(JSON.stringify({ data: { limit: 10, limit_remaining: siguiente } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  };
  return { fetch, pedidos };
}

const BASE = { apiKey: "sk-or-prueba", baseUrl: "https://openrouter.ai/api/v1/", umbralUsd: 2 };

test("estadoSegunElSaldo: por debajo del umbral es saldo-bajo; sin límite no hay nada que vigilar", () => {
  assert.equal(estadoSegunElSaldo(6.7, 2), "ok");
  assert.equal(estadoSegunElSaldo(2, 2), "ok");
  assert.equal(estadoSegunElSaldo(1.71, 2), "saldo-bajo");
  assert.equal(estadoSegunElSaldo(0, 2), "saldo-bajo");
  assert.equal(estadoSegunElSaldo(null, 2), "sin-limite");
  assert.equal(estadoSegunElSaldo(undefined, 2), "sin-limite");
  assert.equal(estadoSegunElSaldo("1.71", 2), "desconocido");
});

test("la primera consulta no espera a OpenRouter: responde desconocido y lee en segundo plano", async () => {
  const { fetch, pedidos } = fetchConSaldo([1.71]);
  const monitor = crearMonitorDeLaKey({ ...BASE, fetch });

  assert.equal(monitor.estado(), "desconocido");
  await monitor.enCurso();

  assert.equal(monitor.estado(), "saldo-bajo");
  assert.deepEqual(pedidos, [
    { url: "https://openrouter.ai/api/v1/key", auth: "Bearer sk-or-prueba" },
  ]);
});

test("la lectura se guarda: pedir el estado muchas veces no vuelve a consultar hasta que vence", async () => {
  let reloj = 1_000_000;
  const { fetch, pedidos } = fetchConSaldo([6.7, 1.2]);
  const monitor = crearMonitorDeLaKey({ ...BASE, fetch, ahora: () => reloj });

  monitor.estado();
  await monitor.enCurso();
  for (let i = 0; i < 20; i++) {
    assert.equal(monitor.estado(), "ok");
  }
  assert.equal(pedidos.length, 1);

  // Pasados los 10 minutos se vuelve a leer, y el saldo bajó.
  reloj += 10 * 60_000 + 1;
  assert.equal(monitor.estado(), "ok", "mientras lee, responde lo último que supo");
  await monitor.enCurso();
  assert.equal(monitor.estado(), "saldo-bajo");
  assert.equal(pedidos.length, 2);
});

test("si OpenRouter no responde, queda desconocido y se reintenta al minuto, no en cada pedido", async () => {
  let reloj = 1_000_000;
  const { fetch, pedidos } = fetchConSaldo([new Error("sin red"), 5]);
  const monitor = crearMonitorDeLaKey({ ...BASE, fetch, ahora: () => reloj });

  monitor.estado();
  await monitor.enCurso();
  assert.equal(monitor.estado(), "desconocido");
  assert.equal(pedidos.length, 1);

  reloj += 60_000 + 1;
  monitor.estado();
  await monitor.enCurso();
  assert.equal(monitor.estado(), "ok");
  assert.equal(pedidos.length, 2);
});

test("sin key, o con el umbral en 0, no se consulta nada", () => {
  const { fetch, pedidos } = fetchConSaldo([1]);
  assert.equal(
    crearMonitorDeLaKey({ ...BASE, apiKey: undefined, fetch }).estado(),
    "no-configurada",
  );
  assert.equal(crearMonitorDeLaKey({ ...BASE, umbralUsd: 0, fetch }).estado(), "no-configurada");
  assert.equal(pedidos.length, 0);
});
