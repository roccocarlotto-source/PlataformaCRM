import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { createClient } from "@supabase/supabase-js";
import express from "express";
import { env } from "../config/env";
import { getMeHandler } from "../controllers/me.controller";
import { prisma } from "../lib/prisma";
import { getSupabaseAdmin } from "../lib/supabaseAdmin";
import { authenticate } from "../middlewares/authenticate";
import { errorHandler } from "../middlewares/errorHandler";
import { notFound } from "../middlewares/notFound";
import type { JwtPayload } from "../types/auth";
import { AppError } from "../utils/AppError";
import { resolveAuthContext } from "./auth.service";

// ---------------------------------------------------------------------------
// El séptimo sitio de §28.7 de docs/bitacora-2026-08-29.md (M-11 b): un
// usuario cuyo rol tiene un `name` fuera de RoleName. Role.name es un string
// en la base, no un enum de Postgres, así que la fila se puede crear; es el
// invariante de datos roto que resolveAuthContext detecta con isRoleName().
//
// Dos niveles: la función directa (fija que el AppError lleva
// isOperational: false) y HTTP real —authenticate + errorHandler— con un JWT
// real de Supabase Auth, mismo fixture que me.controller.integration-test
// (fija que el nombre del rol corrupto NO llega al cliente).
// ---------------------------------------------------------------------------

const PASSWORD = "Auth-test-password-123!";
const ROL_CORRUPTO = `ROGUE_${randomUUID().slice(0, 8).toUpperCase()}`;

let orgId: string;
let roleId: string;
let authUserId: string;
let accessToken: string;
let baseUrl: string;
let closeApp: () => Promise<void>;

function startTestApp(): Promise<{ url: string; close: () => Promise<void> }> {
  const app = express();
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

before(async () => {
  const started = await startTestApp();
  baseUrl = started.url;
  closeApp = started.close;

  const email = `auth-rogue-${Date.now()}-${randomUUID().slice(0, 8)}@example.test`;
  const { data, error } = await getSupabaseAdmin().auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`No se pudo crear el usuario de Supabase Auth: ${error?.message}`);
  }
  authUserId = data.user.id;

  const role = await prisma.role.create({
    data: { name: ROL_CORRUPTO, description: "Rol fuera de RoleName, solo para este test" },
    select: { id: true },
  });
  roleId = role.id;

  const org = await prisma.organization.create({
    data: {
      name: `Auth rogue org ${randomUUID()}`,
      slug: `auth-rogue-${Date.now()}-${randomUUID().slice(0, 8)}`,
    },
  });
  orgId = org.id;

  await prisma.user.create({
    data: { id: authUserId, organizationId: orgId, roleId, email, fullName: "Rol Corrupto" },
  });

  const anon = createClient(env.SUPABASE_URL!, env.SUPABASE_ANON_KEY!);
  const { data: sesion, error: errorLogin } = await anon.auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  if (errorLogin || !sesion.session) {
    throw new Error(`No se pudo iniciar sesión: ${errorLogin?.message}`);
  }
  accessToken = sesion.session.access_token;
});

after(async () => {
  if (closeApp) await closeApp();
  if (orgId) {
    await prisma.user.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
  }
  if (roleId) await prisma.role.deleteMany({ where: { id: roleId } });
  if (authUserId) await getSupabaseAdmin().auth.admin.deleteUser(authUserId);
});

test("resolveAuthContext con un rol fuera de RoleName lanza AppError 500 con isOperational: false", async () => {
  let capturado: unknown;
  try {
    await resolveAuthContext({ sub: authUserId } as JwtPayload);
  } catch (err) {
    capturado = err;
  }

  assert.ok(capturado instanceof AppError, String(capturado));
  assert.equal(capturado.statusCode, 500);
  assert.equal(capturado.isOperational, false);
  // El mensaje sigue diciendo cuál es el rol corrupto — para el log.
  assert.equal(capturado.message, `Rol desconocido: ${ROL_CORRUPTO}`);
});

test("por HTTP, con JWT real, el 500 es genérico y el nombre del rol corrupto no llega al cliente", async () => {
  const res = await fetch(`${baseUrl}/api/me`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });

  assert.equal(res.status, 500);
  const body = (await res.json()) as { error: { message: string; stack?: string } };
  assert.equal(body.error.message, "Error interno del servidor");
  assert.ok(!body.error.message.includes(ROL_CORRUPTO));
  // Fuera de desarrollo no viaja ni el stack; en desarrollo sí, a propósito.
  if (!env.isDevelopment) {
    assert.ok(!JSON.stringify(body).includes(ROL_CORRUPTO));
  }
});
