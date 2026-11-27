import assert from "node:assert/strict";
import { test } from "node:test";
import { prisma } from "../lib/prisma";
import { esNombreProvisorio } from "../utils/nombreProvisorio";
import { desmontar, montar, type Escenario } from "./escenario.test-helper";
import {
  aplicarCambioDeIdentidad,
  bsuidDelContacto,
  destinoDeWhatsapp,
  resolveWhatsappContact,
} from "./whatsappContact.service";

// ---------------------------------------------------------------------------
// PR0 (docs/mensajes-con-opciones.md §10.1): el contacto de WhatsApp por
// teléfono o por BSUID. Con los nombres de usuario de WhatsApp, Meta puede no
// mandar el teléfono; el BSUID (business-scoped user ID) viene siempre. Se
// guarda como identidad del contacto en contact_channel_identities (canal
// WHATSAPP; nunca choca con la identidad por teléfono de una unión, que son
// solo dígitos). Decisiones de Rocco (2026-11-27): C, gana el teléfono; D, el
// nombre sale del perfil, si no del usuario, si no "Contacto de WhatsApp".
// Valores ficticios.
// ---------------------------------------------------------------------------

const BSUID_A = "UY.100000000000000000001";
const BSUID_B = "UY.100000000000000000002";

async function identidades(e: Escenario) {
  return prisma.contactChannelIdentity.findMany({
    where: { organizationId: e.organizationId, channel: "WHATSAPP" },
    select: { externalId: true, contactId: true },
    orderBy: { externalId: "asc" },
  });
}

async function limpiar(e: Escenario) {
  await prisma.contactChannelIdentity.deleteMany({ where: { organizationId: e.organizationId } });
  await prisma.contact.deleteMany({ where: { organizationId: e.organizationId } });
  await desmontar(e);
}

test("solo teléfono: como siempre, sin identidad nueva", async () => {
  const e = await montar("bsuid-tel");
  try {
    const id = await resolveWhatsappContact(e.organizationId, "59899000201", "Ana Pérez");
    const c = await prisma.contact.findUniqueOrThrow({ where: { id } });
    assert.equal(c.phone, "+59899000201");
    assert.equal(`${c.firstName} ${c.lastName}`, "Ana Pérez");
    assert.deepEqual(await identidades(e), []);
  } finally {
    await limpiar(e);
  }
});

test("teléfono y BSUID: el contacto por teléfono guarda el BSUID; después alcanza el BSUID solo", async () => {
  const e = await montar("bsuid-ambos");
  try {
    const id = await resolveWhatsappContact(e.organizationId, "59899000202", "Ana Pérez", {
      bsuid: BSUID_A,
    });
    assert.deepEqual(await identidades(e), [{ externalId: BSUID_A, contactId: id }]);

    // El mismo remitente, ya sin teléfono (activó su nombre de usuario).
    const otraVez = await resolveWhatsappContact(e.organizationId, BSUID_A, "Ana Pérez", {
      bsuid: BSUID_A,
    });
    assert.equal(otraVez, id);
    // Repetir no duplica la identidad.
    await resolveWhatsappContact(e.organizationId, "59899000202", "Ana Pérez", { bsuid: BSUID_A });
    assert.equal((await identidades(e)).length, 1);
  } finally {
    await limpiar(e);
  }
});

test("solo BSUID: contacto nuevo sin teléfono, nombre del perfil, marcado como puesto por el canal", async () => {
  const e = await montar("bsuid-solo");
  try {
    const id = await resolveWhatsappContact(e.organizationId, BSUID_A, "Ana Pérez", {
      bsuid: BSUID_A,
    });
    const c = await prisma.contact.findUniqueOrThrow({ where: { id } });
    assert.equal(c.phone, null);
    assert.equal(`${c.firstName} ${c.lastName}`, "Ana Pérez");
    assert.equal(c.nameSetByChannel, true);
    assert.deepEqual(await identidades(e), [{ externalId: BSUID_A, contactId: id }]);
  } finally {
    await limpiar(e);
  }
});

test("D: sin nombre del perfil, el usuario; sin usuario, 'Contacto de WhatsApp'. Los dos son provisorios", async () => {
  const e = await montar("bsuid-nombre");
  try {
    const conUsuario = await prisma.contact.findUniqueOrThrow({
      where: {
        id: await resolveWhatsappContact(e.organizationId, BSUID_A, undefined, {
          bsuid: BSUID_A,
          usuario: "ana.perez",
        }),
      },
    });
    assert.equal(conUsuario.firstName, "@ana.perez");
    assert.equal(esNombreProvisorio(conUsuario), true);

    const sinNada = await prisma.contact.findUniqueOrThrow({
      where: {
        id: await resolveWhatsappContact(e.organizationId, BSUID_B, undefined, { bsuid: BSUID_B }),
      },
    });
    assert.equal(`${sinNada.firstName} ${sinNada.lastName}`.trim(), "Contacto de WhatsApp");
    assert.equal(esNombreProvisorio(sinNada), true);
  } finally {
    await limpiar(e);
  }
});

test("el contacto que llegó sin teléfono lo guarda cuando Meta lo manda", async () => {
  const e = await montar("bsuid-luego-tel");
  try {
    const id = await resolveWhatsappContact(e.organizationId, BSUID_A, "Ana Pérez", {
      bsuid: BSUID_A,
    });
    const otraVez = await resolveWhatsappContact(e.organizationId, "59899000203", "Ana Pérez", {
      bsuid: BSUID_A,
    });
    assert.equal(otraVez, id);
    const c = await prisma.contact.findUniqueOrThrow({ where: { id } });
    assert.equal(c.phone, "+59899000203");
  } finally {
    await limpiar(e);
  }
});

test("C: si el BSUID es de otro contacto que el del teléfono, gana el teléfono y la identidad no se mueve", async () => {
  const e = await montar("bsuid-conflicto");
  try {
    const delBsuid = await resolveWhatsappContact(e.organizationId, BSUID_A, "Ana", {
      bsuid: BSUID_A,
    });
    const delTelefono = await resolveWhatsappContact(e.organizationId, "59899000204", "Beto");
    const resuelto = await resolveWhatsappContact(e.organizationId, "59899000204", "Beto", {
      bsuid: BSUID_A,
    });
    assert.equal(resuelto, delTelefono);
    assert.notEqual(resuelto, delBsuid);
    assert.deepEqual(await identidades(e), [{ externalId: BSUID_A, contactId: delBsuid }]);
    // Y el teléfono no se le pega al contacto del BSUID.
    assert.equal((await prisma.contact.findUniqueOrThrow({ where: { id: delBsuid } })).phone, null);
  } finally {
    await limpiar(e);
  }
});

test("la identidad de un contacto dado de baja no se reutiliza: se crea uno nuevo", async () => {
  const e = await montar("bsuid-baja");
  try {
    const viejo = await resolveWhatsappContact(e.organizationId, BSUID_A, "Ana", {
      bsuid: BSUID_A,
    });
    await prisma.contact.update({ where: { id: viejo }, data: { deletedAt: new Date() } });
    const nuevo = await resolveWhatsappContact(e.organizationId, BSUID_A, "Ana", {
      bsuid: BSUID_A,
    });
    assert.notEqual(nuevo, viejo);
    assert.deepEqual(await identidades(e), [{ externalId: BSUID_A, contactId: nuevo }]);
  } finally {
    await limpiar(e);
  }
});

test("dos entregas a la vez del mismo remitente nuevo, solo con BSUID, crean un solo contacto", async () => {
  const e = await montar("bsuid-carrera");
  try {
    const [a, b] = await Promise.all([
      resolveWhatsappContact(e.organizationId, BSUID_A, "Ana", { bsuid: BSUID_A }),
      resolveWhatsappContact(e.organizationId, BSUID_A, "Ana", { bsuid: BSUID_A }),
    ]);
    assert.equal(a, b);
    assert.equal(await prisma.contact.count({ where: { organizationId: e.organizationId } }), 1);
  } finally {
    await limpiar(e);
  }
});

test("un BSUID del largo máximo (2 + punto + 128) entra", async () => {
  const e = await montar("bsuid-largo");
  try {
    const largo = `UY.${"9".repeat(128)}`;
    const id = await resolveWhatsappContact(e.organizationId, largo, "Ana", { bsuid: largo });
    assert.deepEqual(await identidades(e), [{ externalId: largo, contactId: id }]);
  } finally {
    await limpiar(e);
  }
});

test("cambio de identidad: el BSUID nuevo queda en el mismo contacto (por el BSUID anterior o por el teléfono)", async () => {
  const e = await montar("bsuid-cambio");
  try {
    const porBsuid = await resolveWhatsappContact(e.organizationId, BSUID_A, "Ana", {
      bsuid: BSUID_A,
    });
    await aplicarCambioDeIdentidad(e.organizationId, {
      wamid: "wamid.s1",
      tipo: "user_changed_user_id",
      bsuidAnterior: BSUID_A,
      bsuidNuevo: "UY.100000000000000000009",
    });
    assert.equal(
      await resolveWhatsappContact(e.organizationId, "UY.100000000000000000009", undefined, {
        bsuid: "UY.100000000000000000009",
      }),
      porBsuid,
    );

    const porTelefono = await resolveWhatsappContact(e.organizationId, "59899000205", "Beto");
    await aplicarCambioDeIdentidad(e.organizationId, {
      wamid: "wamid.s2",
      tipo: "user_changed_number",
      waIdAnterior: "59899000205",
      waIdNuevo: "59899000206",
      bsuidNuevo: BSUID_B,
    });
    assert.equal(
      await resolveWhatsappContact(e.organizationId, BSUID_B, undefined, { bsuid: BSUID_B }),
      porTelefono,
    );
    // El teléfono del contacto no se cambia solo: lo decide una persona.
    assert.equal(
      (await prisma.contact.findUniqueOrThrow({ where: { id: porTelefono } })).phone,
      "+59899000205",
    );

    // Un cambio de alguien que no conocemos no crea nada.
    await aplicarCambioDeIdentidad(e.organizationId, {
      wamid: "wamid.s3",
      tipo: "user_changed_user_id",
      bsuidAnterior: "UY.100000000000000000077",
      bsuidNuevo: "UY.100000000000000000078",
    });
    assert.equal((await identidades(e)).length, 3);
  } finally {
    await limpiar(e);
  }
});

test("B: el destino de una plantilla es el teléfono; sin teléfono, el BSUID más reciente; sin nada, vacío", async () => {
  const e = await montar("bsuid-destino");
  try {
    const conTelefono = await resolveWhatsappContact(e.organizationId, "59899000207", "Ana", {
      bsuid: BSUID_A,
    });
    const buscar = (id: string) => () => bsuidDelContacto(e.organizationId, id);
    assert.equal(await destinoDeWhatsapp("+59899000207", buscar(conTelefono)), "59899000207");

    const sinTelefono = await resolveWhatsappContact(e.organizationId, BSUID_B, "Beto", {
      bsuid: BSUID_B,
    });
    assert.equal(await destinoDeWhatsapp(null, buscar(sinTelefono)), BSUID_B);
    // Sin la búsqueda (las deps de un test unitario), como antes: vacío.
    assert.equal(await destinoDeWhatsapp(null), "");

    const nadie = await prisma.contact.create({
      data: { organizationId: e.organizationId, firstName: "Sin", lastName: "Datos" },
    });
    assert.equal(await destinoDeWhatsapp(null, buscar(nadie.id)), "");
  } finally {
    await limpiar(e);
  }
});
