import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import express, { type NextFunction, type Request, type Response } from "express";
import { listLlmUsageHandler } from "../controllers/organizationAdmin.controller";
import { prisma } from "../lib/prisma";
import { errorHandler } from "../middlewares/errorHandler";
import { notFound } from "../middlewares/notFound";
import { requirePlatformAdmin } from "../middlewares/requirePlatformAdmin";
import {
  gastoPorOrganizacion,
  registrarUsoDelTurno,
  sumarUso,
  usoVacio,
} from "../services/llmUsage.service";
import type { AuthContext } from "../types/auth";
import { AppError } from "../utils/AppError";
import {
  countLlmTurnUsagesPurgables,
  DIAS_DE_RETENCION_LLM_TURN_USAGE,
  fechaDeCorteDeRetencionLlmTurnUsage,
  purgeLlmTurnUsages,
} from "./llmTurnUsage.repository";

// ---------------------------------------------------------------------------
// Uso del modelo por turno (B4, migración 20261023120000), contra Postgres:
//   1. registrarUsoDelTurno deja UNA fila por turno con la organización, el
//      agente, el canal, el modelo, los tokens y el costo (null si no vino).
//   2. gastoPorOrganizacion suma los últimos N días por organización, con las
//      que no gastaron en cero, y no mezcla organizaciones.
//   3. La purga borra solo lo más viejo que la retención.
//   4. GET /api/admin/llm-usage: platform admin -> 200 con el gasto; un ADMIN
//      común -> 403.
// ---------------------------------------------------------------------------

let orgA: { id: string; name: string };
let orgB: { id: string; name: string };
let baseUrl: string;
let closeApp: () => Promise<void>;
let identidad: AuthContext | undefined;

function stubAuthenticate(req: Request, _res: Response, next: NextFunction): void {
  if (!identidad) {
    next(new AppError("Falta el token de autenticación", 401));
    return;
  }
  req.auth = identidad;
  next();
}

async function crearOrganizacion(etiqueta: string) {
  return prisma.organization.create({
    data: {
      name: `LLM uso ${etiqueta} ${randomUUID().slice(0, 8)}`,
      slug: `llm-uso-${etiqueta}-${Date.now()}-${randomUUID().slice(0, 8)}`,
    },
    select: { id: true, name: true },
  });
}

before(async () => {
  orgA = await crearOrganizacion("a");
  orgB = await crearOrganizacion("b");
  const app = express();
  app.get("/api/admin/llm-usage", stubAuthenticate, requirePlatformAdmin, listLlmUsageHandler);
  app.use(notFound);
  app.use(errorHandler);
  await new Promise<void>((resolve) => {
    const server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      closeApp = () => new Promise((r) => server.close(() => r()));
      resolve();
    });
  });
});

after(async () => {
  if (closeApp) await closeApp();
  const ids = [orgA?.id, orgB?.id].filter(Boolean) as string[];
  await prisma.llmTurnUsage.deleteMany({ where: { organizationId: { in: ids } } });
  await prisma.organization.deleteMany({ where: { id: { in: ids } } });
});

function usoDe(promptTokens: number, completionTokens: number, costUsd: number | null) {
  const uso = usoVacio();
  sumarUso(uso, { promptTokens, completionTokens, costUsd });
  return uso;
}

test("registrarUsoDelTurno deja una fila por turno con todo lo del turno; sin costo, cost_usd queda null", async () => {
  const conversationId = randomUUID();
  const agentId = randomUUID();
  await registrarUsoDelTurno({
    organizationId: orgA.id,
    agentId,
    conversationId,
    channel: "MESSENGER",
    model: "proveedor/modelo",
    uso: usoDe(900, 60, 0.0003),
  });
  await registrarUsoDelTurno({
    organizationId: orgA.id,
    agentId,
    conversationId,
    channel: "MESSENGER",
    model: "proveedor/modelo",
    uso: usoDe(100, 10, null),
  });

  const filas = await prisma.llmTurnUsage.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
  });
  assert.equal(filas.length, 2);
  assert.equal(filas[0].organizationId, orgA.id);
  assert.equal(filas[0].agentId, agentId);
  assert.equal(filas[0].channel, "MESSENGER");
  assert.equal(filas[0].model, "proveedor/modelo");
  assert.equal(filas[0].calls, 1);
  assert.equal(filas[0].promptTokens, 900);
  assert.equal(filas[0].completionTokens, 60);
  assert.equal(Number(filas[0].costUsd), 0.0003);
  assert.equal(filas[1].costUsd, null);
});

test("gastoPorOrganizacion: suma los últimos 30 días por organización, las sin gasto en cero, sin mezclar", async () => {
  await registrarUsoDelTurno({
    organizationId: orgB.id,
    agentId: randomUUID(),
    conversationId: randomUUID(),
    channel: "WEB",
    model: "proveedor/modelo",
    uso: usoDe(50, 5, 0.001),
  });
  // Una fila vieja de A, fuera de la ventana: no cuenta.
  await prisma.llmTurnUsage.create({
    data: {
      organizationId: orgA.id,
      agentId: randomUUID(),
      conversationId: randomUUID(),
      channel: "WHATSAPP",
      model: "proveedor/modelo",
      calls: 1,
      promptTokens: 100_000,
      completionTokens: 100_000,
      costUsd: 99,
      createdAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
    },
  });

  const gasto = await gastoPorOrganizacion(30);
  const a = gasto.find((g) => g.organizationId === orgA.id);
  const b = gasto.find((g) => g.organizationId === orgB.id);
  assert.deepEqual(a, {
    organizationId: orgA.id,
    organizationName: orgA.name,
    turnos: 2,
    promptTokens: 1000,
    completionTokens: 70,
    costUsd: 0.0003,
  });
  assert.deepEqual(b, {
    organizationId: orgB.id,
    organizationName: orgB.name,
    turnos: 1,
    promptTokens: 50,
    completionTokens: 5,
    costUsd: 0.001,
  });
  // B gastó más: va antes.
  assert.ok(gasto.indexOf(b!) < gasto.indexOf(a!));
});

test("la purga borra solo lo más viejo que la retención, y --dry-run cuenta lo mismo que borra", async () => {
  const vieja = await prisma.llmTurnUsage.create({
    data: {
      organizationId: orgA.id,
      agentId: randomUUID(),
      conversationId: randomUUID(),
      channel: "WHATSAPP",
      model: "proveedor/modelo",
      calls: 1,
      promptTokens: 1,
      completionTokens: 1,
      createdAt: new Date(
        Date.now() - (DIAS_DE_RETENCION_LLM_TURN_USAGE + 10) * 24 * 60 * 60 * 1000,
      ),
    },
  });
  const corte = fechaDeCorteDeRetencionLlmTurnUsage();
  const scope = { organizationId: orgA.id };
  assert.equal(await countLlmTurnUsagesPurgables(corte, scope), 1);
  const { count } = await purgeLlmTurnUsages(corte, scope);
  assert.equal(count, 1);
  assert.equal(await prisma.llmTurnUsage.findUnique({ where: { id: vieja.id } }), null);
  // Las recientes siguen.
  assert.ok((await prisma.llmTurnUsage.count({ where: { organizationId: orgA.id } })) >= 3);
});

test("GET /api/admin/llm-usage: platform admin -> 200 con el gasto por organización; un ADMIN común -> 403", async () => {
  identidad = {
    userId: randomUUID(),
    organizationId: orgA.id,
    role: "ADMIN",
    email: "admin@example.test",
    fullName: "Admin",
    edition: "COMPLETA",
    industry: "AUTOMOTORA",
  };
  assert.equal((await fetch(`${baseUrl}/api/admin/llm-usage`)).status, 403);

  const admin = await prisma.platformAdmin.create({ data: { userId: randomUUID() } });
  try {
    identidad = { ...identidad, userId: admin.userId };
    const res = await fetch(`${baseUrl}/api/admin/llm-usage`);
    assert.equal(res.status, 200);
    const cuerpo = (await res.json()) as {
      dias: number;
      organizaciones: { organizationId: string; turnos: number; costUsd: number | null }[];
    };
    assert.equal(cuerpo.dias, 30);
    const b = cuerpo.organizaciones.find((o) => o.organizationId === orgB.id);
    assert.equal(b?.turnos, 1);
    assert.equal(b?.costUsd, 0.001);
  } finally {
    await prisma.platformAdmin.delete({ where: { userId: admin.userId } });
  }
});
