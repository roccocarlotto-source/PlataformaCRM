import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { esNombreProvisorio } from "../utils/nombreProvisorio";
import {
  LARGO_DEL_SUFIJO,
  META_CONTACT_SOURCE,
  completarNombreDesdeElPerfil,
  nombreGenerico,
  resolveMetaContact,
  type DepsDelNombreDeMeta,
} from "./metaContact.service";
import { MetaProfileError, type ObtenerPerfilDeMetaInput } from "./metaProfile.service";

// ---------------------------------------------------------------------------
// metaContact.service.ts (ítem 171), SIN BASE. Prisma se reemplaza por dobles
// (mismo patrón que metaPageConnection.service.test.ts): $transaction corre
// el callback con un tx falso que registra cada escritura. Lo que se verifica
// es el buscar-o-crear: contacto nuevo (Contact + identidad en la MISMA
// transacción), contacto existente, contacto borrado que vuelve a escribir, y
// la carrera del P2002. Que el UNIQUE y el lock de verdad lo sostengan lo
// cubre metaWebhook.controller.integration-test.ts.
//
// Y completarNombreDesdeElPerfil, con la Graph API simulada (un doble de
// obtenerPerfil): el nombre real reemplaza al genérico, un nombre ya cargado
// no se pisa, y ningún fallo sale de la función.
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
  // Es un nombre provisorio: el agente no saluda con él y puede reemplazarlo.
  assert.equal(esNombreProvisorio(nombreGenerico("MESSENGER", "1234567890123456")), true);
  assert.equal(esNombreProvisorio(nombreGenerico("INSTAGRAM", "abc")), true);
});

test("contacto nuevo: bajo el lock, crea el Contact y su identidad en la misma transacción", async () => {
  const registro = baseFalsa({ identidad: null });
  const resuelto = await resolveMetaContact(ORG, "INSTAGRAM", "igsid-0000000042");

  assert.deepEqual(resuelto, { contactId: "contacto-nuevo", creado: true });
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
  assert.deepEqual(await resolveMetaContact(ORG, "MESSENGER", "psid-1"), {
    contactId: "contacto-viejo",
    creado: false,
  });
  assert.equal(registro.contactosCreados.length, 0);
  assert.equal(registro.identidadesCreadas.length, 0);
  assert.equal(registro.identidadesMovidas.length, 0);
});

test("contacto borrado que vuelve a escribir: contacto nuevo y la identidad se MUEVE (no se crea otra)", async () => {
  const registro = baseFalsa({ identidad: "contacto-borrado", contactoVivo: false });
  assert.deepEqual(await resolveMetaContact(ORG, "MESSENGER", "psid-1"), {
    contactId: "contacto-nuevo",
    creado: true,
  });
  assert.equal(registro.contactosCreados.length, 1);
  assert.equal(registro.identidadesCreadas.length, 0);
  assert.equal(registro.identidadesMovidas.length, 1);
  assert.deepEqual((registro.identidadesMovidas[0] as { data: unknown }).data, {
    contactId: "contacto-nuevo",
  });
});

test("carrera: el create de la identidad choca (P2002), la transacción se revierte y gana el que quedó", async () => {
  const registro = baseFalsa({ identidad: null, choqueConGanador: "contacto-del-otro" });
  // creado: false — el nombre del perfil lo busca el webhook que ganó.
  assert.deepEqual(await resolveMetaContact(ORG, "MESSENGER", "psid-1"), {
    contactId: "contacto-del-otro",
    creado: false,
  });
  assert.equal(registro.transaccionesRevertidas, 1, "el Contact propio se fue con el rollback");
});

test("un P2002 sin identidad al releer no es la carrera: se relanza", async () => {
  baseFalsa({ identidad: null, choqueConGanador: null });
  await assert.rejects(
    resolveMetaContact(ORG, "MESSENGER", "psid-1"),
    (err: unknown) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002",
  );
});

// --- completarNombreDesdeElPerfil --------------------------------------------

const ENTRADA = {
  organizationId: ORG,
  channel: "MESSENGER" as const,
  pageId: "pagina-1",
  externalId: "psid-0000000042",
  contactId: "contacto-nuevo",
};

// La Graph API simulada (obtenerPerfil) y el updateMany del contacto, que
// responde `actualizados` filas: 0 es "ya no tenía el nombre genérico".
function escenarioDelNombre(
  opciones: {
    perfil?: { firstName: string; lastName: string } | null | Error;
    token?: string | Error;
    actualizados?: number;
  } = {},
) {
  const registro = {
    tokensPedidos: [] as { organizationId: string; pageId: string }[],
    perfilesPedidos: [] as ObtenerPerfilDeMetaInput[],
    updates: [] as { where: Record<string, unknown>; data: Record<string, unknown> }[],
  };
  const perfil = "perfil" in opciones ? opciones.perfil : { firstName: "Ana", lastName: "Pérez" };
  const deps: DepsDelNombreDeMeta = {
    pageAccessToken: async (organizationId, pageId) => {
      registro.tokensPedidos.push({ organizationId, pageId });
      if (opciones.token instanceof Error) throw opciones.token;
      return opciones.token ?? "token-en-claro";
    },
    obtenerPerfil: async (input) => {
      registro.perfilesPedidos.push(input);
      if (perfil instanceof Error) throw perfil;
      return perfil ?? null;
    },
  };
  mock.property(prisma as unknown as Record<string, unknown>, "contact", {
    updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      registro.updates.push(args);
      return { count: opciones.actualizados ?? 1 };
    },
  });
  return { deps, registro };
}

test("nombre del perfil: con el token de la página se pide el perfil y el nombre real reemplaza al genérico", async () => {
  const { deps, registro } = escenarioDelNombre();
  assert.equal(await completarNombreDesdeElPerfil(ENTRADA, deps), "completado");

  assert.deepEqual(registro.tokensPedidos, [{ organizationId: ORG, pageId: "pagina-1" }]);
  assert.deepEqual(registro.perfilesPedidos, [
    { pageAccessToken: "token-en-claro", channel: "MESSENGER", userId: "psid-0000000042" },
  ]);
  assert.equal(registro.updates.length, 1);
  assert.deepEqual(registro.updates[0].data, { firstName: "Ana", lastName: "Pérez" });
});

test("nombre del perfil: el reemplazo EXIGE que el contacto siga con el nombre genérico — uno ya cargado no se pisa", async () => {
  const { deps, registro } = escenarioDelNombre({ actualizados: 0 });
  assert.equal(await completarNombreDesdeElPerfil(ENTRADA, deps), "ya-tenia-nombre");

  // La condición va en el WHERE de la escritura, no en una lectura previa.
  assert.deepEqual(registro.updates[0].where, {
    id: "contacto-nuevo",
    organizationId: ORG,
    deletedAt: null,
    firstName: "Messenger",
    lastName: "…00000042",
  });
});

test("nombre del perfil: Meta no devuelve nombre -> no se escribe nada y queda el genérico", async () => {
  const { deps, registro } = escenarioDelNombre({ perfil: null });
  assert.equal(await completarNombreDesdeElPerfil(ENTRADA, deps), "sin-perfil");
  assert.equal(registro.updates.length, 0);
});

test("nombre del perfil: Meta rechaza (sin permiso), se corta la red o no hay token -> 'fallo', sin lanzar ni escribir", async () => {
  for (const opciones of [
    { perfil: new MetaProfileError(400, 100, 33) },
    { perfil: new Error("fetch failed") },
    { token: new Error("La conexión con Facebook está desconectada") },
  ]) {
    const { deps, registro } = escenarioDelNombre(opciones);
    assert.equal(await completarNombreDesdeElPerfil(ENTRADA, deps), "fallo");
    assert.equal(registro.updates.length, 0);
  }
  // Sin token no se llega a llamar a Meta.
  const { deps, registro } = escenarioDelNombre({ token: new Error("sin conexión") });
  await completarNombreDesdeElPerfil(ENTRADA, deps);
  assert.equal(registro.perfilesPedidos.length, 0);
});
