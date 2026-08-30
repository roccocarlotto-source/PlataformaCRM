import assert from "node:assert/strict";
import { test } from "node:test";
import { env } from "../config/env";
import { iniciarWorkerDeCanales } from "./googleCalendarChannelWorker";
import { iniciarWorkerDeIngesta } from "./ingestionWorker";
import { iniciarWorkerDeOutbox } from "./outboxWorker";

// ---------------------------------------------------------------------------
// M-12 (c) de docs/auditoria-2026-08-29.md: el stop que devuelve cada
// iniciarWorkerDe*() ESPERA a que el tick en curso termine. Es el escenario
// literal del hallazgo —SIGTERM mientras un handler está a mitad de camino—
// reproducido sin base, sin timers de valor fijo y sin carreras: la pasada del
// worker es una promesa que el test resuelve a mano, así que el orden de los
// eventos lo decide el test, no el scheduler.
//
// Los tres workers comparten el patrón y el bug, y por eso se prueban con la
// misma tabla: si alguno se desviara del patrón, este archivo lo vería.
// ---------------------------------------------------------------------------

type Iniciar = (opciones: { pollMs: number; pasada: () => Promise<void> }) => () => Promise<void>;

const WORKERS: { nombre: string; iniciar: Iniciar; prepararEntorno?: () => () => void }[] = [
  {
    nombre: "ingesta",
    iniciar: ({ pollMs, pasada }) =>
      iniciarWorkerDeIngesta({
        pollMs,
        drenar: async () => {
          await pasada();
          return { procesados: 0, fallidos: 0, pospuestos: 0 };
        },
      }),
  },
  {
    nombre: "outbox",
    iniciar: ({ pollMs, pasada }) =>
      iniciarWorkerDeOutbox({
        pollMs,
        drenar: async () => {
          await pasada();
          return { entregados: 0, reprogramados: 0, muertos: 0, pospuestos: 0 };
        },
      }),
  },
  {
    nombre: "canales",
    iniciar: ({ pollMs, pasada }) =>
      iniciarWorkerDeCanales({
        pollMs,
        renovar: async () => {
          await pasada();
          return { renovados: 0, fallidos: 0 };
        },
      }),
    // Sin GOOGLE_WEBHOOK_URL el worker de canales no arranca (y está bien que
    // no arranque): se le da una para este test y se restaura después.
    prepararEntorno: () => {
      const original = env.GOOGLE_WEBHOOK_URL;
      env.GOOGLE_WEBHOOK_URL = "https://ejemplo.test/api/webhooks/google-calendar";
      return () => {
        env.GOOGLE_WEBHOOK_URL = original;
      };
    },
  },
];

async function esperarHastaQue(condicion: () => boolean, descripcion: string): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (condicion()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`Se venció la espera: ${descripcion}`);
}

for (const worker of WORKERS) {
  test(`${worker.nombre}: detener() durante un tick en curso NO resuelve hasta que la pasada terminó`, async () => {
    const restaurar = worker.prepararEntorno?.();
    const eventos: string[] = [];
    let resolverPasada: () => void = () => undefined;
    const pasadaControlada = new Promise<void>((resolve) => {
      resolverPasada = () => {
        eventos.push("pasada-terminada");
        resolve();
      };
    });

    try {
      const detener = worker.iniciar({
        pollMs: 0,
        pasada: async () => {
          eventos.push("tick-en-pasada");
          await pasadaControlada;
        },
      });

      await esperarHastaQue(() => eventos.includes("tick-en-pasada"), "el primer tick arranca");

      const detenido = detener();
      eventos.push("stop-llamado");

      // Un turno del event loop entero sin que el stop resuelva: la pasada
      // sigue colgada y el stop tiene que seguir esperando.
      await new Promise((r) => setTimeout(r, 20));
      assert.deepEqual(eventos, ["tick-en-pasada", "stop-llamado"]);

      resolverPasada();
      await detenido;
      eventos.push("stop-resuelto");

      assert.deepEqual(eventos, [
        "tick-en-pasada",
        "stop-llamado",
        "pasada-terminada",
        "stop-resuelto",
      ]);
    } finally {
      restaurar?.();
    }
  });

  test(`${worker.nombre}: después de detener() no se agenda ningún tick más`, async () => {
    const restaurar = worker.prepararEntorno?.();
    let pasadas = 0;
    let resolverPasada: () => void = () => undefined;
    const pasadaControlada = new Promise<void>((resolve) => {
      resolverPasada = resolve;
    });

    try {
      const detener = worker.iniciar({
        pollMs: 0,
        pasada: async () => {
          pasadas++;
          await pasadaControlada;
        },
      });

      await esperarHastaQue(() => pasadas === 1, "el primer tick arranca");
      const detenido = detener();
      resolverPasada();
      await detenido;

      // Con pollMs 0, si el bucle siguiera vivo ya habría corrido otra pasada.
      await new Promise((r) => setTimeout(r, 30));
      assert.equal(pasadas, 1);
    } finally {
      restaurar?.();
    }
  });

  test(`${worker.nombre}: detener() sin ningún tick en curso resuelve de inmediato y cancela el próximo`, async () => {
    const restaurar = worker.prepararEntorno?.();
    let pasadas = 0;

    try {
      const detener = worker.iniciar({
        pollMs: 60_000,
        pasada: async () => {
          pasadas++;
        },
      });

      // El de canales agenda su primera pasada a los 0 ms; se le da un turno
      // para que corra y termine, así el stop no encuentra nada en curso.
      await new Promise((r) => setTimeout(r, 20));
      const antes = pasadas;

      await detener();

      await new Promise((r) => setTimeout(r, 30));
      assert.equal(pasadas, antes, "ninguna pasada nueva después de detener");
    } finally {
      restaurar?.();
    }
  });
}

test("un worker deshabilitado devuelve un stop que también es una promesa", async () => {
  const original = env.INGEST_WORKER_ENABLED;
  env.INGEST_WORKER_ENABLED = false;
  try {
    const detener = iniciarWorkerDeIngesta();
    const resultado = detener();
    assert.ok(resultado instanceof Promise);
    await resultado;
  } finally {
    env.INGEST_WORKER_ENABLED = original;
  }
});
