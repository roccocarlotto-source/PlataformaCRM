import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { crearShutdown, type DependenciasDeShutdown } from "./shutdown";

// ---------------------------------------------------------------------------
// La orquestación del apagado (M-12), con dobles y con el reloj controlado —
// sin process.exit, sin señales, sin base, sin red. El setTimeout del tope se
// avanza a mano con mock.timers, así el caso "algo no cierra nunca" se prueba
// en milisegundos y no esperando de verdad.
// ---------------------------------------------------------------------------

const TIMEOUT_MS = 8_000;

interface Doble {
  deps: DependenciasDeShutdown;
  marcas: string[];
  salidas: number[];
}

// Cada dependencia falsa deja una marca al ser INVOCADA y otra al RESOLVER,
// para poder afirmar el orden real y no solo que se llamaron.
function armarDoble(
  sobrescribir: Partial<
    Pick<DependenciasDeShutdown, "cerrarServidor" | "detenerWorkers" | "desconectarPrisma">
  > = {},
): Doble {
  const marcas: string[] = [];
  const salidas: number[] = [];

  const paso = (nombre: string) => async () => {
    marcas.push(`${nombre}:llamado`);
    await Promise.resolve();
    marcas.push(`${nombre}:resuelto`);
  };

  const deps: DependenciasDeShutdown = {
    cerrarServidor: paso("servidor"),
    detenerWorkers: paso("workers"),
    desconectarPrisma: paso("prisma"),
    salir: (codigo) => {
      marcas.push(`salir:${codigo}`);
      salidas.push(codigo);
    },
    logger: { info: () => undefined, error: () => undefined },
    timeoutMs: TIMEOUT_MS,
    ...sobrescribir,
  };

  return { deps, marcas, salidas };
}

// Deja correr las microtareas pendientes sin avanzar el reloj falso.
async function drenarMicrotareas(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

const nunca = () => new Promise<void>(() => undefined);

beforeEach(() => {
  mock.timers.enable({ apis: ["setTimeout"] });
});

afterEach(() => {
  mock.timers.reset();
});

test("detiene workers y cierra el servidor, y RECIÉN cuando ambos resolvieron desconecta Prisma y sale con 0", async () => {
  const { deps, marcas, salidas } = armarDoble();

  await crearShutdown(deps)("SIGTERM");

  assert.deepEqual(salidas, [0]);
  // Los dos primeros arrancan juntos (en paralelo), Prisma no empieza hasta
  // que los dos terminaron, y la salida es lo último.
  assert.deepEqual(marcas.slice(0, 2), ["workers:llamado", "servidor:llamado"]);
  assert.ok(marcas.indexOf("prisma:llamado") > marcas.indexOf("workers:resuelto"));
  assert.ok(marcas.indexOf("prisma:llamado") > marcas.indexOf("servidor:resuelto"));
  assert.equal(marcas.at(-2), "prisma:resuelto");
  assert.equal(marcas.at(-1), "salir:0");
});

test("si detenerWorkers no resuelve nunca, al vencer el tope sale con 1 — y sin tocar Prisma", async () => {
  const { deps, marcas, salidas } = armarDoble({ detenerWorkers: nunca });

  const pendiente = crearShutdown(deps)("SIGTERM");
  await drenarMicrotareas();
  assert.deepEqual(salidas, [], "antes del tope no sale");

  mock.timers.tick(TIMEOUT_MS - 1);
  assert.deepEqual(salidas, [], "un milisegundo antes del tope todavía espera");

  mock.timers.tick(1);
  assert.deepEqual(salidas, [1]);
  assert.ok(!marcas.includes("prisma:llamado"), "Prisma no se desconecta a mitad de un worker");

  // La promesa del shutdown queda colgada a propósito (en producción salir()
  // es process.exit y no vuelve); no se espera.
  void pendiente;
});

test("si cerrarServidor no resuelve nunca (keep-alive eterno), al vencer el tope sale con 1", async () => {
  const { deps, salidas } = armarDoble({ cerrarServidor: nunca });

  void crearShutdown(deps)("SIGTERM");
  await drenarMicrotareas();
  mock.timers.tick(TIMEOUT_MS);

  assert.deepEqual(salidas, [1]);
});

test("una segunda llamada mientras la primera sigue en curso no repite nada (idempotente)", async () => {
  let resolverWorkers: () => void = () => undefined;
  const { deps, marcas, salidas } = armarDoble({
    detenerWorkers: () =>
      new Promise<void>((resolve) => {
        marcas.push("workers:llamado");
        resolverWorkers = () => {
          marcas.push("workers:resuelto");
          resolve();
        };
      }),
  });
  const shutdown = crearShutdown(deps);

  const primera = shutdown("SIGTERM");
  await drenarMicrotareas();
  const segunda = shutdown("SIGINT");
  const tercera = shutdown("unhandledRejection");
  await Promise.all([segunda, tercera]);

  assert.equal(marcas.filter((m) => m === "workers:llamado").length, 1);
  assert.equal(marcas.filter((m) => m === "servidor:llamado").length, 1);
  assert.deepEqual(salidas, [], "las llamadas repetidas no salen por su cuenta");

  resolverWorkers();
  await primera;

  assert.equal(marcas.filter((m) => m === "prisma:llamado").length, 1);
  assert.deepEqual(salidas, [0]);
});

test("si desconectarPrisma rechaza, sale con 1 igual — no cuelga ni lanza sin atrapar", async () => {
  const errores: unknown[] = [];
  const { deps, salidas } = armarDoble({
    desconectarPrisma: () => Promise.reject(new Error("pool cerrado")),
  });
  deps.logger = { info: () => undefined, error: (obj) => errores.push(obj) };

  await crearShutdown(deps)("SIGTERM");

  assert.deepEqual(salidas, [1]);
  assert.equal(errores.length, 1);
});

test("si detenerWorkers rechaza, sale con 1 sin desconectar Prisma a medias", async () => {
  const { deps, marcas, salidas } = armarDoble({
    detenerWorkers: () => Promise.reject(new Error("tick reventó")),
  });

  await crearShutdown(deps)("SIGTERM");

  assert.deepEqual(salidas, [1]);
  assert.ok(!marcas.includes("prisma:llamado"));
});

test("cuando el apagado termina a tiempo, el tope no vuelve a salir después", async () => {
  const { deps, salidas } = armarDoble();

  await crearShutdown(deps)("SIGTERM");
  mock.timers.tick(TIMEOUT_MS * 2);

  assert.deepEqual(salidas, [0], "una sola salida, la del apagado normal");
});

test("el motivo queda en el log de inicio", async () => {
  const mensajes: string[] = [];
  const { deps } = armarDoble();
  deps.logger = { info: (obj) => mensajes.push(String(obj)), error: () => undefined };

  await crearShutdown(deps)("unhandledRejection");

  assert.ok(mensajes.some((m) => m.includes("unhandledRejection")));
});
