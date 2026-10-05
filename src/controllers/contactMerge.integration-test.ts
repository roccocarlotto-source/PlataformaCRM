import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { createClient } from "@supabase/supabase-js";
import express from "express";
import { env } from "../config/env";
import { prisma } from "../lib/prisma";
import { getSupabaseAdmin } from "../lib/supabaseAdmin";
import { errorHandler } from "../middlewares/errorHandler";
import { notFound } from "../middlewares/notFound";
import { findRoleByName } from "../repositories/role.repository";
import { contactRouter } from "../routes/contact.routes";
import { createAgentInboundJob } from "../repositories/agentInboundJob.repository";
import { MARCADOR_DE_DATO_BORRADO } from "../repositories/contact.repository";
import { findConversationByExternalThreadId } from "../repositories/conversation.repository";
import { registrarEntrante } from "../services/agentOrchestration.service";
import { FKS_A_CONTACTS } from "../services/contactMerge.service";
import { leerHiloDelWidget } from "../services/publicWidgetThread.service";
import { resolveWidgetContact } from "../services/widgetContact.service";
import { resolveWhatsappContact } from "../services/whatsappContact.service";

// ---------------------------------------------------------------------------
// Unir contactos duplicados (contactMerge.service.ts), por HTTP real contra
// el router real —con su authenticate y su authorize— y Postgres y GoTrue
// reales.
//
// Lo que se prueba:
//   1. El inventario de FKs a contacts del servicio es el del catálogo real:
//      una FK nueva hace fallar este test.
//   2. Se mueven TODAS las relaciones (una fila de cada tabla), el unido queda
//      con soft delete y mergedIntoId, y los campos elegidos quedan en el que
//      queda (con el default "más reciente no vacío" en lo que no se eligió).
//   3. Los choques: el email del unido pasa sin chocar con el índice único; la
//      conversación abierta del unido con el mismo agente y canal se cierra.
//   4. El teléfono que se pierde sigue encontrando al que queda por WhatsApp.
//   5. Aislamiento: un contacto de otra organización es 404 y no se toca.
//   6. Un USER recibe 403 en la vista previa y en la unión.
// ---------------------------------------------------------------------------

const PASSWORD = "Merge-test-password-123!";

interface FixtureUser {
  accessToken: string;
  authUserId: string;
  userId: string;
}

let orgId: string;
let otraOrgId: string;
let branchId: string;
let agentId: string;
let admin: FixtureUser;
let vendedor: FixtureUser;
let adminOtraOrg: FixtureUser;
let baseUrl: string;
let closeApp: () => Promise<void>;
let pipelineId: string;
let stageId: string;
let resourceId: string;
let serviceTypeId: string;
let automationId: string;
let qrCodeId: string;
let sourceId: string;

function startTestApp(): Promise<{ url: string; close: () => Promise<void> }> {
  const app = express();
  app.use(express.json());
  app.use("/api", contactRouter);
  app.use(notFound);
  app.use(errorHandler);
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

async function createFixtureUser(
  label: string,
  organizationId: string,
  role: "ADMIN" | "USER",
): Promise<FixtureUser> {
  const email = `merge-${label}-${Date.now()}-${randomUUID().slice(0, 8)}@example.test`;
  const { data, error } = await getSupabaseAdmin().auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user)
    throw new Error(`No se pudo crear el usuario (${label}): ${error?.message}`);
  const rol = await findRoleByName(role);
  if (!rol) throw new Error(`No está sembrado el rol ${role}.`);
  await prisma.user.create({
    data: { id: data.user.id, organizationId, roleId: rol.id, email, fullName: `Merge ${label}` },
  });
  const anon = createClient(env.SUPABASE_URL!, env.SUPABASE_ANON_KEY!);
  const { data: s, error: e } = await anon.auth.signInWithPassword({ email, password: PASSWORD });
  if (e || !s.session) throw new Error(`No se pudo iniciar sesión (${label}): ${e?.message}`);
  return { accessToken: s.session.access_token, authUserId: data.user.id, userId: data.user.id };
}

function call(method: string, path: string, token: string, body?: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

before(async () => {
  const started = await startTestApp();
  baseUrl = started.url;
  closeApp = started.close;

  orgId = (
    await prisma.organization.create({
      data: {
        name: `Merge ${randomUUID()}`,
        slug: `merge-${Date.now()}-${randomUUID().slice(0, 8)}`,
      },
    })
  ).id;
  otraOrgId = (
    await prisma.organization.create({
      data: {
        name: `Merge B ${randomUUID()}`,
        slug: `merge-b-${Date.now()}-${randomUUID().slice(0, 8)}`,
      },
    })
  ).id;
  branchId = (
    await prisma.branch.create({
      data: { organizationId: orgId, name: "Centro", timezone: "America/Montevideo" },
    })
  ).id;
  agentId = (
    await prisma.agent.create({
      data: {
        organizationId: orgId,
        branchId,
        name: "Vera",
        instructions: "Atendé.",
        modelProvider: "openrouter",
        modelName: "test/model",
        enabledTools: [],
        guardrails: {},
        channels: ["WHATSAPP", "WEB"],
      },
    })
  ).id;
  pipelineId = (await prisma.pipeline.create({ data: { organizationId: orgId, name: "Ventas" } }))
    .id;
  stageId = (
    await prisma.stage.create({
      data: { organizationId: orgId, pipelineId, name: "Nuevo", order: 0 },
    })
  ).id;
  resourceId = (
    await prisma.resource.create({
      data: { organizationId: orgId, branchId, name: "Box 1", type: "ROOM" },
    })
  ).id;
  serviceTypeId = (
    await prisma.serviceType.create({
      data: {
        organizationId: orgId,
        branchId,
        resourceId,
        name: "Prueba de manejo",
        durationMin: 30,
      },
    })
  ).id;
  automationId = (
    await prisma.automation.create({
      data: {
        organizationId: orgId,
        name: "Regla",
        triggerType: "opportunity.won",
        actionType: "opportunity.send_discount_voucher",
        actionConfig: {},
        isActive: false,
      },
    })
  ).id;
  qrCodeId = (
    await prisma.qrCode.create({
      data: { organizationId: orgId, branchId, name: "QR", destinationUrl: "https://example.com" },
    })
  ).id;
  sourceId = (
    await prisma.source.create({
      data: { organizationId: orgId, name: "Landing", type: "WEBHOOK" },
    })
  ).id;

  admin = await createFixtureUser("admin", orgId, "ADMIN");
  vendedor = await createFixtureUser("vendedor", orgId, "USER");
  adminOtraOrg = await createFixtureUser("admin-b", otraOrgId, "ADMIN");
});

after(async () => {
  if (closeApp) await closeApp();
  for (const id of [orgId, otraOrgId]) {
    if (!id) continue;
    const where = { organizationId: id };
    await prisma.activity.deleteMany({ where });
    await prisma.booking.deleteMany({ where });
    await prisma.contactChannelIdentity.deleteMany({ where });
    await prisma.agentInboundJob.deleteMany({ where });
    await prisma.message.deleteMany({ where });
    await prisma.conversation.deleteMany({ where });
    await prisma.discountVoucherFollowUp.deleteMany({ where });
    await prisma.discountVoucher.deleteMany({ where });
    await prisma.qrFollowUp.deleteMany({ where });
    await prisma.ingestionEvent.deleteMany({ where });
    await prisma.opportunity.deleteMany({ where });
    await prisma.contact.updateMany({ where, data: { mergedIntoId: null } });
    await prisma.contact.deleteMany({ where });
    await prisma.qrCode.deleteMany({ where });
    await prisma.automation.deleteMany({ where });
    await prisma.source.deleteMany({ where });
    await prisma.serviceType.deleteMany({ where });
    await prisma.resource.deleteMany({ where });
    await prisma.stage.deleteMany({ where });
    await prisma.pipeline.deleteMany({ where });
    await prisma.agent.deleteMany({ where });
    await prisma.branch.deleteMany({ where });
    await prisma.user.deleteMany({ where });
    await prisma.organization.delete({ where: { id } });
  }
  for (const u of [admin, vendedor, adminOtraOrg]) {
    if (u) await getSupabaseAdmin().auth.admin.deleteUser(u.authUserId);
  }
});

function contacto(datos: Record<string, unknown> = {}, organizationId = orgId) {
  return prisma.contact.create({
    data: { organizationId, firstName: "Ana", lastName: randomUUID().slice(0, 6), ...datos },
  });
}

async function conversacion(
  contactId: string,
  channel: "WHATSAPP" | "WEB",
  status = "ACTIVE" as const,
) {
  const conv = await prisma.conversation.create({
    data: {
      organizationId: orgId,
      branchId,
      agentId,
      contactId,
      channel,
      status,
      externalThreadId: randomUUID(),
    },
  });
  await prisma.message.create({
    data: {
      organizationId: orgId,
      conversationId: conv.id,
      direction: "INBOUND",
      senderType: "CONTACT",
      content: "Hola",
    },
  });
  return conv;
}

// Una fila de CADA tabla que referencia al contacto (FKS_A_CONTACTS).
async function colgarDeTodo(contactId: string) {
  const opp = await prisma.opportunity.create({
    data: {
      organizationId: orgId,
      pipelineId,
      stageId,
      title: "Hilux",
      ownerId: admin.userId,
      contactId,
    },
  });
  await prisma.activity.create({
    data: {
      organizationId: orgId,
      authorId: admin.userId,
      type: "TASK",
      contactId,
      subject: "Llamar",
    },
  });
  await prisma.booking.create({
    data: {
      organizationId: orgId,
      branchId,
      resourceId,
      serviceTypeId,
      contactId,
      startsAt: new Date("2026-11-10T12:00:00Z"),
      endsAt: new Date("2026-11-10T12:30:00Z"),
    },
  });
  await prisma.contactChannelIdentity.create({
    data: { organizationId: orgId, channel: "MESSENGER", externalId: randomUUID(), contactId },
  });
  const conv = await conversacion(contactId, "WEB");
  await prisma.discountVoucher.create({
    data: {
      organizationId: orgId,
      opportunityId: opp.id,
      contactId,
      automationId,
      label: "10%",
      expiresAt: new Date(Date.now() + 86_400_000),
    },
  });
  await prisma.discountVoucherFollowUp.create({
    data: {
      organizationId: orgId,
      automationId,
      opportunityId: opp.id,
      contactId,
      branchId,
      label: "10%",
      expiresInDays: 30,
      scheduledFor: new Date(),
      nextAttemptAt: new Date(),
    },
  });
  await prisma.qrFollowUp.create({
    data: {
      organizationId: orgId,
      automationId,
      opportunityId: opp.id,
      contactId,
      qrCodeId,
      scheduledFor: new Date(),
      nextAttemptAt: new Date(),
    },
  });
  await prisma.ingestionEvent.create({
    data: { organizationId: orgId, sourceId, rawPayload: {}, promotedContactId: contactId },
  });
  const yaUnido = await contacto({ deletedAt: new Date(), mergedIntoId: contactId });
  return { oppId: opp.id, conversationId: conv.id, yaUnidoId: yaUnido.id };
}

async function contarDe(contactId: string) {
  const w = { organizationId: orgId, contactId };
  return {
    activities: await prisma.activity.count({ where: w }),
    bookings: await prisma.booking.count({ where: w }),
    contact_channel_identities: await prisma.contactChannelIdentity.count({ where: w }),
    conversations: await prisma.conversation.count({ where: w }),
    discount_voucher_follow_ups: await prisma.discountVoucherFollowUp.count({ where: w }),
    discount_vouchers: await prisma.discountVoucher.count({ where: w }),
    ingestion_events: await prisma.ingestionEvent.count({
      where: { organizationId: orgId, promotedContactId: contactId },
    }),
    opportunities: await prisma.opportunity.count({ where: w }),
    qr_follow_ups: await prisma.qrFollowUp.count({ where: w }),
    merged: await prisma.contact.count({
      where: { organizationId: orgId, mergedIntoId: contactId },
    }),
  };
}

test("el inventario de FKs a contacts del servicio es exactamente el del catálogo", async () => {
  const filas = await prisma.$queryRaw<{ ref: string }[]>`
    SELECT c.conrelid::regclass::text || '.' || a.attname AS ref
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
    WHERE c.contype = 'f' AND c.confrelid = 'public.contacts'::regclass
      AND a.attname <> 'organization_id'
    ORDER BY 1`;
  assert.deepEqual(
    filas.map((f) => f.ref),
    [...FKS_A_CONTACTS].sort(),
    "una FK nueva a contacts tiene que agregarse a la unión (FKS_A_CONTACTS y unirContactos)",
  );
});

test("se mueven TODAS las relaciones; el unido queda dado de baja con mergedIntoId; los campos elegidos quedan", async () => {
  const kept = await contacto({
    firstName: "Ana",
    email: null,
    phone: "+59899111111",
    leadIntent: "Comprar una pickup",
    leadNotes: "Nota del que queda",
  });
  const absorbed = await contacto({
    firstName: "Ana María",
    email: `ana-${randomUUID().slice(0, 6)}@example.test`,
    phone: "+59899222222",
    leadIntent: "Vender su auto",
    leadNotes: "Nota del unido",
  });
  const colgado = await colgarDeTodo(absorbed.id);
  const antes = await contarDe(absorbed.id);
  assert.ok(
    Object.values(antes).every((n) => n >= 1),
    JSON.stringify(antes),
  );

  const preview = await call(
    "GET",
    `/api/contacts/${kept.id}/merge-preview?with=${absorbed.id}`,
    admin.accessToken,
  );
  assert.equal(preview.status, 200, await preview.clone().text());
  const vista = (await preview.json()) as {
    defaults: Record<string, string>;
    aMover: Record<string, number>;
  };
  // El unido se creó después: es el más reciente, y su email no está vacío.
  assert.equal(vista.defaults.email, "absorbed");
  assert.equal(vista.aMover.oportunidades, 1);

  const res = await call("POST", `/api/contacts/${kept.id}/merge`, admin.accessToken, {
    absorbedId: absorbed.id,
    fields: { firstName: "kept", leadIntent: "kept" },
  });
  assert.equal(res.status, 200, await res.clone().text());
  const cuerpo = (await res.json()) as { movidos: Record<string, number> };
  assert.equal(cuerpo.movidos.oportunidades, 1);

  const despues = await contarDe(kept.id);
  for (const [tabla, n] of Object.entries(antes)) {
    // activities: más la nota de auditoría de la unión. Identidades: más la
    // WHATSAPP del teléfono del que queda, que se pierde (queda el del unido).
    // merged: más el propio unido, que ahora apunta al que queda.
    const esperado =
      tabla === "activities" || tabla === "contact_channel_identities" || tabla === "merged"
        ? n + 1
        : n;
    assert.equal(despues[tabla as keyof typeof despues], esperado, `${tabla} pasó al que queda`);
  }
  assert.ok(
    Object.values(await contarDe(absorbed.id)).every((n) => n === 0),
    "nada quedó colgado del unido",
  );
  const mensajes = await prisma.message.count({
    where: { conversationId: colgado.conversationId },
  });
  assert.equal(mensajes, 1, "los mensajes van con su conversación");

  assert.ok(
    await prisma.contactChannelIdentity.findFirst({
      where: {
        organizationId: orgId,
        channel: "WHATSAPP",
        externalId: "59899111111",
        contactId: kept.id,
      },
    }),
    "el teléfono que se pierde queda como identidad de WhatsApp",
  );
  const unido = await prisma.contact.findUniqueOrThrow({ where: { id: absorbed.id } });
  assert.ok(unido.deletedAt, "soft delete, no se borra");
  assert.equal(unido.mergedIntoId, kept.id);

  const queda = await prisma.contact.findUniqueOrThrow({ where: { id: kept.id } });
  assert.equal(queda.firstName, "Ana", "elegido: el del que queda");
  assert.equal(queda.leadIntent, "Comprar una pickup");
  assert.equal(
    queda.email,
    absorbed.email,
    "default: el más reciente no vacío, sin chocar con el índice único",
  );
  assert.match(
    queda.leadNotes ?? "",
    /Nota del que queda[\s\S]*Nota del unido/,
    "las notas se suman",
  );
  const nota = await prisma.activity.findFirst({
    where: { contactId: kept.id, type: "NOTE", subject: { startsWith: "Se unió el contacto" } },
  });
  assert.ok(nota, "queda la nota de auditoría");
});

test("dos conversaciones abiertas con el mismo agente y canal: la más vieja se cierra, las dos pasan al que queda", async () => {
  const kept = await contacto();
  const absorbed = await contacto();
  // La del unido es la más vieja: el cliente escribió último por la otra.
  const delUnido = await conversacion(absorbed.id, "WHATSAPP");
  const delQueQueda = await conversacion(kept.id, "WHATSAPP");

  const res = await call("POST", `/api/contacts/${kept.id}/merge`, admin.accessToken, {
    absorbedId: absorbed.id,
  });
  assert.equal(res.status, 200, await res.clone().text());
  assert.equal(
    ((await res.json()) as { conversacionesCerradas: number }).conversacionesCerradas,
    1,
  );

  const a = await prisma.conversation.findUniqueOrThrow({ where: { id: delQueQueda.id } });
  const b = await prisma.conversation.findUniqueOrThrow({ where: { id: delUnido.id } });
  assert.equal(a.status, "ACTIVE");
  assert.equal(b.status, "CLOSED");
  assert.equal(b.contactId, kept.id);
});

test("el teléfono que se pierde sigue encontrando al que queda cuando escribe por WhatsApp", async () => {
  const digitosKept = `598${Math.floor(1e7 + Math.random() * 9e7)}`;
  const digitosUnido = `598${Math.floor(1e7 + Math.random() * 9e7)}`;
  const kept = await contacto({ phone: `+${digitosKept}` });
  const absorbed = await contacto({ phone: `+${digitosUnido}` });

  const res = await call("POST", `/api/contacts/${kept.id}/merge`, admin.accessToken, {
    absorbedId: absorbed.id,
    fields: { phone: "kept" },
  });
  assert.equal(res.status, 200);

  const contactos = await prisma.contact.count({ where: { organizationId: orgId } });
  assert.equal(await resolveWhatsappContact(orgId, digitosUnido, "Ana"), kept.id);
  assert.equal(await resolveWhatsappContact(orgId, digitosKept, "Ana"), kept.id);
  assert.equal(
    await prisma.contact.count({ where: { organizationId: orgId } }),
    contactos,
    "no se creó un duplicado nuevo",
  );
});

test("aislamiento: un contacto de otra organización es 404 y no se toca", async () => {
  const kept = await contacto();
  const ajeno = await contacto({}, otraOrgId);
  const res = await call("POST", `/api/contacts/${kept.id}/merge`, admin.accessToken, {
    absorbedId: ajeno.id,
  });
  assert.equal(res.status, 404);
  assert.equal(
    (await prisma.contact.findUniqueOrThrow({ where: { id: ajeno.id } })).deletedAt,
    null,
  );

  const desdeLaOtra = await call(
    "POST",
    `/api/contacts/${ajeno.id}/merge`,
    adminOtraOrg.accessToken,
    {
      absorbedId: kept.id,
    },
  );
  assert.equal(desdeLaOtra.status, 404);
  assert.equal(
    (await prisma.contact.findUniqueOrThrow({ where: { id: kept.id } })).deletedAt,
    null,
  );
  assert.equal(
    (
      await call(
        "GET",
        `/api/contacts/${kept.id}/merge-preview?with=${ajeno.id}`,
        admin.accessToken,
      )
    ).status,
    404,
  );
});

test("un USER recibe 403 en la vista previa y en la unión, y nada cambia", async () => {
  const kept = await contacto();
  const absorbed = await contacto();
  const preview = await call(
    "GET",
    `/api/contacts/${kept.id}/merge-preview?with=${absorbed.id}`,
    vendedor.accessToken,
  );
  assert.equal(preview.status, 403);
  const res = await call("POST", `/api/contacts/${kept.id}/merge`, vendedor.accessToken, {
    absorbedId: absorbed.id,
  });
  assert.equal(res.status, 403);
  assert.equal(
    (await prisma.contact.findUniqueOrThrow({ where: { id: absorbed.id } })).deletedAt,
    null,
  );
});

test("validación: consigo mismo es 400; un campo desconocido o un lado inválido, 400; uno ya unido, 404", async () => {
  const kept = await contacto();
  assert.equal(
    (
      await call("POST", `/api/contacts/${kept.id}/merge`, admin.accessToken, {
        absorbedId: kept.id,
      })
    ).status,
    400,
  );
  const otro = await contacto();
  for (const fields of [{ noExiste: "kept" }, { email: "ambos" }]) {
    const res = await call("POST", `/api/contacts/${kept.id}/merge`, admin.accessToken, {
      absorbedId: otro.id,
      fields,
    });
    assert.equal(res.status, 400, JSON.stringify(fields));
  }
  assert.equal(
    (
      await call("POST", `/api/contacts/${kept.id}/merge`, admin.accessToken, {
        absorbedId: otro.id,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await call("POST", `/api/contacts/${kept.id}/merge`, admin.accessToken, {
        absorbedId: otro.id,
      })
    ).status,
    404,
    "el unido ya no existe para la API",
  );
});

// ===========================================================================
// Tanda 5 de la auditoría (docs-privados, local): unir contactos sin mezclar
// personas.
// ===========================================================================

function unir(keptId: string, absorbedId: string, fields?: Record<string, string>) {
  return call("POST", `/api/contacts/${keptId}/merge`, admin.accessToken, {
    absorbedId,
    ...(fields ? { fields } : {}),
  });
}

// OPUS-C-01 / FABLE-A-02: el caso confirmado en vivo por las dos auditorías.
test("OPUS-C-01 / FABLE-A-02: después de unir, la sesión del widget del unido no ve ni escribe en la conversación del que queda", async () => {
  const kept = await contacto({ email: `real-${randomUUID().slice(0, 8)}@example.test` });
  const absorbed = await contacto({ firstName: "Visitante", lastName: "caa2c873" });
  const delQueQueda = await conversacion(kept.id, "WEB");
  const delUnido = await conversacion(absorbed.id, "WEB");
  const sesionDelUnido = delUnido.externalThreadId!;
  const sesionDelQueQueda = delQueQueda.externalThreadId!;

  // La pantalla lo advierte antes de confirmar.
  const preview = await call(
    "GET",
    `/api/contacts/${kept.id}/merge-preview?with=${absorbed.id}`,
    admin.accessToken,
  );
  assert.equal(preview.status, 200, await preview.clone().text());
  assert.equal(((await preview.json()) as { chatsWebACortar: number }).chatsWebACortar, 1);

  const res = await unir(kept.id, absorbed.id);
  assert.equal(res.status, 200, await res.clone().text());
  assert.equal(((await res.json()) as { chatsWebCortados: number }).chatsWebCortados, 1);

  // La conversación del unido pasó al que queda (el historial no se pierde),
  // cerrada y sin el id de sesión.
  const cortada = await prisma.conversation.findUniqueOrThrow({ where: { id: delUnido.id } });
  assert.equal(cortada.contactId, kept.id);
  assert.equal(cortada.status, "CLOSED");
  assert.equal(cortada.externalThreadId, null);
  assert.equal(await prisma.message.count({ where: { conversationId: delUnido.id } }), 1);

  // Ese navegador ya no está atado a nadie: no ve ningún hilo...
  assert.equal(
    await findConversationByExternalThreadId(orgId, agentId, "WEB", sesionDelUnido),
    null,
  );
  const hilo = await leerHiloDelWidget({ organizationId: orgId, agentId }, sesionDelUnido, null);
  assert.deepEqual(hilo.messages, []);

  // ...y si vuelve a escribir, es un visitante NUEVO, no el contacto que quedó.
  const nuevo = await resolveWidgetContact(
    orgId,
    agentId,
    branchId,
    "WEB",
    sesionDelUnido,
    `token-${randomUUID()}`,
  );
  assert.notEqual(nuevo, kept.id);
  assert.notEqual(nuevo, absorbed.id);
  const { conversation } = await registrarEntrante({
    organizationId: orgId,
    agentId,
    branchId,
    contactId: nuevo,
    channel: "WEB",
    texto: "¿Qué email tienen registrado a mi nombre?",
    externalThreadId: sesionDelUnido,
  });
  assert.notEqual(conversation.id, delQueQueda.id, "no escribe en la conversación del que queda");
  assert.equal(conversation.contactId, nuevo);
  assert.equal(await prisma.message.count({ where: { conversationId: delQueQueda.id } }), 1);

  // El que queda conserva su propia sesión y su hilo.
  const suConversacion = await prisma.conversation.findUniqueOrThrow({
    where: { id: delQueQueda.id },
  });
  assert.equal(suConversacion.status, "ACTIVE");
  assert.equal(suConversacion.externalThreadId, sesionDelQueQueda);
  const suHilo = await leerHiloDelWidget(
    { organizationId: orgId, agentId },
    sesionDelQueQueda,
    null,
  );
  assert.equal(suHilo.messages.length, 1);
});

// OPUS-C-01 (WhatsApp) / FABLE-C-02.
test("OPUS-C-01 / FABLE-C-02: tras unir, la respuesta va al número por el que el cliente escribió último", async () => {
  const numeroKept = `598${Math.floor(1e7 + Math.random() * 9e7)}`;
  const numeroUnido = `598${Math.floor(1e7 + Math.random() * 9e7)}`;
  const kept = await contacto({ phone: `+${numeroKept}` });
  const absorbed = await contacto({ phone: `+${numeroUnido}` });
  const conv = await conversacion(kept.id, "WHATSAPP");
  await prisma.conversation.update({
    where: { id: conv.id },
    data: { externalThreadId: numeroKept },
  });
  assert.equal((await unir(kept.id, absorbed.id, { phone: "kept" })).status, 200);

  // El cliente escribe desde el número del contacto unido.
  const contactId = await resolveWhatsappContact(orgId, numeroUnido, "Ana");
  assert.equal(contactId, kept.id);
  const { conversation } = await registrarEntrante({
    organizationId: orgId,
    agentId,
    branchId,
    contactId,
    channel: "WHATSAPP",
    texto: "Hola, te escribo desde mi otro número",
    externalThreadId: numeroUnido,
    externalMessageId: `wamid.${randomUUID()}`,
  });

  assert.equal(conversation.id, conv.id, "cae en la conversación abierta del que queda");
  const despues = await prisma.conversation.findUniqueOrThrow({ where: { id: conv.id } });
  assert.equal(despues.externalThreadId, numeroUnido, "y ahí es donde va la respuesta");
});

// FABLE-C-04.
test("FABLE-C-04: un entrante cuyo contacto se unió mientras tanto cae en el contacto que queda, no en el dado de baja", async () => {
  const kept = await contacto();
  const absorbed = await contacto();
  assert.equal((await unir(kept.id, absorbed.id)).status, 200);

  // El webhook había resuelto el contacto ANTES de la unión.
  const { conversation } = await registrarEntrante({
    organizationId: orgId,
    agentId,
    branchId,
    contactId: absorbed.id,
    channel: "WHATSAPP",
    texto: "Hola",
    externalThreadId: `598${Math.floor(1e7 + Math.random() * 9e7)}`,
    externalMessageId: `wamid.${randomUUID()}`,
  });

  assert.equal(conversation.contactId, kept.id);
  assert.equal(
    await prisma.conversation.count({ where: { organizationId: orgId, contactId: absorbed.id } }),
    0,
  );
});

// FABLE-C-05.
test("FABLE-C-05: si la conversación viva es la del unido, se conserva esa; la que se cierra pierde sus turnos pendientes", async () => {
  const jobDe = async (conversationId: string) => {
    const mensaje = await prisma.message.findFirstOrThrow({ where: { conversationId } });
    return createAgentInboundJob({
      organizationId: orgId,
      messageId: mensaje.id,
      channel: "WHATSAPP",
      channelAccountId: "numero-del-agente",
      externalUserId: "59899000000",
    });
  };
  const kept = await contacto();
  const absorbed = await contacto();
  const vieja = await conversacion(kept.id, "WHATSAPP");
  const jobDeLaVieja = await jobDe(vieja.id);
  // El cliente escribió hace segundos por el número del unido.
  const viva = await conversacion(absorbed.id, "WHATSAPP");
  const jobDeLaViva = await jobDe(viva.id);

  const res = await unir(kept.id, absorbed.id);
  assert.equal(res.status, 200, await res.clone().text());

  const [a, b] = await Promise.all([
    prisma.conversation.findUniqueOrThrow({ where: { id: viva.id } }),
    prisma.conversation.findUniqueOrThrow({ where: { id: vieja.id } }),
  ]);
  assert.equal(a.status, "ACTIVE", "la del último mensaje sigue abierta");
  assert.equal(a.contactId, kept.id);
  assert.equal(b.status, "CLOSED");
  const [pendiente, cancelado] = await Promise.all([
    prisma.agentInboundJob.findUniqueOrThrow({ where: { id: jobDeLaViva.id } }),
    prisma.agentInboundJob.findUniqueOrThrow({ where: { id: jobDeLaVieja.id } }),
  ]);
  assert.equal(pendiente.status, "PENDING", "el turno del mensaje nuevo se va a contestar");
  assert.equal(
    cancelado.status,
    "FAILED",
    "el de la conversación cerrada se cancela, como al cerrarla a mano",
  );
});

// OPUS-C-02 / FABLE-C-03.
test("OPUS-C-02 / FABLE-C-03: el borrado de datos personales alcanza al contacto unido, a sus teléfonos guardados y a su nombre en las notas", async () => {
  const numeroUnido = `598${Math.floor(1e7 + Math.random() * 9e7)}`;
  const kept = await contacto({ firstName: "Juan", lastName: "Pérez" });
  const absorbed = await contacto({
    firstName: "Juana",
    lastName: "Rodríguez",
    email: `juana-${randomUUID().slice(0, 8)}@example.test`,
    phone: `+${numeroUnido}`,
    jobTitle: "Gerente",
    leadNotes: "Quiere financiación",
  });
  assert.equal((await unir(kept.id, absorbed.id, { phone: "kept", email: "kept" })).status, 200);

  // Lo que la unión dejó del unido, antes del borrado.
  const antes = await prisma.contact.findUniqueOrThrow({ where: { id: absorbed.id } });
  assert.equal(antes.firstName, "Juana");
  assert.equal(
    await prisma.contactChannelIdentity.count({
      where: { organizationId: orgId, contactId: kept.id, channel: "WHATSAPP" },
    }),
    1,
  );

  const res = await call("POST", `/api/contacts/${kept.id}/erase-personal-data`, admin.accessToken);
  assert.equal(res.status, 200, await res.clone().text());
  assert.equal(
    ((await res.json()) as { contactosUnidosAnonimizados: number }).contactosUnidosAnonimizados,
    1,
  );

  const unido = await prisma.contact.findUniqueOrThrow({ where: { id: absorbed.id } });
  assert.equal(unido.firstName, MARCADOR_DE_DATO_BORRADO);
  assert.equal(unido.lastName, MARCADOR_DE_DATO_BORRADO);
  assert.equal(unido.email, null);
  assert.equal(unido.phone, null);
  assert.equal(unido.jobTitle, null);
  assert.equal(
    await prisma.contactChannelIdentity.count({
      where: { organizationId: orgId, contactId: kept.id, channel: "WHATSAPP" },
    }),
    0,
    "el teléfono del unido ya no queda guardado como identidad",
  );

  // En ningún lado de lo que cuelga del contacto queda el nombre del unido.
  const elQueQueda = await prisma.contact.findUniqueOrThrow({ where: { id: kept.id } });
  const notas = await prisma.activity.findMany({
    where: { organizationId: orgId, contactId: kept.id, type: "NOTE" },
  });
  const todo = JSON.stringify({ leadNotes: elQueQueda.leadNotes, notas });
  assert.doesNotMatch(todo, /Juana|Rodríguez/);
  assert.match(elQueQueda.leadNotes ?? "", /Quiere financiación/, "la nota en sí se conserva");
  assert.match(notas[0]?.subject ?? "", /^Se unió el contacto \[dato borrado\]$/);

  // Repetirlo no falla.
  const otraVez = await call(
    "POST",
    `/api/contacts/${kept.id}/erase-personal-data`,
    admin.accessToken,
  );
  assert.equal(otraVez.status, 200);
});

test("FABLE-C-06 / OPUS-A-05: la unión no degrada un cliente a lead por defecto, y su nota queda cerrada", async () => {
  const kept = await contacto({ lifecycleStage: "CUSTOMER" });
  // El duplicado se tocó después: con "el más reciente" ganaba LEAD.
  const absorbed = await contacto({ lifecycleStage: "LEAD" });

  const preview = await call(
    "GET",
    `/api/contacts/${kept.id}/merge-preview?with=${absorbed.id}`,
    admin.accessToken,
  );
  const { defaults } = (await preview.json()) as { defaults: Record<string, string> };
  assert.equal(defaults.lifecycleStage, "kept");

  assert.equal((await unir(kept.id, absorbed.id)).status, 200);
  const elQueQueda = await prisma.contact.findUniqueOrThrow({ where: { id: kept.id } });
  assert.equal(elQueQueda.lifecycleStage, "CUSTOMER");

  const [nota] = await prisma.activity.findMany({
    where: { organizationId: orgId, contactId: kept.id, type: "NOTE" },
  });
  assert.ok(nota.completedAt, "es un registro, no una actividad pendiente");
});
