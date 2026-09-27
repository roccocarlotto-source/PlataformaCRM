import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { prisma } from "../lib/prisma";
import { AppError } from "../utils/AppError";
import { closeConversation } from "./conversation.service";

// ---------------------------------------------------------------------------
// closeConversation — el cierre manual (ítem 168), sin base.
//
// Se reemplaza `prisma.conversation` por uno en memoria, mismo criterio que
// baseDeContactoFalsa en contact.service.test.ts. Lo que se verifica es la
// DECISIÓN del service: 404 antes de escribir, idempotencia, y que devuelve la
// conversación releída. Que el WHERE del CAS filtre de verdad en Postgres lo
// cubre conversation.controller.integration-test.ts.
// ---------------------------------------------------------------------------

const ORG = "org-a";

function conversacionesFalsas(estado: { status: string } | null) {
  const escrituras: unknown[] = [];
  mock.property(prisma as unknown as Record<string, unknown>, "conversation", {
    findFirst: async () => (estado ? { id: "conv-1", organizationId: ORG, ...estado } : null),
    updateMany: async (args: { data: { status: string } }) => {
      escrituras.push(args);
      // Mismo efecto que el CAS: solo cambia si no estaba cerrada.
      if (estado && estado.status !== "CLOSED") {
        estado.status = args.data.status;
        return { count: 1 };
      }
      return { count: 0 };
    },
  });
  return { escrituras };
}

afterEach(() => mock.restoreAll());

test("cierra una abierta y devuelve la conversación releída, ya CLOSED", async () => {
  const { escrituras } = conversacionesFalsas({ status: "ACTIVE" });

  const result = await closeConversation(ORG, "conv-1");

  assert.equal(result.status, "CLOSED");
  assert.equal(escrituras.length, 1);
});

test("cerrar una ya cerrada NO es un error: devuelve el estado actual", async () => {
  conversacionesFalsas({ status: "CLOSED" });

  const result = await closeConversation(ORG, "conv-1");

  assert.equal(result.status, "CLOSED");
});

test("una conversación inexistente (u otra organización) es 404 y no escribe nada", async () => {
  const { escrituras } = conversacionesFalsas(null);

  await assert.rejects(
    () => closeConversation(ORG, "conv-1"),
    (err: unknown) => err instanceof AppError && err.statusCode === 404,
  );
  assert.equal(escrituras.length, 0);
});
