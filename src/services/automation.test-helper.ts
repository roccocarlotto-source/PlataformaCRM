import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { getSupabaseAdmin } from "../lib/supabaseAdmin";
import { findRoleByName } from "../repositories/role.repository";
import { emitOutboxEvent } from "../repositories/outboxEvent.repository";
import { ACTION_CREATE_FOLLOW_UP } from "./automationActions/createFollowUpActivity";
import { TRIGGER_OPPORTUNITY_WON } from "./automationTriggers";
import type { EventoAEntregar } from "./outboxHandlers";
import { createPipeline } from "./pipeline.service";
import { createStage } from "./stage.service";

// ---------------------------------------------------------------------------
// Escenarios del motor de automatizaciones para sus tests de integración
// (automationDispatch, automationOpportunityWon, automationOpportunityStale,
// opportunityStaleWorker). SOLO PARA TESTS: el nombre
// *.test-helper.ts lo deja fuera del build, igual que vehicle.test-helper.ts.
//
// Una organización con su ADMIN (usuario real de Supabase Auth: users.id
// comparte valor con auth.users.id, y createActivity exige que el assignee
// exista y esté activo) más el pipeline/stage/company que Opportunity exige.
// desmontar borra en el orden que las FK RESTRICT exigen.
//
// CADA TEST TRAE SU PROPIA ORGANIZACIÓN y drena el outbox acotado a ella:
// el runner corre los archivos de integración en paralelo contra una base
// compartida.
// ---------------------------------------------------------------------------

export interface Escenario {
  organizationId: string;
  userId: string;
  authUserId: string;
  pipelineId: string;
  stageId: string;
  companyId: string;
}

async function createRealAuthUser(label: string) {
  const email = `auto-${label}-${Date.now()}-${randomUUID().slice(0, 8)}@example.test`;
  const { data, error } = await getSupabaseAdmin().auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`No se pudo crear usuario real de Supabase Auth (${label}): ${error?.message}`);
  }
  return { id: data.user.id, email };
}

// Un segundo (o tercer) usuario ADMIN en la misma organización — para los
// casos que reasignan la oportunidad. Devuelve su id; desmontar lo limpia
// junto con el resto de los usuarios de la organización.
export async function crearUsuario(e: Escenario, etiqueta: string) {
  const adminRole = await findRoleByName("ADMIN");
  if (!adminRole) {
    throw new Error("No está sembrado el rol ADMIN. Abortando.");
  }
  const auth = await createRealAuthUser(etiqueta);
  const user = await prisma.user.create({
    data: {
      id: auth.id,
      organizationId: e.organizationId,
      roleId: adminRole.id,
      email: auth.email,
      fullName: `Usuario ${etiqueta}`,
    },
  });
  authUsersExtra.push(auth.id);
  return user.id;
}

const authUsersExtra: string[] = [];

export async function montar(etiqueta: string): Promise<Escenario> {
  const adminRole = await findRoleByName("ADMIN");
  if (!adminRole) {
    throw new Error("No está sembrado el rol ADMIN. Abortando.");
  }
  const org = await prisma.organization.create({
    data: {
      name: `Automation ${etiqueta} ${randomUUID()}`,
      slug: `auto-${etiqueta}-${Date.now()}-${randomUUID().slice(0, 8)}`,
    },
  });
  const auth = await createRealAuthUser(etiqueta);
  const user = await prisma.user.create({
    data: {
      id: auth.id,
      organizationId: org.id,
      roleId: adminRole.id,
      email: auth.email,
      fullName: `Admin ${etiqueta}`,
    },
  });
  const pipeline = await createPipeline(org.id, { name: "Ventas" });
  const stage = await createStage(org.id, { pipelineId: pipeline.id, name: "Contacto" });
  const company = await prisma.company.create({
    data: { organizationId: org.id, name: "Cliente" },
  });
  return {
    organizationId: org.id,
    userId: user.id,
    authUserId: auth.id,
    pipelineId: pipeline.id,
    stageId: stage.id,
    companyId: company.id,
  };
}

export async function desmontar(...escenarios: Escenario[]) {
  for (const e of escenarios) {
    const where = { organizationId: e.organizationId };
    await prisma.automationExecution.deleteMany({ where });
    await prisma.automation.deleteMany({ where });
    await prisma.activity.deleteMany({ where });
    await prisma.opportunity.deleteMany({ where });
    await prisma.outboxEvent.deleteMany({ where });
    // Lo que arma el caso "con conversación" del ítem 76. Vacío en el resto de
    // los escenarios, y deleteMany sobre nada no cuesta nada.
    await prisma.message.deleteMany({ where });
    await prisma.conversation.deleteMany({ where });
    await prisma.agent.deleteMany({ where });
    await prisma.contact.deleteMany({ where });
    await prisma.branch.deleteMany({ where });
    await prisma.stage.deleteMany({ where });
    await prisma.pipeline.deleteMany({ where });
    await prisma.company.deleteMany({ where });
    await prisma.user.deleteMany({ where });
    await prisma.organization.delete({ where: { id: e.organizationId } });
    await getSupabaseAdmin().auth.admin.deleteUser(e.authUserId);
  }
  for (const authUserId of authUsersExtra.splice(0)) {
    await getSupabaseAdmin().auth.admin.deleteUser(authUserId);
  }
}

// Una regla directamente en la base, sin pasar por el CRUD: estos tests prueban
// el despacho, no la validación (que tiene su propio archivo por HTTP). Por
// default, la regla real del primer caso; `extra` pisa lo que haga falta.
export function crearRegla(
  e: Escenario,
  extra: Partial<Prisma.AutomationUncheckedCreateInput> = {},
) {
  return prisma.automation.create({
    data: {
      organizationId: e.organizationId,
      name: "Seguimiento post-venta",
      triggerType: TRIGGER_OPPORTUNITY_WON,
      actionType: ACTION_CREATE_FOLLOW_UP,
      actionConfig: { subject: "Llamar para agradecer la compra", daysUntilDue: 3 },
      ...extra,
    },
  });
}

// Emite un evento en su propia transacción. Producción NUNCA hace esto —el
// evento va dentro de la transacción del cambio de negocio— pero un test que
// solo quiere una fila en la cola no tiene ningún cambio que acompañar. Mismo
// helper que outboxWorker.integration-test.ts.
export function emitir(e: Escenario, eventType: string, payload: Prisma.InputJsonValue = {}) {
  return prisma.$transaction((tx) =>
    emitOutboxEvent({ organizationId: e.organizationId, eventType, payload }, tx),
  );
}

// El EventoAEntregar que el outbox le pasaría al handler, armado a mano desde
// la fila, para llamar al dispatcher directo sin pasar por el worker.
export function eventoAEntregar(fila: {
  id: string;
  organizationId: string;
  eventType: string;
  payload: unknown;
}): EventoAEntregar {
  return {
    id: fila.id,
    organizationId: fila.organizationId,
    eventType: fila.eventType,
    payload: fila.payload,
    signal: new AbortController().signal,
  };
}

export function ejecucionesDe(automationId: string) {
  return prisma.automationExecution.findMany({
    where: { automationId },
    orderBy: { executedAt: "asc" },
  });
}

export function actividadesDe(e: Escenario) {
  return prisma.activity.findMany({
    where: { organizationId: e.organizationId },
    orderBy: { createdAt: "asc" },
  });
}

export function eventosDe(e: Escenario, eventType = TRIGGER_OPPORTUNITY_WON) {
  return prisma.outboxEvent.findMany({
    where: { organizationId: e.organizationId, eventType },
    orderBy: { createdAt: "asc" },
  });
}
