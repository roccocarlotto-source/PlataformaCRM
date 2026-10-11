import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { prisma } from "../lib/prisma";
import { AppError } from "../utils/AppError";
import { deleteBranch } from "./branch.service";

// ---------------------------------------------------------------------------
// deleteBranch — los RESTRICT de los ítems 167 y 168 (C-03 de la auditoría),
// sin base.
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
  | "conversation"
  | "booking"
  | "googleCalendarConnection";

function baseFalsa(conteos: Partial<Record<Modelo, number>> = {}, existe = true) {
  const borrados: unknown[] = [];
  const wheres: Partial<Record<Modelo, unknown>> = {};
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
        "conversation",
        "booking",
        "googleCalendarConnection",
      ] as Modelo[]
    ).map((m) => [
      m,
      {
        count: async (args: { where: unknown }) => {
          wheres[m] = args.where;
          return conteos[m] ?? 0;
        },
      },
    ]),
  );
  const branch = {
    findFirst: async () => (existe ? sucursal : null),
    updateMany: async (args: unknown) => {
      borrados.push(args);
      return { count: 1 };
    },
  };
  const tx = { ...modelos, branch, $queryRaw: async () => [{ id: BRANCH }] };

  mock.property(prisma as unknown as Record<string, unknown>, "branch", branch);
  mock.method(prisma, "$transaction", (async (fn: (t: unknown) => Promise<unknown>) =>
    fn(tx)) as never);
  return { borrados, wheres };
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
    modelo: "conversation",
    mensaje:
      "No se puede eliminar una sucursal que tiene conversaciones abiertas. Cerralas primero desde la bandeja.",
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

// Ítem 168: lo que bloquea es una conversación ABIERTA de ESTA organización.
// Una CLOSED no entra en el conteo — es la condición para que el RESTRICT no
// bloquee para siempre a toda sucursal que alguna vez atendió.
test("el conteo de conversaciones es solo de las abiertas, de la sucursal y de la organización", async () => {
  const { wheres } = baseFalsa();
  await deleteBranch(ORG, BRANCH);
  assert.deepEqual(wheres.conversation, {
    branchId: BRANCH,
    organizationId: ORG,
    status: { in: ["ACTIVE", "TRANSFERRED_TO_HUMAN"] },
  });
});

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

// ---------------------------------------------------------------------------
// Los textos por rubro (docs/rubros.md §15). Una automotora —con el default o
// diciéndolo— recibe los de siempre, byte por byte; una clínica, los suyos.
// La lógica es la misma: solo cambia el mensaje.
// ---------------------------------------------------------------------------

const CASOS_POR_RUBRO: { modelo: Modelo; automotora: string; clinica: string }[] = [
  {
    modelo: "resource",
    automotora:
      "No se puede eliminar una sucursal que tiene recursos activos. Eliminá primero sus recursos.",
    clinica:
      "No se puede eliminar una sede que tiene profesionales activos. Eliminá primero sus profesionales.",
  },
  {
    modelo: "serviceType",
    automotora:
      "No se puede eliminar una sucursal que tiene servicios activos. Eliminá primero sus servicios.",
    clinica:
      "No se puede eliminar una sede que tiene prestaciones activas. Eliminá primero sus prestaciones.",
  },
  {
    modelo: "qrCode",
    automotora: "No se puede eliminar una sucursal que tiene QRs activos. Eliminá primero sus QRs.",
    clinica: "No se puede eliminar una sede que tiene QRs activos. Eliminá primero sus QRs.",
  },
  ...CASOS.map(({ modelo, mensaje }) => ({
    modelo,
    automotora: mensaje,
    clinica: {
      agent: "No se puede eliminar una sede que tiene agentes. Eliminá primero sus agentes.",
      vehicle:
        "No se puede eliminar una sede que tiene vehículos en stock. Eliminá primero sus vehículos o pasalos a otra sede.",
      knowledgeBaseEntry:
        "No se puede eliminar una sede que tiene entradas en la base de conocimiento. Eliminá primero sus entradas.",
      conversation:
        "No se puede eliminar una sede que tiene conversaciones abiertas. Cerralas primero desde la bandeja.",
      booking: "No se puede eliminar una sede que tiene turnos confirmados. Cancelalos primero.",
    }[modelo as "agent" | "vehicle" | "knowledgeBaseEntry" | "conversation" | "booking"],
  })),
  {
    modelo: "googleCalendarConnection",
    automotora:
      "No se puede eliminar una sucursal que todavía tiene Google Calendar conectado, aunque la conexión esté en error. Desconectalo primero.",
    clinica:
      "No se puede eliminar una sede que todavía tiene Google Calendar conectado, aunque la conexión esté en error. Desconectalo primero.",
  },
];

for (const { modelo, automotora, clinica } of CASOS_POR_RUBRO) {
  for (const [industry, mensaje] of [
    ["AUTOMOTORA", automotora],
    ["CLINICA", clinica],
  ] as const) {
    test(`deleteBranch de una ${industry} con ${modelo} vivos: 400 con el texto del rubro, y no borra`, async () => {
      const { borrados } = baseFalsa({ [modelo]: 1 });
      const err = await capturar(() => deleteBranch(ORG, BRANCH, industry));
      assert.ok(err instanceof AppError, `debe ser AppError. Fue: ${String(err)}`);
      assert.equal(err.statusCode, 400);
      assert.equal(err.message, mensaje);
      assert.equal(borrados.length, 0);
    });
  }
}

test("deleteBranch sin el rubro usa los textos de la automotora", async () => {
  baseFalsa({ resource: 1 });
  const err = await capturar(() => deleteBranch(ORG, BRANCH));
  assert.ok(err instanceof AppError);
  assert.equal(
    err.message,
    "No se puede eliminar una sucursal que tiene recursos activos. Eliminá primero sus recursos.",
  );
});

test("deleteBranch de una sucursal que no existe: 404 con el texto del rubro", async () => {
  for (const [industry, mensaje] of [
    [undefined, "Sucursal no encontrada"],
    ["AUTOMOTORA", "Sucursal no encontrada"],
    ["CLINICA", "Sede no encontrada"],
  ] as const) {
    const { borrados } = baseFalsa({}, false);
    const err = await capturar(() => deleteBranch(ORG, BRANCH, industry));
    assert.ok(err instanceof AppError);
    assert.equal(err.statusCode, 404);
    assert.equal(err.message, mensaje);
    assert.equal(borrados.length, 0);
    mock.restoreAll();
  }
});

test("una clínica sin dependientes vivos borra la sede igual que una automotora", async () => {
  const { borrados } = baseFalsa();
  await deleteBranch(ORG, BRANCH, "CLINICA");
  assert.equal(borrados.length, 1);
});
