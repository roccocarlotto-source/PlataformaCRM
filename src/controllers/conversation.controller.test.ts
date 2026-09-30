import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { AppError } from "../utils/AppError";
import { closeConversationHandler } from "./conversation.controller";

// ---------------------------------------------------------------------------
// closeConversationHandler — el borde del cierre manual (ítem 168), sin HTTP
// ni base: se llama al handler con un req/res a mano y `prisma.conversation`
// en memoria. Lo que se verifica es el borde: el id se valida antes de tocar
// nada, el organizationId sale del JWT y el error sube tal cual al
// errorHandler. La ruta y el aislamiento real, por HTTP, los cubre
// conversation.controller.integration-test.ts.
// ---------------------------------------------------------------------------

const ID = "7a6f1c1e-7c1a-4b2a-9d53-0d6b7e0a1f01";

interface Resultado {
  status?: number;
  body?: unknown;
  error?: unknown;
}

// asyncHandler no devuelve la promesa del handler: se espera a que termine por
// donde termina de verdad, que es res.json() o next(err).
function llamar(id: string): Promise<Resultado> {
  return new Promise((resolve) => {
    const resultado: Resultado = {};
    const req = {
      params: { id },
      auth: { organizationId: "org-a", userId: "user-1" },
    } as unknown as Request;
    const res = {
      status(code: number) {
        resultado.status = code;
        return this;
      },
      json(body: unknown) {
        resultado.body = body;
        resolve(resultado);
        return this;
      },
    } as unknown as Response;
    closeConversationHandler(req, res, (err?: unknown) => {
      resultado.error = err;
      resolve(resultado);
    });
  });
}

afterEach(() => mock.restoreAll());

test("responde 200 con la conversación cerrada, scopeada por la organización del JWT", async () => {
  const wheres: { organizationId?: string }[] = [];
  let status = "ACTIVE";
  // B-16: el cierre va en una transacción junto con la cancelación de los jobs
  // pendientes; acá la "transacción" es el mismo prisma falso.
  mock.method(prisma, "$transaction", (async (fn: (tx: unknown) => Promise<unknown>) =>
    fn(prisma)) as unknown as typeof prisma.$transaction);
  mock.property(prisma as unknown as Record<string, unknown>, "agentInboundJob", {
    updateMany: async (args: { where: { organizationId?: string } }) => {
      wheres.push(args.where);
      return { count: 0 };
    },
  });
  mock.property(prisma as unknown as Record<string, unknown>, "conversation", {
    findFirst: async (args: { where: { organizationId?: string } }) => {
      wheres.push(args.where);
      return { id: ID, organizationId: "org-a", status, messages: [] };
    },
    updateMany: async (args: { where: { organizationId?: string } }) => {
      wheres.push(args.where);
      status = "CLOSED";
      return { count: 1 };
    },
  });

  const resultado = await llamar(ID);

  assert.equal(resultado.error, undefined);
  assert.equal(resultado.status, 200);
  assert.equal((resultado.body as { status: string }).status, "CLOSED");
  assert.ok(wheres.length > 0);
  for (const where of wheres) {
    assert.equal(where.organizationId, "org-a");
  }
});

test("un id que no es UUID es 400 y no llega a la base", async () => {
  let consultas = 0;
  mock.property(prisma as unknown as Record<string, unknown>, "conversation", {
    findFirst: async () => {
      consultas += 1;
      return null;
    },
  });

  const resultado = await llamar("no-es-uuid");

  assert.ok(resultado.error instanceof AppError);
  assert.equal(resultado.error.statusCode, 400);
  assert.equal(resultado.status, undefined);
  assert.equal(consultas, 0);
});

test("el 404 del service sube tal cual al errorHandler", async () => {
  mock.property(prisma as unknown as Record<string, unknown>, "conversation", {
    findFirst: async () => null,
  });

  const resultado = await llamar(ID);

  assert.ok(resultado.error instanceof AppError);
  assert.equal(resultado.error.statusCode, 404);
  assert.equal(resultado.status, undefined);
});
