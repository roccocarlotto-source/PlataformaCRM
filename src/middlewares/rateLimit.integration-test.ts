import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { createClient } from "@supabase/supabase-js";
import express from "express";
import { env } from "../config/env";
import { acceptInvitationHandler } from "../controllers/invitation.controller";
import { createOnboarding } from "../controllers/onboarding.controller";
import { prisma } from "../lib/prisma";
import { getSupabaseAdmin } from "../lib/supabaseAdmin";
import { findRoleByName } from "../repositories/role.repository";
import { slugify } from "../utils/slug";
import { errorHandler } from "./errorHandler";
import { notFound } from "./notFound";
import {
  ACCEPT_IDENTITY_MAX,
  ACCEPT_PRE_AUTH_MAX,
  ONBOARDING_MAX,
  createAcceptInvitationRateLimiter,
  createAcceptPreAuthRateLimiter,
  createBusinessWriteRateLimiter,
  createOnboardingRateLimiter,
} from "./rateLimit";
import { verifyInvitationAcceptIdentity } from "./verifyInvitationAcceptIdentity";
import type { AuthContext } from "../types/auth";

// Test de integración de M1 (rate limiting) — HTTP real contra apps
// Express reales, montando los middlewares/controllers reales, contra
// Postgres/Supabase reales. Sin mocks de la librería ni de Prisma.
//
// Cada test levanta su propia app + su propia instancia de los limiters
// (vía las factories create*RateLimiter, no las instancias singleton que
// usan las rutas de producción) para tener un MemoryStore aislado por
// caso — necesario porque no hay forma de variar la IP entre requests del
// mismo proceso de test sin confiar en X-Forwarded-For, cosa que la app
// deliberadamente no hace (ver rateLimit.ts).

function startTestApp(
  mount: (app: express.Express) => void,
): Promise<{ url: string; close: () => Promise<void> }> {
  const app = express();
  app.use(express.json());
  mount(app);
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

// Solo crea la identidad en Supabase Auth (Admin API) — usado cuando el
// test necesita un User real (FK de Invitation.invitedById, trigger de
// sync de email) pero no necesita loguearse con esa identidad.
async function createRealAuthUser(label: string) {
  const email = `m1-test-${label}-${Date.now()}-${randomUUID().slice(0, 8)}@example.test`;
  const { data, error } = await getSupabaseAdmin().auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`No se pudo crear usuario real de Supabase Auth (${label}): ${error?.message}`);
  }
  return { id: data.user.id, email };
}

// Crea la identidad Y hace un login real (signInWithPassword) para obtener
// un JWT genuinamente emitido por Supabase — nunca un token fabricado a
// mano (mismo criterio ya documentado en docs/project-overview.md sección
// 9: cualquier verificación de auth debe probarse contra un login real).
async function createRealAuthUserWithJwt(label: string) {
  const email = `m1-test-${label}-${Date.now()}-${randomUUID().slice(0, 8)}@example.test`;
  const password = "M1-test-password-123!";

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

  return {
    authUserId: data.user.id,
    email,
    accessToken: signInData.session.access_token,
  };
}

// ---------------------------------------------------------------------------
// Onboarding
// ---------------------------------------------------------------------------

function mountOnboarding(app: express.Express) {
  app.post("/api/onboarding", createOnboardingRateLimiter(), createOnboarding);
}

test("onboardingRateLimiter: cuenta intentos con body válido y bloquea el excedente con 429 + Retry-After", async () => {
  const candidateName = `M1 Onboarding Dup ${randomUUID()}`;
  const dupSlug = slugify(candidateName);
  const dupOrg = await prisma.organization.create({
    data: { name: "M1 existing org", slug: dupSlug },
  });

  const { url, close } = await startTestApp(mountOnboarding);
  try {
    const body = {
      organizationName: candidateName, // slugify(candidateName) === dupSlug -> 409 local, nunca toca Supabase
      fullName: "Test User",
      email: `m1-onboarding-${randomUUID()}@example.test`,
      password: "password123",
    };

    for (let i = 0; i < ONBOARDING_MAX; i++) {
      const res = await fetch(`${url}/api/onboarding`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      assert.equal(
        res.status,
        409,
        `intento ${i + 1}/${ONBOARDING_MAX} debería contar (409 por slug duplicado), no bloquearse`,
      );
    }

    const blocked = await fetch(`${url}/api/onboarding`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    assert.equal(blocked.status, 429);
    assert.ok(blocked.headers.get("retry-after"), "el 429 debe incluir Retry-After");
    const payload = (await blocked.json()) as { error?: { message?: string } };
    assert.ok(
      payload.error?.message,
      "el 429 debe tener el mismo shape { error: { message } } que errorHandler.ts",
    );
  } finally {
    await close();
    await prisma.organization.delete({ where: { id: dupOrg.id } });
  }
});

test("onboardingRateLimiter: body Zod-inválido no consume cupo", async () => {
  const candidateName = `M1 Onboarding Probe ${randomUUID()}`;
  const dupSlug = slugify(candidateName);
  const dupOrg = await prisma.organization.create({
    data: { name: "M1 existing org probe", slug: dupSlug },
  });

  const { url, close } = await startTestApp(mountOnboarding);
  try {
    for (let i = 0; i < ONBOARDING_MAX + 5; i++) {
      const res = await fetch(`${url}/api/onboarding`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        // Falta email -> Zod-inválido.
        body: JSON.stringify({
          organizationName: "x",
          fullName: "y",
          password: "password123",
        }),
      });
      assert.equal(res.status, 400);
    }

    const probe = await fetch(`${url}/api/onboarding`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        organizationName: candidateName,
        fullName: "Test User",
        email: `m1-probe-${randomUUID()}@example.test`,
        password: "password123",
      }),
    });
    assert.equal(
      probe.status,
      409,
      "un body válido después de varios inválidos debe evaluarse normalmente (409 por slug duplicado), no 429",
    );
  } finally {
    await close();
    await prisma.organization.delete({ where: { id: dupOrg.id } });
  }
});

test("onboardingRateLimiter: un request real dentro del cupo completa el flujo de onboarding sin fricción", async () => {
  const { url, close } = await startTestApp(mountOnboarding);
  let orgId: string | undefined;
  let authUserId: string | undefined;
  try {
    const res = await fetch(`${url}/api/onboarding`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        organizationName: `M1 Onboarding Happy ${randomUUID()}`,
        fullName: "Happy Path",
        email: `m1-happy-onboarding-${randomUUID()}@example.test`,
        password: "password123",
      }),
    });
    assert.equal(res.status, 201);
    const payload = (await res.json()) as {
      organization: { id: string };
      user: { id: string };
    };
    orgId = payload.organization.id;
    authUserId = payload.user.id;
  } finally {
    await close();
    if (orgId) {
      await prisma.user.deleteMany({ where: { organizationId: orgId } });
      await prisma.organization.delete({ where: { id: orgId } });
    }
    if (authUserId) {
      await getSupabaseAdmin().auth.admin.deleteUser(authUserId);
    }
  }
});

// ---------------------------------------------------------------------------
// Invitation accept — limiter pre-auth (etapa 1), mecánica aislada
// ---------------------------------------------------------------------------

function mountPreAuthOnly(app: express.Express) {
  app.post("/x", createAcceptPreAuthRateLimiter(), (_req, res) => {
    res.status(200).json({ ok: true });
  });
}

test("acceptPreAuthRateLimiter: cuenta todo request sin excepción y bloquea el excedente con 429 + Retry-After", async () => {
  const { url, close } = await startTestApp(mountPreAuthOnly);
  try {
    for (let i = 0; i < ACCEPT_PRE_AUTH_MAX; i++) {
      const res = await fetch(`${url}/x`, { method: "POST" });
      assert.equal(res.status, 200, `intento ${i + 1} debería pasar`);
    }
    const blocked = await fetch(`${url}/x`, { method: "POST" });
    assert.equal(blocked.status, 429);
    assert.ok(blocked.headers.get("retry-after"));
  } finally {
    await close();
  }
});

// ---------------------------------------------------------------------------
// Invitation accept — cadena completa real (las dos etapas + identidad)
// ---------------------------------------------------------------------------

function mountFullAcceptChain(app: express.Express) {
  app.post(
    "/api/invitations/accept",
    createAcceptPreAuthRateLimiter(),
    verifyInvitationAcceptIdentity,
    createAcceptInvitationRateLimiter(),
    acceptInvitationHandler,
  );
}

test("cadena completa: el limiter pre-auth bloquea incluso a una identidad real y válida una vez agotado", async () => {
  const identity = await createRealAuthUserWithJwt("preauth-block");
  const { url, close } = await startTestApp(mountFullAcceptChain);
  try {
    for (let i = 0; i < ACCEPT_PRE_AUTH_MAX; i++) {
      const res = await fetch(`${url}/api/invitations/accept`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fullName: "x" }),
      });
      assert.equal(
        res.status,
        401,
        `intento sin token ${i + 1}/${ACCEPT_PRE_AUTH_MAX} debería contar (401), no bloquearse todavía`,
      );
    }

    // Un JWT real y válido, con invitationId inexistente (Zod-válido) —
    // si el pre-auth no estuviera agotado, esto daría 404, nunca 429.
    const blocked = await fetch(`${url}/api/invitations/accept`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${identity.accessToken}`,
      },
      body: JSON.stringify({ fullName: "Real Identity", invitationId: randomUUID() }),
    });
    assert.equal(
      blocked.status,
      429,
      "el pre-auth agotado debe bloquear incluso a una identidad real y válida, antes de intentar verificar el JWT",
    );
  } finally {
    await close();
    await getSupabaseAdmin().auth.admin.deleteUser(identity.authUserId);
  }
});

test("acceptInvitationRateLimiter: cuenta intentos válidos de una identidad y bloquea el excedente con 429", async () => {
  const identity = await createRealAuthUserWithJwt("identity-exhaust");
  const { url, close } = await startTestApp(mountFullAcceptChain);
  try {
    for (let i = 0; i < ACCEPT_IDENTITY_MAX; i++) {
      const res = await fetch(`${url}/api/invitations/accept`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${identity.accessToken}`,
        },
        body: JSON.stringify({ fullName: "Test", invitationId: randomUUID() }),
      });
      assert.equal(
        res.status,
        404,
        `intento ${i + 1}/${ACCEPT_IDENTITY_MAX} debería contar (404, invitación inexistente), no bloquearse`,
      );
    }

    const blocked = await fetch(`${url}/api/invitations/accept`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${identity.accessToken}`,
      },
      body: JSON.stringify({ fullName: "Test", invitationId: randomUUID() }),
    });
    assert.equal(blocked.status, 429);
    assert.ok(blocked.headers.get("retry-after"));
  } finally {
    await close();
    await getSupabaseAdmin().auth.admin.deleteUser(identity.authUserId);
  }
});

test("acceptInvitationRateLimiter: body Zod-inválido no consume cupo de la identidad", async () => {
  const identity = await createRealAuthUserWithJwt("identity-skip");
  const { url, close } = await startTestApp(mountFullAcceptChain);
  try {
    for (let i = 0; i < ACCEPT_IDENTITY_MAX + 3; i++) {
      const res = await fetch(`${url}/api/invitations/accept`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${identity.accessToken}`,
        },
        // Falta fullName -> Zod-inválido.
        body: JSON.stringify({}),
      });
      assert.equal(res.status, 400);
    }

    const probe = await fetch(`${url}/api/invitations/accept`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${identity.accessToken}`,
      },
      body: JSON.stringify({ fullName: "Test", invitationId: randomUUID() }),
    });
    assert.equal(
      probe.status,
      404,
      "un intento válido después de varios inválidos no debería estar bloqueado",
    );
  } finally {
    await close();
    await getSupabaseAdmin().auth.admin.deleteUser(identity.authUserId);
  }
});

test("acceptInvitationRateLimiter: el cupo agotado de una identidad no afecta a otra", async () => {
  const identityA = await createRealAuthUserWithJwt("isolation-a");
  const identityB = await createRealAuthUserWithJwt("isolation-b");
  const { url, close } = await startTestApp(mountFullAcceptChain);
  try {
    for (let i = 0; i < ACCEPT_IDENTITY_MAX; i++) {
      const res = await fetch(`${url}/api/invitations/accept`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${identityA.accessToken}`,
        },
        body: JSON.stringify({ fullName: "A", invitationId: randomUUID() }),
      });
      assert.equal(res.status, 404);
    }

    const aBlocked = await fetch(`${url}/api/invitations/accept`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${identityA.accessToken}`,
      },
      body: JSON.stringify({ fullName: "A", invitationId: randomUUID() }),
    });
    assert.equal(aBlocked.status, 429);

    const bStillOk = await fetch(`${url}/api/invitations/accept`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${identityB.accessToken}`,
      },
      body: JSON.stringify({ fullName: "B", invitationId: randomUUID() }),
    });
    assert.equal(
      bStillOk.status,
      404,
      "la identidad B no debería verse afectada por el cupo agotado de la identidad A",
    );
  } finally {
    await close();
    await getSupabaseAdmin().auth.admin.deleteUser(identityA.authUserId);
    await getSupabaseAdmin().auth.admin.deleteUser(identityB.authUserId);
  }
});

test("cadena completa: una aceptación real tiene éxito dentro de ambos cupos", async () => {
  const adminRole = await findRoleByName("ADMIN");
  assert.ok(adminRole, "el rol ADMIN debe estar sembrado");

  const org = await prisma.organization.create({
    data: { name: `M1 Happy Accept ${randomUUID()}`, slug: `m1-happy-accept-${Date.now()}` },
  });
  const inviterAuth = await createRealAuthUser("happy-inviter");
  const inviter = await prisma.user.create({
    data: {
      id: inviterAuth.id,
      organizationId: org.id,
      roleId: adminRole!.id,
      email: inviterAuth.email,
      fullName: "Inviter",
    },
  });

  const invitee = await createRealAuthUserWithJwt("happy-invitee");
  const invitation = await prisma.invitation.create({
    data: {
      organizationId: org.id,
      email: invitee.email.toLowerCase(),
      roleId: adminRole!.id,
      invitedById: inviter.id,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });

  const { url, close } = await startTestApp(mountFullAcceptChain);
  try {
    const res = await fetch(`${url}/api/invitations/accept`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${invitee.accessToken}`,
      },
      body: JSON.stringify({
        fullName: "Invitee Real Name",
        invitationId: invitation.id,
      }),
    });
    assert.equal(
      res.status,
      201,
      "una aceptación real, dentro de ambos cupos, debe tener éxito sin fricción del rate limiting",
    );
  } finally {
    await close();
    await prisma.invitation.deleteMany({ where: { organizationId: org.id } });
    await prisma.user.deleteMany({ where: { organizationId: org.id } });
    await prisma.organization.delete({ where: { id: org.id } });
    await getSupabaseAdmin().auth.admin.deleteUser(inviterAuth.id);
    await getSupabaseAdmin().auth.admin.deleteUser(invitee.authUserId);
  }
});

// ---------------------------------------------------------------------------
// R1.9 — businessWriteRateLimiter
//
// A diferencia de los limiters de arriba, este no depende de resolver una
// identidad real contra Postgres/Supabase — su única lógica propia es
// contar por req.auth.userId y bloquear con 429. Por eso acá se fabrica
// req.auth directo (vía un header de test), sin pasar por `authenticate`
// real: lo que está bajo prueba es el limiter en sí, no la resolución de
// auth (ya cubierta en me.controller.integration-test.ts). Usa `max`
// chico vía el override de createBusinessWriteRateLimiter — el umbral real
// de producción (100/min) haría este test lento sin probar nada distinto.
// ---------------------------------------------------------------------------

function mountBusinessWrite(app: express.Express, max: number) {
  app.post(
    "/test/business-write",
    (req, _res, next) => {
      const userId = req.header("x-test-user-id") ?? "test-user-fixed";
      req.auth = {
        userId,
        organizationId: "test-org-fixed",
        role: "ADMIN",
        email: `${userId}@example.test`,
        fullName: "Test User",
      } satisfies AuthContext;
      next();
    },
    createBusinessWriteRateLimiter({ windowMs: 60_000, max }),
    (_req, res) => res.status(200).json({ ok: true }),
  );
}

test("businessWriteRateLimiter: cuenta requests de una identidad y bloquea el excedente con 429 + Retry-After", async () => {
  const max = 3;
  const { url, close } = await startTestApp((app) => mountBusinessWrite(app, max));
  try {
    for (let i = 0; i < max; i++) {
      const res = await fetch(`${url}/test/business-write`, { method: "POST" });
      assert.equal(res.status, 200, `intento ${i + 1}/${max} debería contar, no bloquearse`);
    }

    const blocked = await fetch(`${url}/test/business-write`, { method: "POST" });
    assert.equal(blocked.status, 429);
    assert.ok(
      blocked.headers.get("retry-after"),
      "una respuesta 429 debe incluir el header Retry-After",
    );
  } finally {
    await close();
  }
});

test("businessWriteRateLimiter: el cupo agotado de una identidad no afecta a otra", async () => {
  const max = 2;
  const { url, close } = await startTestApp((app) => mountBusinessWrite(app, max));
  try {
    for (let i = 0; i < max; i++) {
      const res = await fetch(`${url}/test/business-write`, {
        method: "POST",
        headers: { "x-test-user-id": "user-a" },
      });
      assert.equal(res.status, 200);
    }
    const aBlocked = await fetch(`${url}/test/business-write`, {
      method: "POST",
      headers: { "x-test-user-id": "user-a" },
    });
    assert.equal(aBlocked.status, 429);

    const bStillOk = await fetch(`${url}/test/business-write`, {
      method: "POST",
      headers: { "x-test-user-id": "user-b" },
    });
    assert.equal(
      bStillOk.status,
      200,
      "el usuario B no debería verse afectado por el cupo agotado del usuario A",
    );
  } finally {
    await close();
  }
});
