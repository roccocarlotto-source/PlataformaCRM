import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { prisma } from "../lib/prisma";
import { AppError } from "../utils/AppError";
import { deleteBranch } from "./branch.service";

// ---------------------------------------------------------------------------
// deleteBranch — los RESTRICT del ítem 167 (C-03 de la auditoría), sin base.
//
// Se reemplaza el cliente de Prisma por uno falso: `$transaction` corre el
// callback con un `tx` en memoria que responde cada conteo con lo que el test
// le pida. Lo que se verifica es la DECISIÓN del service —qué conteo bloquea,
// con qué mensaje, y que el soft delete no llega a correr—. Que el lock
// serialice de verdad y que Postgres cuente esas filas lo cubre
// booking-config.integration-test.ts.
// ---------------------------------------------------------------------------

const ORG = "org-a";
const BRANCH = "branch-1";

type Modelo =
  | "resource"
  | "serviceType"
  | "qrCode"
  | "agent"
  | "vehicle"
  | "knowledgeBaseEntry"
  | "booking"
  | "googleCalendarConnection";

function baseFalsa(conteos: Partial<Record<Modelo, number>> = {}) {
  const borrados: unknown[] = [];
  const sucursal = { id: BRANCH, organizationId: ORG };
  const modelos = Object.fromEntries(
    (
      [
        "resource",
        "serviceType",
        "qrCode",
        "agent",
        "vehicle",
        "knowledgeBaseEntry",
        "booking",
        "googleCalendarConnection",
      ] as Modelo[]
    ).map((m) => [m, { count: async () => conteos[m] ?? 0 }]),
  );
  const branch = {
    findFirst: async () => sucursal,
    updateMany: async (args: unknown) => {
      borrados.push(args);
      return { count: 1 };
    },
  };
  const tx = { ...modelos, branch, $queryRaw: async () => [{ id: BRANCH }] };

  mock.property(prisma as unknown as Record<string, unknown>, "branch", branch);
  mock.method(prisma, "$transaction", (async (fn: (t: unknown) => Promise<unknown>) =>
    fn(tx)) as never);
  return { borrados };
}

afterEach(() => mock.restoreAll());

async function capturar(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
  } catch (err) {
    return err;
  }
  assert.fail("se esperaba un error");
}

const CASOS: { modelo: Modelo; mensaje: string }[] = [
  {
    modelo: "agent",
    mensaje: "No se puede eliminar una sucursal que tiene agentes. Eliminá primero sus agentes.",
  },
  {
    modelo: "vehicle",
    mensaje:
      "No se puede eliminar una sucursal que tiene vehículos en stock. Eliminá primero sus vehículos o pasalos a otra sucursal.",
  },
  {
    modelo: "knowledgeBaseEntry",
    mensaje:
      "No se puede eliminar una sucursal que tiene entradas en la base de conocimiento. Eliminá primero sus entradas.",
  },
  {
    modelo: "booking",
    mensaje:
      "No se puede eliminar una sucursal que tiene reservas confirmadas. Cancelalas primero.",
  },
];

for (const { modelo, mensaje } of CASOS) {
  test(`deleteBranch rechaza con 400 si hay ${modelo} vivos, y no borra`, async () => {
    const { borrados } = baseFalsa({ [modelo]: 1 });
    const err = await capturar(() => deleteBranch(ORG, BRANCH));
    assert.ok(err instanceof AppError, `debe ser AppError. Fue: ${String(err)}`);
    assert.equal(err.statusCode, 400);
    assert.equal(err.message, mensaje);
    assert.equal(borrados.length, 0);
  });
}

test("deleteBranch sin ningún dependiente vivo borra la sucursal", async () => {
  const { borrados } = baseFalsa();
  await deleteBranch(ORG, BRANCH);
  assert.equal(borrados.length, 1);
});

// El orden decide qué mensaje ve el ADMIN: lo que hay que limpiar a mano va
// antes que Google Calendar, que se destraba con un click.
test("con agentes y Google Calendar conectado, el mensaje es el de agentes", async () => {
  baseFalsa({ agent: 1, googleCalendarConnection: 1 });
  const err = await capturar(() => deleteBranch(ORG, BRANCH));
  assert.ok(err instanceof AppError);
  assert.match(err.message, /agentes/);
});
