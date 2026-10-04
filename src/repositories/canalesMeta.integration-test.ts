import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { crearCifrador } from "../utils/encryption";
import {
  createContactChannelIdentity,
  findContactIdByExternalIdentity,
} from "./contactChannelIdentity.repository";
import {
  findMetaConnectionByOrganization,
  findMetaConnectionWithSecretByOrganization,
  markMetaConnectionError,
  markMetaConnectionRevoked,
  upsertMetaConnection,
} from "./metaPageConnection.repository";

// ---------------------------------------------------------------------------
// Ítem 169 — las dos tablas nuevas de los canales de Meta, probadas CONTRA LA
// BASE: lo que tiene que sostener Postgres y no el código (el UNIQUE que evita
// contactos duplicados, la FK compuesta que impide cruzar organizaciones, el
// CHECK "ACTIVE exige token", "una conexión por organización" y "una página en
// una sola organización"). La RLS de las dos la afirma verify:schema (filas 4
// y 5 del diagnóstico), no este archivo.
//
// Sin Supabase Auth: alcanza con organizaciones y contactos.
// ---------------------------------------------------------------------------

interface Fixture {
  orgA: string;
  orgB: string;
  contactoA: string;
  contactoB: string;
}

let fx: Fixture;

// Ids distintos por corrida: la base de desarrollo no se reconstruye, y
// page_id es UNIQUE global.
function idAlAzar(prefijo: string): string {
  return `${prefijo}${randomUUID().replace(/\D/g, "").padEnd(15, "5").slice(0, 15)}`;
}

function esViolacion(err: unknown, codigo: string): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === codigo;
}

async function crearOrganizacion(etiqueta: string) {
  const org = await prisma.organization.create({
    data: {
      name: `Canales Meta ${etiqueta} ${randomUUID()}`,
      slug: `canales-meta-${etiqueta}-${Date.now()}-${randomUUID().slice(0, 8)}`,
    },
  });
  const contacto = await prisma.contact.create({
    data: { organizationId: org.id, firstName: "Meta", lastName: etiqueta },
  });
  return { orgId: org.id, contactoId: contacto.id };
}

before(async () => {
  const a = await crearOrganizacion("a");
  const b = await crearOrganizacion("b");
  fx = { orgA: a.orgId, orgB: b.orgId, contactoA: a.contactoId, contactoB: b.contactoId };
});

after(async () => {
  if (!fx) return;
  const ambas = { in: [fx.orgA, fx.orgB] };
  await prisma.contactChannelIdentity.deleteMany({ where: { organizationId: ambas } });
  await prisma.metaPageConnection.deleteMany({ where: { organizationId: ambas } });
  await prisma.contact.deleteMany({ where: { organizationId: ambas } });
  await prisma.organization.deleteMany({ where: { id: ambas } });
});

// ---------------------------------------------------------------------------
// ContactChannelIdentity
// ---------------------------------------------------------------------------

test("identidad: se registra y se resuelve; un id externo que no se vio es null", async () => {
  const externalId = idAlAzar("psid");
  const identidad = { organizationId: fx.orgA, channel: "MESSENGER" as const, externalId };

  assert.equal(await findContactIdByExternalIdentity(identidad), null);
  await createContactChannelIdentity({ ...identidad, contactId: fx.contactoA });
  assert.equal(await findContactIdByExternalIdentity(identidad), fx.contactoA);
});

test("identidad: el mismo (organización, canal, id externo) dos veces es P2002 — no hay contacto duplicado posible", async () => {
  const identidad = {
    organizationId: fx.orgA,
    channel: "INSTAGRAM" as const,
    externalId: idAlAzar("igsid"),
  };
  await createContactChannelIdentity({ ...identidad, contactId: fx.contactoA });

  // Lo que haría el segundo de dos webhooks concurrentes con SU contacto nuevo.
  const otroContacto = await prisma.contact.create({
    data: { organizationId: fx.orgA, firstName: "Duplicado", lastName: "Concurrente" },
  });
  await assert.rejects(
    createContactChannelIdentity({ ...identidad, contactId: otroContacto.id }),
    (err) => esViolacion(err, "P2002"),
  );
  assert.equal(await findContactIdByExternalIdentity(identidad), fx.contactoA);
});

test("identidad: el mismo id externo en OTRO canal u OTRA organización es otra identidad", async () => {
  const externalId = idAlAzar("id");
  await createContactChannelIdentity({
    organizationId: fx.orgA,
    channel: "MESSENGER",
    externalId,
    contactId: fx.contactoA,
  });
  await createContactChannelIdentity({
    organizationId: fx.orgA,
    channel: "INSTAGRAM",
    externalId,
    contactId: fx.contactoA,
  });
  await createContactChannelIdentity({
    organizationId: fx.orgB,
    channel: "MESSENGER",
    externalId,
    contactId: fx.contactoB,
  });

  assert.equal(
    await findContactIdByExternalIdentity({
      organizationId: fx.orgB,
      channel: "MESSENGER",
      externalId,
    }),
    fx.contactoB,
  );
});

test("identidad: la FK compuesta impide apuntar al contacto de OTRA organización", async () => {
  await assert.rejects(
    createContactChannelIdentity({
      organizationId: fx.orgA,
      channel: "MESSENGER",
      externalId: idAlAzar("psid"),
      contactId: fx.contactoB,
    }),
    (err) => esViolacion(err, "P2003"),
  );
});

// ---------------------------------------------------------------------------
// MetaPageConnection
// ---------------------------------------------------------------------------

test("conexión: una sola por organización — reconectar actualiza la fila, y la lectura pública no trae el token", async () => {
  const cifrador = crearCifrador(randomBytes(32));
  const primera = idAlAzar("1");
  const creada = await upsertMetaConnection({
    organizationId: fx.orgA,
    pageId: primera,
    pageAccessToken: cifrador.encrypt("token-1"),
    instagramBusinessAccountId: null,
    pageName: null,
    instagramUsername: null,
  });
  assert.equal("pageAccessToken" in creada, false, "el upsert devuelve sin token");

  await markMetaConnectionError(fx.orgA, "Meta rechazó el token");
  const segunda = idAlAzar("1");
  const ig = idAlAzar("9");
  const reconectada = await upsertMetaConnection({
    organizationId: fx.orgA,
    pageId: segunda,
    pageAccessToken: cifrador.encrypt("token-2"),
    instagramBusinessAccountId: ig,
    pageName: null,
    instagramUsername: null,
  });
  assert.equal(reconectada.id, creada.id, "reconectar no crea otra fila");
  assert.equal(reconectada.pageId, segunda);
  assert.equal(reconectada.instagramBusinessAccountId, ig);
  assert.equal(reconectada.status, "ACTIVE");
  assert.equal(reconectada.lastErrorMessage, null, "reconectar limpia el error");
  assert.equal(await prisma.metaPageConnection.count({ where: { organizationId: fx.orgA } }), 1);

  const publica = await findMetaConnectionByOrganization(fx.orgA);
  assert.ok(publica);
  assert.equal("pageAccessToken" in publica, false);

  // El token queda cifrado en la columna y se recupera solo con la lectura
  // que dice "WithSecret".
  const conSecreto = await findMetaConnectionWithSecretByOrganization(fx.orgA);
  assert.ok(conSecreto?.pageAccessToken);
  assert.notEqual(conSecreto.pageAccessToken, "token-2");
  assert.equal(cifrador.decrypt(conSecreto.pageAccessToken), "token-2");
});

test("conexión: una página de Facebook no puede estar conectada a dos organizaciones", async () => {
  const pagina = idAlAzar("1");
  await upsertMetaConnection({
    organizationId: fx.orgB,
    pageId: pagina,
    pageAccessToken: "v1.cifrado",
    instagramBusinessAccountId: null,
    pageName: null,
    instagramUsername: null,
  });
  // La A intenta conectar la misma página (su fila ya existe de otro test o no:
  // el choque es contra page_id igual).
  await assert.rejects(
    upsertMetaConnection({
      organizationId: fx.orgA,
      pageId: pagina,
      pageAccessToken: "v1.cifrado",
      instagramBusinessAccountId: null,
      pageName: null,
      instagramUsername: null,
    }),
    (err) => esViolacion(err, "P2002"),
  );
});

test("conexión: el CHECK impide una fila ACTIVE sin token; desconectar la deja REVOKED y sin token", async () => {
  await upsertMetaConnection({
    organizationId: fx.orgB,
    pageId: idAlAzar("1"),
    pageAccessToken: "v1.cifrado",
    instagramBusinessAccountId: null,
    pageName: null,
    instagramUsername: null,
  });
  await assert.rejects(
    prisma.metaPageConnection.update({
      where: { organizationId: fx.orgB },
      data: { pageAccessToken: null },
    }),
    /meta_page_connections_active_requires_token_check/,
  );

  await markMetaConnectionRevoked(fx.orgB);
  const fila = await findMetaConnectionWithSecretByOrganization(fx.orgB);
  assert.equal(fila?.status, "REVOKED");
  assert.equal(fila?.pageAccessToken, null);
});
