import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { createClient } from "@supabase/supabase-js";
import express from "express";
import { env } from "../config/env";
import { authenticate } from "../middlewares/authenticate";
import { errorHandler } from "../middlewares/errorHandler";
import { notFound } from "../middlewares/notFound";
import { prisma } from "../lib/prisma";
import { getSupabaseAdmin } from "../lib/supabaseAdmin";
import { findRoleByName } from "../repositories/role.repository";
import { getMeHandler } from "./me.controller";

// Test de integración de GET /api/me — HTTP real contra una app Express
// real, montando el `authenticate` real y el controller real, contra
// Postgres/Supabase reales. Sin mocks. Mismo patrón que
// src/middlewares/rateLimit.integration-test.ts (startTestApp local a este
// archivo, sin infraestructura de test compartida — no existe hoy en el
// repo y no corresponde introducirla para este cambio).
//
// Alcance deliberadamente acotado: este archivo prueba únicamente el
// contrato NUEVO que introduce me.controller.ts (el shape exacto de la
// respuesta 200, y que la ruta quedó realmente protegida por
// `authenticate`). No vuelve a probar la verificación de firma/expiración
// del JWT ni las cuatro ramas de resolveAuthContext desde cero — ese
// comportamiento pertenece a authenticate.ts/auth.service.ts, no a este
// controller, y ya se ejercita indirectamente en el resto de la suite de
// integración (rateLimit.integration-test.ts, tenant-isolation.integration-test.ts).
// El único caso 403 de acá existe para confirmar que el status/mensaje se
// hereda tal cual, no para volver a probar resolveAuthContext en sí.

function startTestApp(): Promise<{ url: string; close: () => Promise<void> }> {
  const app = express();
  app.use(express.json());
  app.get("/api/me", authenticate, getMeHandler);
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

// Identidad Supabase + login real + fila real en public.users (organización
// y rol reales) — usuario de negocio completo y válido, para el caso 200.
async function createFixtureUser(label: string, role: "ADMIN" | "USER") {
  const email = `me-${label}-${Date.now()}-${randomUUID().slice(0, 8)}@example.test`;
  const password = "Me-test-password-123!";

  const { data, error } = await getSupabaseAdmin().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`No se pudo crear usuario real de Supabase Auth (${label}): ${error?.message}`);
  }

  const roleRow = await findRoleByName(role);
  if (!roleRow) {
    throw new Error(`No está sembrado el rol ${role}. Abortando.`);
  }

  const org = await prisma.organization.create({
    data: {
      name: `ME test org ${label} ${randomUUID()}`,
      slug: `me-test-org-${label}-${Date.now()}`,
    },
  });

  const fullName = `ME Test ${label}`;
  await prisma.user.create({
    data: {
      id: data.user.id,
      organizationId: org.id,
      roleId: roleRow.id,
      email,
      fullName,
    },
  });

  const anonClient = createClient(env.SUPABASE_URL!, env.SUPABASE_ANON_KEY!);
  const { data: signInData, error: signInError } = await anonClient.auth.signInWithPassword({
    email,
    password,
  });
  if (signInError || !signInData.session) {
    throw new Error(`No se pudo iniciar sesión real (${label}): ${signInError?.message}`);
  }

  return {
    accessToken: signInData.session.access_token,
    authUserId: data.user.id,
    organizationId: org.id,
    email,
    fullName,
    role,
  };
}

// Identidad Supabase + login real, deliberadamente SIN fila en
// public.users — es el fixture más simple y determinista de los tres casos
// 403 posibles (usuario inexistente / desactivado / soft-deleted): no
// requiere ninguna escritura extra en Prisma ni coordinar un orden de
// operaciones, solo omitir el paso que las otras dos ramas sí necesitan.
async function createOrphanAuthUser(label: string) {
  const email = `me-${label}-${Date.now()}-${randomUUID().slice(0, 8)}@example.test`;
  const password = "Me-test-password-123!";

  const { data, error } = await getSupabaseAdmin().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`No se pudo crear usuario real de Supabase Auth (${label}): ${error?.message}`);
  }

  const anonClient = createClient(env.SUPABASE_URL!, env.SUPABASE_ANON_KEY!);
  const { data: signInData, error: signInError } = await anonClient.auth.signInWithPassword({
    email,
    password,
  });
  if (signInError || !signInData.session) {
    throw new Error(`No se pudo iniciar sesión real (${label}): ${signInError?.message}`);
  }

  return { accessToken: signInData.session.access_token, authUserId: data.user.id };
}

test("GET /api/me — usuario de negocio válido: 200 con exactamente id/email/fullName/organizationId/role", async () => {
  const fx = await createFixtureUser("happy", "ADMIN");
  const { url, close } = await startTestApp();
  try {
    const res = await fetch(`${url}/api/me`, {
      headers: { authorization: `Bearer ${fx.accessToken}` },
    });
    assert.equal(res.status, 200);

    const body = (await res.json()) as Record<string, unknown>;
    assert.deepEqual(
      Object.keys(body).sort(),
      ["email", "fullName", "id", "organizationId", "role"],
      "el body no debe incluir isActive/createdAt/updatedAt ni ningún otro campo",
    );
    assert.equal(body.id, fx.authUserId);
    assert.equal(body.email, fx.email);
    assert.equal(body.fullName, fx.fullName);
    assert.equal(body.organizationId, fx.organizationId);
    assert.equal(body.role, fx.role);
  } finally {
    await close();
    await prisma.user.delete({ where: { id: fx.authUserId } });
    await prisma.organization.delete({ where: { id: fx.organizationId } });
    await getSupabaseAdmin().auth.admin.deleteUser(fx.authUserId);
  }
});

test("GET /api/me — sin Authorization: 401 (confirma que la ruta nueva quedó montada detrás de authenticate)", async () => {
  const { url, close } = await startTestApp();
  try {
    const res = await fetch(`${url}/api/me`);
    assert.equal(res.status, 401);
    const body = (await res.json()) as { error?: { message?: string } };
    assert.ok(body.error?.message);
  } finally {
    await close();
  }
});

test("GET /api/me — JWT real sin fila en public.users: 403 heredado tal cual de resolveAuthContext", async () => {
  const orphan = await createOrphanAuthUser("orphan");
  const { url, close } = await startTestApp();
  try {
    const res = await fetch(`${url}/api/me`, {
      headers: { authorization: `Bearer ${orphan.accessToken}` },
    });
    assert.equal(res.status, 403);
    const body = (await res.json()) as { error?: { message?: string } };
    assert.equal(
      body.error?.message,
      "Tu cuenta todavía no está activada. Contactá a tu administrador.",
      "mismo mensaje exacto que resolveAuthContext.ts — este endpoint no introduce semántica nueva",
    );
  } finally {
    await close();
    await getSupabaseAdmin().auth.admin.deleteUser(orphan.authUserId);
  }
});
