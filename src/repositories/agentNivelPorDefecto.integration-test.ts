import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { Prisma, type OrganizationEdition } from "@prisma/client";
import { prisma } from "../lib/prisma";

// ---------------------------------------------------------------------------
// Nivel de participación de la IA por defecto (migración 20261030120000,
// docs/ediciones.md §1.2 "Nivel sin elegir" y §5.4 punto 4, parte "PR 2").
//
// Lo que se prueba es la BASE, no el service: el trigger
// trg_agents_nivel_por_defecto y el CHECK agents_activo_requiere_nivel_check.
// Por eso los agentes se crean con prisma.agent.create directo, sin pasar por
// agent.service: así es como llegan a la base los caminos que no son el
// service (scripts/eval-agente-real.ts y scripts/smoke-qr-followup-whatsapp.ts
// usan prisma.agent.create; el service termina en el mismo INSERT vía
// agent.repository). El camino por la API está en
// agent.controller.integration-test.ts ("POST /api/agents — ADMIN crea con el
// cuerpo mínimo").
//
//   - COMPLETA, sin nivel: el trigger pone AUTONOMA (como antes).
//   - ESENCIAL, sin nivel y activo (is_active en su default true): falla por
//     el CHECK; no queda ninguna fila.
//   - ESENCIAL, sin nivel e inactivo: queda NULL ("sin elegir").
//   - ESENCIAL, con nivel explícito: se respeta (el trigger solo completa NULL).
//   - El CHECK frena un UPDATE que deja activo un agente sin nivel.
//   - Cambiar la edición no toca a los agentes (el trigger es solo de INSERT).
//
// Nadie escribe participation_chosen_at acá: en el PR 2 ningún camino lo
// escribe, y tiene que quedar NULL.
// ---------------------------------------------------------------------------

interface Fx {
  orgId: string;
  branchId: string;
}

const fixtures: Fx[] = [];
let completa: Fx;
let esencial: Fx;

async function organizacion(edition: OrganizationEdition): Promise<Fx> {
  const etiqueta = edition.toLowerCase();
  const org = await prisma.organization.create({
    data: {
      name: `Nivel IA ${etiqueta} ${randomUUID()}`,
      slug: `nivel-ia-${etiqueta}-${Date.now()}-${randomUUID().slice(0, 8)}`,
      edition,
    },
  });
  const branch = await prisma.branch.create({
    data: { organizationId: org.id, name: "Centro", timezone: "America/Montevideo" },
  });
  const fx = { orgId: org.id, branchId: branch.id };
  fixtures.push(fx);
  return fx;
}

// Un agente con lo mínimo, como lo crean los scripts: sin decir nada del nivel
// salvo que el test lo pida.
function crearAgente(fx: Fx, extra: Partial<Prisma.AgentUncheckedCreateInput> = {}) {
  return prisma.agent.create({
    data: {
      organizationId: fx.orgId,
      branchId: fx.branchId,
      name: "Agente",
      instructions: "Sos el agente.",
      modelProvider: "openrouter",
      modelName: "doble/modelo",
      enabledTools: [],
      channels: ["WEB"],
      guardrails: {},
      ...extra,
    },
  });
}

function esElCheckDeNivel(err: unknown): boolean {
  const texto = err instanceof Error ? err.message : String(err);
  return texto.includes("agents_activo_requiere_nivel_check");
}

before(async () => {
  completa = await organizacion("COMPLETA");
  esencial = await organizacion("ESENCIAL");
});

after(async () => {
  for (const fx of fixtures) {
    const where = { organizationId: fx.orgId };
    await prisma.agent.deleteMany({ where });
    await prisma.branch.deleteMany({ where });
    await prisma.organization.delete({ where: { id: fx.orgId } });
  }
});

test("una organización nueva sin edición explícita es COMPLETA", async () => {
  const org = await prisma.organization.create({
    data: {
      name: `Nivel IA default ${randomUUID()}`,
      slug: `nivel-ia-default-${Date.now()}-${randomUUID().slice(0, 8)}`,
    },
  });
  try {
    assert.equal(org.edition, "COMPLETA");
  } finally {
    await prisma.organization.delete({ where: { id: org.id } });
  }
});

test("COMPLETA, sin nivel: el trigger lo completa con AUTONOMA y el agente queda activo, como antes", async () => {
  const agente = await crearAgente(completa);

  assert.equal(agente.isActive, true);
  assert.equal(agente.participation, "AUTONOMA");
  assert.equal(agente.participationChosenAt, null);
  assert.equal(agente.onlyOutsideBusinessHours, false);
});

test("ESENCIAL, sin nivel y activo: el INSERT falla por el CHECK y no deja la fila", async () => {
  const antes = await prisma.agent.count({ where: { organizationId: esencial.orgId } });

  await assert.rejects(() => crearAgente(esencial), esElCheckDeNivel);

  const despues = await prisma.agent.count({ where: { organizationId: esencial.orgId } });
  assert.equal(despues, antes);
});

test("ESENCIAL, sin nivel e inactivo: queda NULL, «sin elegir»", async () => {
  const agente = await crearAgente(esencial, { isActive: false });

  assert.equal(agente.isActive, false);
  assert.equal(agente.participation, null);
  assert.equal(agente.participationChosenAt, null);
});

test("ESENCIAL, con nivel explícito: el trigger no lo pisa", async () => {
  const agente = await crearAgente(esencial, { participation: "PRIMER_CONTACTO" });

  assert.equal(agente.isActive, true);
  assert.equal(agente.participation, "PRIMER_CONTACTO");
});

test("COMPLETA, con nivel explícito: el trigger tampoco lo pisa", async () => {
  const agente = await crearAgente(completa, { participation: "SOLO_SEGUIMIENTO" });

  assert.equal(agente.participation, "SOLO_SEGUIMIENTO");
});

test("el CHECK frena un UPDATE que deja activo un agente sin nivel", async () => {
  const agente = await crearAgente(esencial, { isActive: false });

  await assert.rejects(
    () => prisma.agent.update({ where: { id: agente.id }, data: { isActive: true } }),
    esElCheckDeNivel,
  );
  // Y al revés: sacarle el nivel a un agente activo.
  const activo = await crearAgente(completa);
  await assert.rejects(
    () => prisma.agent.update({ where: { id: activo.id }, data: { participation: null } }),
    esElCheckDeNivel,
  );

  const releido = await prisma.agent.findUniqueOrThrow({ where: { id: agente.id } });
  assert.equal(releido.isActive, false);
});

test("cambiar la edición de la organización no toca a sus agentes", async () => {
  const fx = await organizacion("ESENCIAL");
  const sinNivel = await crearAgente(fx, { isActive: false });

  await prisma.organization.update({ where: { id: fx.orgId }, data: { edition: "COMPLETA" } });

  const releido = await prisma.agent.findUniqueOrThrow({ where: { id: sinNivel.id } });
  assert.equal(releido.participation, null, "subir de edición no le pone nivel");
  assert.equal(releido.isActive, false);

  // Un agente nuevo, ya en COMPLETA, sí lo recibe.
  const nuevo = await crearAgente(fx);
  assert.equal(nuevo.participation, "AUTONOMA");
});
