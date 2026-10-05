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
import { FKS_A_CONTACTS } from "../services/contactMerge.service";
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

test("dos conversaciones abiertas con el mismo agente y canal: la del unido se cierra y se mueve; la del que queda sigue abierta", async () => {
  const kept = await contacto();
  const absorbed = await contacto();
  const delQueQueda = await conversacion(kept.id, "WHATSAPP");
  const delUnido = await conversacion(absorbed.id, "WHATSAPP");

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
