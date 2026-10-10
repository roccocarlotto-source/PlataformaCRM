import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import type { ConversationChannel, ConversationStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { getSupabaseAdmin } from "../lib/supabaseAdmin";
import { getDashboardDeAtencion } from "./dashboardAtencion.service";

// ---------------------------------------------------------------------------
// Dashboard de atención (docs/ediciones.md §6.4; paso F) contra Postgres real.
// Una organización propia con cada caso que cuenta y cada uno que NO cuenta,
// y un "ahora" fijo: el período es el mes en curso en la zona de la
// organización (America/Montevideo, UTC-3).
// ---------------------------------------------------------------------------

const AHORA = new Date("2026-10-15T15:00:00.000Z");
const DENTRO = new Date("2026-10-10T15:00:00.000Z");
const MES_ANTERIOR = new Date("2026-09-20T15:00:00.000Z");
// 30/9 a las 23:30 en Montevideo = 1/10 02:30 UTC: en UTC ya es octubre, en la
// zona de la organización todavía es septiembre. No cuenta.
const BORDE_DEL_MES = new Date("2026-10-01T02:30:00.000Z");

interface Fx {
  orgId: string;
  branchId: string;
  agentId: string;
  // Autor de las tareas y dueño de la oportunidad (los dos son obligatorios).
  userId: string;
}
let fx: Fx;

async function contacto(extra: { noInterestAt?: Date; deletedAt?: Date } = {}) {
  return prisma.contact.create({
    data: {
      organizationId: fx.orgId,
      firstName: "Ana",
      lastName: randomUUID().slice(0, 8),
      ...extra,
    },
  });
}

async function conversacion(
  contactId: string,
  data: {
    channel?: ConversationChannel;
    status?: ConversationStatus;
    createdAt?: Date;
    transferredToHumanAt?: Date;
  } = {},
) {
  return prisma.conversation.create({
    data: {
      organizationId: fx.orgId,
      branchId: fx.branchId,
      agentId: fx.agentId,
      contactId,
      channel: data.channel ?? "WHATSAPP",
      status: data.status ?? "ACTIVE",
      createdAt: data.createdAt ?? MES_ANTERIOR,
      transferredToHumanAt: data.transferredToHumanAt ?? null,
    },
  });
}

async function mensaje(
  conversationId: string,
  direction: "INBOUND" | "OUTBOUND",
  createdAt: Date,
  extra: { noticeType?: "UNANSWERED_HANDOFF" } = {},
) {
  return prisma.message.create({
    data: {
      organizationId: fx.orgId,
      conversationId,
      direction,
      senderType: direction === "INBOUND" ? "CONTACT" : extra.noticeType ? "AUTOMATION" : "AGENT",
      content: "Hola",
      createdAt,
      ...(extra.noticeType ? { noticeType: extra.noticeType } : {}),
    },
  });
}

before(async () => {
  const org = await prisma.organization.create({
    data: {
      name: `Dashboard atención ${randomUUID()}`,
      slug: `dashboard-atencion-${Date.now()}-${randomUUID().slice(0, 8)}`,
      timezone: "America/Montevideo",
      edition: "ESENCIAL",
    },
  });
  const branch = await prisma.branch.create({
    data: { organizationId: org.id, name: "Centro", timezone: "America/Montevideo" },
  });
  const agent = await prisma.agent.create({
    data: {
      organizationId: org.id,
      branchId: branch.id,
      name: "Agente",
      instructions: "x",
      modelProvider: "openrouter",
      modelName: "doble/modelo",
      enabledTools: [],
      channels: ["WHATSAPP", "WEB"],
      guardrails: {},
      participation: "AUTONOMA",
    },
  });
  // public.users toma el email de auth.users por trigger: primero la identidad.
  const email = `dashboard-atencion-${randomUUID().slice(0, 8)}@example.test`;
  const { data, error } = await getSupabaseAdmin().auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
  const rol = await prisma.role.findUniqueOrThrow({ where: { name: "ADMIN" } });
  await prisma.user.create({
    data: { id: data.user.id, organizationId: org.id, roleId: rol.id, email, fullName: "Dueño" },
  });
  fx = { orgId: org.id, branchId: branch.id, agentId: agent.id, userId: data.user.id };
});

after(async () => {
  if (!fx) return;
  const where = { organizationId: fx.orgId };
  await prisma.inquiryFollowUp.deleteMany({ where });
  await prisma.automation.deleteMany({ where });
  await prisma.message.deleteMany({ where });
  await prisma.conversation.deleteMany({ where });
  await prisma.activity.deleteMany({ where });
  await prisma.opportunity.deleteMany({ where });
  await prisma.stage.deleteMany({ where });
  await prisma.pipeline.deleteMany({ where });
  await prisma.contact.deleteMany({ where });
  await prisma.agent.deleteMany({ where });
  await prisma.branch.deleteMany({ where });
  await prisma.user.deleteMany({ where });
  await prisma.organization.delete({ where: { id: fx.orgId } });
  await getSupabaseAdmin().auth.admin.deleteUser(fx.userId);
});

test("cada métrica cuenta lo que tiene que contar, en el período de la zona de la organización", async () => {
  // --- Conversaciones nuevas: 2 por WhatsApp y 1 por Web en octubre; una de
  // septiembre y una del borde del mes (septiembre en Montevideo) no cuentan.
  const ana = await contacto();
  const wa1 = await conversacion(ana.id, { channel: "WHATSAPP", createdAt: DENTRO });
  await conversacion((await contacto()).id, { channel: "WHATSAPP", createdAt: DENTRO });
  await conversacion((await contacto()).id, { channel: "WEB", createdAt: DENTRO });
  await conversacion((await contacto()).id, { channel: "WEB", createdAt: MES_ANTERIOR });
  await conversacion((await contacto()).id, { channel: "INSTAGRAM", createdAt: BORDE_DEL_MES });

  // --- Derivaciones: 2 en octubre, 1 en septiembre.
  await conversacion((await contacto()).id, { transferredToHumanAt: DENTRO });
  const derivada = await conversacion((await contacto()).id, {
    status: "TRANSFERRED_TO_HUMAN",
    transferredToHumanAt: DENTRO,
  });
  await conversacion((await contacto()).id, { transferredToHumanAt: MES_ANTERIOR });

  // --- Sin respuesta a tiempo: 1 aviso en octubre, 1 en septiembre.
  await mensaje(derivada.id, "OUTBOUND", DENTRO, { noticeType: "UNANSWERED_HANDOFF" });
  await mensaje(derivada.id, "OUTBOUND", MES_ANTERIOR, { noticeType: "UNANSWERED_HANDOFF" });

  // --- Esperando respuesta: el último mensaje es del cliente. Cuenta wa1.
  await mensaje(wa1.id, "OUTBOUND", MES_ANTERIOR);
  await mensaje(wa1.id, "INBOUND", DENTRO);
  // No cuentan: última palabra del negocio; cerrada; "sin interés"; contacto
  // con una oportunidad abierta.
  const respondida = await conversacion((await contacto()).id);
  await mensaje(respondida.id, "INBOUND", MES_ANTERIOR);
  await mensaje(respondida.id, "OUTBOUND", DENTRO);
  const cerrada = await conversacion((await contacto()).id, { status: "CLOSED" });
  await mensaje(cerrada.id, "INBOUND", DENTRO);
  const sinInteres = await conversacion((await contacto({ noInterestAt: DENTRO })).id);
  await mensaje(sinInteres.id, "INBOUND", DENTRO);
  const conOportunidad = await contacto();
  const conversacionConOportunidad = await conversacion(conOportunidad.id);
  await mensaje(conversacionConOportunidad.id, "INBOUND", DENTRO);
  const pipeline = await prisma.pipeline.create({
    data: { organizationId: fx.orgId, name: "Ventas", isDefault: true },
  });
  const etapa = await prisma.stage.create({
    data: { organizationId: fx.orgId, pipelineId: pipeline.id, name: "En curso", order: 1 },
  });

  // --- Seguimientos agendados: 1 PENDING, 1 SENT (no cuenta).
  const regla = await prisma.automation.create({
    data: {
      organizationId: fx.orgId,
      name: "Seguimiento",
      triggerType: "contact.inquiry_stalled",
      actionType: "inquiry.follow_up",
      actionConfig: {},
    },
  });
  for (const status of ["PENDING", "SENT"] as const) {
    await prisma.inquiryFollowUp.create({
      data: {
        organizationId: fx.orgId,
        automationId: regla.id,
        contactId: ana.id,
        conversationId: wa1.id,
        branchId: fx.branchId,
        channel: "WHATSAPP",
        outboxEventId: randomUUID(),
        kind: "WHATSAPP",
        lastInboundAt: DENTRO,
        scheduledFor: AHORA,
        nextAttemptAt: AHORA,
        status,
      },
    });
  }

  // --- Tareas vencidas: 1. No cuentan: completada, futura, sin fecha, NOTE,
  // dada de baja.
  const tarea = (data: {
    dueDate?: Date;
    completedAt?: Date;
    deletedAt?: Date;
    type?: "TASK" | "NOTE";
  }) =>
    prisma.activity.create({
      data: {
        organizationId: fx.orgId,
        type: "TASK",
        subject: "Llamar",
        contactId: ana.id,
        authorId: fx.userId,
        ...data,
      },
    });
  await tarea({ dueDate: DENTRO });
  await tarea({ dueDate: DENTRO, completedAt: DENTRO });
  await tarea({ dueDate: new Date("2026-10-20T15:00:00.000Z") });
  await tarea({});
  await tarea({ dueDate: DENTRO, deletedAt: DENTRO });
  await tarea({ dueDate: DENTRO, type: "NOTE" });

  const r = await getDashboardDeAtencion(fx.orgId, { granularity: "month", now: AHORA });

  assert.equal(r.periodo.start, "2026-10-01T03:00:00.000Z");
  assert.deepEqual(r.conversacionesNuevas, {
    total: 3,
    porCanal: { WHATSAPP: 2, WEB: 1, INSTAGRAM: 0, MESSENGER: 0 },
  });
  assert.equal(r.derivaciones, 2);
  assert.equal(r.derivacionesSinRespuesta, 1);
  // wa1 y la de "con oportunidad" (la oportunidad todavía no existe).
  assert.equal(r.consultasPendientes.esperandoRespuesta, 2);
  assert.equal(r.consultasPendientes.seguimientosAgendados, 1);
  assert.equal(r.tareasVencidas, 1);

  // Con la oportunidad abierta, esa consulta ya tiene quien la siga.
  await prisma.opportunity.create({
    data: {
      organizationId: fx.orgId,
      title: "Hilux",
      contactId: conOportunidad.id,
      pipelineId: pipeline.id,
      stageId: etapa.id,
      ownerId: fx.userId,
    },
  });
  const r2 = await getDashboardDeAtencion(fx.orgId, { granularity: "month", now: AHORA });
  assert.equal(r2.consultasPendientes.esperandoRespuesta, 1);
});

test("otra organización no se mezcla: sus conversaciones no cuentan acá", async () => {
  const otra = await prisma.organization.create({
    data: {
      name: `Dashboard atención otra ${randomUUID()}`,
      slug: `dashboard-atencion-${Date.now()}-${randomUUID().slice(0, 8)}`,
    },
  });
  try {
    const antes = await getDashboardDeAtencion(fx.orgId, { granularity: "month", now: AHORA });
    const vacio = await getDashboardDeAtencion(otra.id, { granularity: "month", now: AHORA });
    assert.equal(vacio.conversacionesNuevas.total, 0);
    assert.equal(vacio.tareasVencidas, 0);
    const despues = await getDashboardDeAtencion(fx.orgId, { granularity: "month", now: AHORA });
    assert.deepEqual(despues, antes);
  } finally {
    await prisma.organization.delete({ where: { id: otra.id } });
  }
});
