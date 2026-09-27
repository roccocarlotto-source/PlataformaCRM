import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import {
  LARGO_DEL_SUFIJO,
  META_CONTACT_SOURCE,
  nombreGenerico,
  resolveMetaContact,
} from "./metaContact.service";

// ---------------------------------------------------------------------------
// metaContact.service.ts (ítem 171), SIN BASE. Prisma se reemplaza por dobles
// (mismo patrón que metaPageConnection.service.test.ts): $transaction corre
// el callback con un tx falso que registra cada escritura. Lo que se verifica
// es el buscar-o-crear: contacto nuevo (Contact + identidad en la MISMA
// transacción), contacto existente, contacto borrado que vuelve a escribir, y
// la carrera del P2002. Que el UNIQUE y el lock de verdad lo sostengan lo
// cubre metaWebhook.controller.integration-test.ts.
// ---------------------------------------------------------------------------

const ORG = "org-1";

afterEach(() => mock.restoreAll());

interface Escenario {
  // La identidad que ya existe (su contactId), o null.
  identidad?: string | null;
  // Si el contacto de esa identidad está vivo.
  contactoVivo?: boolean;
  // Si el create de la identidad choca con el UNIQUE, y quién ganó.
  choqueConGanador?: string | null;
}

function baseFalsa(escenario: Escenario) {
  const registro = {
    locks: 0,
    contactosCreados: [] as Record<string, unknown>[],
    identidadesCreadas: [] as Record<string, unknown>[],
    identidadesMovidas: [] as Record<string, unknown>[],
    transaccionesRevertidas: 0,
  };
  const identidad = escenario.identidad ?? null;

  const tx = {
    $queryRaw: async () => {
      registro.locks++;
      return [{ id: ORG }];
    },
    contactChannelIdentity: {
      findUnique: async () => (identidad ? { contactId: identidad } : null),
      create: async (args: { data: Record<string, unknown> }) => {
        if (escenario.choqueConGanador !== undefined) {
          throw new Prisma.PrismaClientKnownRequestError("unique", {
            code: "P2002",
            clientVersion: "test",
          });
        }
        registro.identidadesCreadas.push(args.data);
        return args.data;
      },
      update: async (args: Record<string, unknown>) => {
        registro.identidadesMovidas.push(args);
        return {};
      },
    },
    contact: {
      findFirst: async () => (escenario.contactoVivo ? { id: identidad } : null),
      create: async (args: { data: Record<string, unknown> }) => {
        registro.contactosCreados.push(args.data);
        return { id: "contacto-nuevo", ...args.data };
      },
    },
  };

  mock.method(prisma, "$transaction", (async (fn: (t: typeof tx) => Promise<unknown>) => {
    try {
      return await fn(tx);
    } catch (err) {
      registro.transaccionesRevertidas++;
      throw err;
    }
  }) as never);
  // La relectura después del P2002 corre FUERA de la transacción revertida.
  mock.property(prisma as unknown as Record<string, unknown>, "contactChannelIdentity", {
    findUnique: async () =>
      escenario.choqueConGanador ? { contactId: escenario.choqueConGanador } : null,
  });

  return registro;
}

test("nombreGenerico: el canal como nombre y los últimos caracteres del id como apellido", () => {
  assert.deepEqual(nombreGenerico("MESSENGER", "1234567890123456"), {
    firstName: "Messenger",
    lastName: `…${"1234567890123456".slice(-LARGO_DEL_SUFIJO)}`,
  });
  assert.deepEqual(nombreGenerico("INSTAGRAM", "abc"), {
    firstName: "Instagram",
    lastName: "…abc",
  });
});

test("contacto nuevo: bajo el lock, crea el Contact y su identidad en la misma transacción", async () => {
  const registro = baseFalsa({ identidad: null });
  const id = await resolveMetaContact(ORG, "INSTAGRAM", "igsid-0000000042");

  assert.equal(id, "contacto-nuevo");
  assert.equal(registro.locks, 1);
  assert.equal(registro.contactosCreados.length, 1);
  const creado = registro.contactosCreados[0];
  assert.equal(creado.organizationId, ORG);
  assert.equal(creado.firstName, "Instagram");
  assert.equal(creado.lastName, "…00000042");
  assert.equal(creado.source, META_CONTACT_SOURCE.INSTAGRAM);
  assert.equal(creado.ownerId, null);
  assert.deepEqual(registro.identidadesCreadas, [
    {
      organizationId: ORG,
      channel: "INSTAGRAM",
      externalId: "igsid-0000000042",
      contactId: "contacto-nuevo",
    },
  ]);
});

test("contacto existente y vivo: se devuelve sin crear nada", async () => {
  const registro = baseFalsa({ identidad: "contacto-viejo", contactoVivo: true });
  assert.equal(await resolveMetaContact(ORG, "MESSENGER", "psid-1"), "contacto-viejo");
  assert.equal(registro.contactosCreados.length, 0);
  assert.equal(registro.identidadesCreadas.length, 0);
  assert.equal(registro.identidadesMovidas.length, 0);
});

test("contacto borrado que vuelve a escribir: contacto nuevo y la identidad se MUEVE (no se crea otra)", async () => {
  const registro = baseFalsa({ identidad: "contacto-borrado", contactoVivo: false });
  assert.equal(await resolveMetaContact(ORG, "MESSENGER", "psid-1"), "contacto-nuevo");
  assert.equal(registro.contactosCreados.length, 1);
  assert.equal(registro.identidadesCreadas.length, 0);
  assert.equal(registro.identidadesMovidas.length, 1);
  assert.deepEqual((registro.identidadesMovidas[0] as { data: unknown }).data, {
    contactId: "contacto-nuevo",
  });
});

test("carrera: el create de la identidad choca (P2002), la transacción se revierte y gana el que quedó", async () => {
  const registro = baseFalsa({ identidad: null, choqueConGanador: "contacto-del-otro" });
  assert.equal(await resolveMetaContact(ORG, "MESSENGER", "psid-1"), "contacto-del-otro");
  assert.equal(registro.transaccionesRevertidas, 1, "el Contact propio se fue con el rollback");
});

test("un P2002 sin identidad al releer no es la carrera: se relanza", async () => {
  baseFalsa({ identidad: null, choqueConGanador: null });
  await assert.rejects(
    resolveMetaContact(ORG, "MESSENGER", "psid-1"),
    (err: unknown) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002",
  );
});
