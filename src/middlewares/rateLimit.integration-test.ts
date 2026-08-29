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
import { requestOnboardingOtp } from "../services/onboarding.service";
import { slugify } from "../utils/slug";
import { errorHandler } from "./errorHandler";
import { notFound } from "./notFound";
import {
  ACCEPT_IDENTITY_MAX,
  BUSINESS_WRITE_MAX,
  IMPORT_PREVIEW_MAX,
  ONBOARDING_MAX,
  ONBOARDING_OTP_MAX,
  createAcceptInvitationRateLimiter,
  createBusinessWriteRateLimiter,
  createImportPreviewRateLimiter,
  createOnboardingOtpRateLimiter,
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
      // ALTO-2: el schema exige el código, y el limiter decide qué cuenta
      // parseándolo. Sin esto el body sería Zod-inválido y NINGÚN intento
      // contaría contra el cupo — que es exactamente lo que este test mide.
      // No hace falta que sea el código correcto: el 409 por slug duplicado se
      // resuelve antes de llegar a verifyOtp, así que sigue sin tocar Supabase.
      otp: "000000",
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
        otp: "000000",
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
  const email = `m1-happy-onboarding-${randomUUID()}@example.test`;
  try {
    // ALTO-2 — el registro real ahora tiene un paso previo: probar el email.
    // Este test dice "un request real dentro del cupo completa el flujo sin
    // fricción", así que tiene que completar el flujo real, no una versión
    // recortada. El código se obtiene con generateLink (no envía mail) por el
    // mismo motivo que en onboarding.service.integration-test.ts: así corre
    // igual contra el stack local y contra un proyecto hosteado.
    await requestOnboardingOtp({ email });
    const { data: link, error: linkError } = await getSupabaseAdmin().auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    const otp = link.properties?.email_otp;
    assert.ok(otp, `no se pudo generar el OTP: ${linkError?.message ?? "sin email_otp"}`);

    const res = await fetch(`${url}/api/onboarding`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        organizationName: `M1 Onboarding Happy ${randomUUID()}`,
        fullName: "Happy Path",
        email,
        password: "password123",
        otp,
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
// A-2 (docs/auditoria-2026-08-29.md) — el keying de onboarding es por EMAIL del
// body, nunca por IP.
//
// Estos tests montan el limiter con un handler stub (200) en vez del controller
// real: lo que está bajo prueba es CON QUÉ CLAVE cuenta, no el registro. El
// controller real ya lo cubren los tres tests de arriba, y el de /otp dispararía
// un email real de Supabase por cada request.
//
// LO QUE TIENEN QUE DEMOSTRAR, y por qué los dos sentidos: con el keying por IP
// anterior, TODOS los requests de estos tests salían de 127.0.0.1 y compartían
// un único cupo — así que "otro email sigue pasando" es la aserción que habría
// fallado con el código viejo, y "el mismo email con otro case comparte cupo" es
// la que impide que el fix se pueda esquivar alternando mayúsculas.
// ---------------------------------------------------------------------------

function mountOnboardingKeyingStub(app: express.Express) {
  app.post("/onboarding", createOnboardingRateLimiter(), (_req, res) => {
    res.status(200).json({ ok: true });
  });
  app.post("/onboarding/otp", createOnboardingOtpRateLimiter(), (_req, res) => {
    res.status(200).json({ ok: true });
  });
}

function bodyDeOnboarding(email: string) {
  return {
    organizationName: "Keying",
    fullName: "Keying Test",
    email,
    password: "password123",
    otp: "000000",
  };
}

async function postJson(url: string, body: unknown) {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("onboardingRateLimiter: el cupo es por email — el mismo email (aun con otro case y espacios) lo comparte, otro email no", async () => {
  const { url, close } = await startTestApp(mountOnboardingKeyingStub);
  try {
    const sufijo = randomUUID().slice(0, 8);
    const emailA = `keying-a-${sufijo}@example.test`;

    for (let i = 0; i < ONBOARDING_MAX; i++) {
      const res = await postJson(`${url}/onboarding`, bodyDeOnboarding(emailA));
      assert.equal(res.status, 200, `intento ${i + 1}/${ONBOARDING_MAX} de A debería contar`);
    }

    // La misma dirección escrita distinto: Supabase la trata como la misma
    // cuenta, así que tiene que caer en el mismo cupo — si no, alternar el case
    // multiplicaría el cupo gratis.
    const mismaConOtroCase = await postJson(
      `${url}/onboarding`,
      bodyDeOnboarding(`  KEYING-A-${sufijo}@Example.TEST  `),
    );
    assert.equal(
      mismaConOtroCase.status,
      429,
      "el mismo email con otro case/espacios tiene que compartir el cupo agotado",
    );
    assert.ok(mismaConOtroCase.headers.get("retry-after"));

    // LA ASERCIÓN QUE HABRÍA FALLADO CON EL KEYING POR IP: otro email, desde la
    // misma IP (todo este test sale de 127.0.0.1), sigue teniendo su cupo.
    const otroEmail = await postJson(
      `${url}/onboarding`,
      bodyDeOnboarding(`keying-b-${sufijo}@example.test`),
    );
    assert.equal(
      otroEmail.status,
      200,
      "otro email no puede verse afectado por el cupo agotado del primero — con keying por IP esto daba 429",
    );
  } finally {
    await close();
  }
});

test("onboardingOtpRateLimiter: el cupo es por email — el mismo email lo comparte, otro email no", async () => {
  const { url, close } = await startTestApp(mountOnboardingKeyingStub);
  try {
    const sufijo = randomUUID().slice(0, 8);
    const emailA = `otp-keying-a-${sufijo}@example.test`;

    for (let i = 0; i < ONBOARDING_OTP_MAX; i++) {
      const res = await postJson(`${url}/onboarding/otp`, { email: emailA });
      assert.equal(res.status, 200, `pedido ${i + 1}/${ONBOARDING_OTP_MAX} de A debería contar`);
    }

    const mismaConOtroCase = await postJson(`${url}/onboarding/otp`, {
      email: `OTP-Keying-A-${sufijo}@EXAMPLE.test`,
    });
    assert.equal(mismaConOtroCase.status, 429);
    assert.ok(mismaConOtroCase.headers.get("retry-after"));

    const otroEmail = await postJson(`${url}/onboarding/otp`, {
      email: `otp-keying-b-${sufijo}@example.test`,
    });
    assert.equal(
      otroEmail.status,
      200,
      "otro email no puede verse afectado por el cupo agotado del primero — con keying por IP esto daba 429",
    );

    // Y un body sin email válido sigue sin consumir cupo de nadie ni romper
    // el keyGenerator: skip() lo descarta antes de que se pida una clave.
    const invalido = await postJson(`${url}/onboarding/otp`, { email: "no-es-un-email" });
    assert.equal(invalido.status, 200, "el stub responde 200: el limiter lo salteó sin error");
  } finally {
    await close();
  }
});

// Los dos limiters de onboarding cuentan cosas distintas: agotar el pedido de
// códigos de un email no puede dejar sin cupo al registro de ese mismo email
// (son dos endpoints, dos stores).
test("los cupos de /onboarding/otp y /onboarding son independientes para el mismo email", async () => {
  const { url, close } = await startTestApp(mountOnboardingKeyingStub);
  try {
    const email = `otp-vs-registro-${randomUUID().slice(0, 8)}@example.test`;

    for (let i = 0; i < ONBOARDING_OTP_MAX; i++) {
      assert.equal((await postJson(`${url}/onboarding/otp`, { email })).status, 200);
    }
    assert.equal((await postJson(`${url}/onboarding/otp`, { email })).status, 429);

    const registro = await postJson(`${url}/onboarding`, bodyDeOnboarding(email));
    assert.equal(registro.status, 200, "el registro del mismo email tiene su propio cupo");
  } finally {
    await close();
  }
});

// ---------------------------------------------------------------------------
// Invitation accept — cadena completa real (verificación + limiter por identidad)
//
// Hasta el 29/08 la cadena tenía un tercer eslabón adelante,
// acceptPreAuthRateLimiter (por IP), con dos tests propios: "cuenta todo
// request sin excepción" y "bloquea incluso a una identidad real una vez
// agotado". Los dos probaban exactamente el comportamiento por IP que A-2 de
// docs/auditoria-2026-08-29.md sacó, así que se fueron con él. Lo que queda
// bajo prueba es lo que quedó montado: verifyInvitationAcceptIdentity y
// acceptInvitationRateLimiter, en ese orden.
// ---------------------------------------------------------------------------

function mountFullAcceptChain(app: express.Express) {
  app.post(
    "/api/invitations/accept",
    verifyInvitationAcceptIdentity,
    createAcceptInvitationRateLimiter(),
    acceptInvitationHandler,
  );
}

// La contracara de haber sacado el limiter pre-auth: un flood anónimo de
// tokens basura muere en el 401 de la verificación de firma, request por
// request, y NO consume el cupo de ninguna identidad real — el limiter por
// identidad nunca llega a ejecutarse para un token inválido. Es la propiedad
// que hace aceptable no tener límite antes de verificar.
test("cadena completa: un flood anónimo de tokens basura recibe 401 en cada request y no consume el cupo de una identidad real", async () => {
  const identity = await createRealAuthUserWithJwt("anon-flood");
  const { url, close } = await startTestApp(mountFullAcceptChain);
  try {
    for (let i = 0; i < ACCEPT_IDENTITY_MAX + 5; i++) {
      const res = await fetch(`${url}/api/invitations/accept`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer basura-${i}`,
        },
        body: JSON.stringify({ fullName: "x", invitationId: randomUUID() }),
      });
      assert.equal(res.status, 401, `token basura ${i + 1} tiene que morir en la verificación`);
    }

    // La identidad real sigue con su cupo entero: 404 (invitación inexistente,
    // Zod-válida), nunca 429.
    const real = await fetch(`${url}/api/invitations/accept`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${identity.accessToken}`,
      },
      body: JSON.stringify({ fullName: "Real Identity", invitationId: randomUUID() }),
    });
    assert.equal(
      real.status,
      404,
      "el flood anónimo no puede haber consumido el cupo de una identidad verificada",
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

// ---------------------------------------------------------------------------
// S2-3 — importPreviewRateLimiter
//
// Mismo montaje que businessWriteRateLimiter y por la misma razón: lo que está
// bajo prueba es el limiter, no la resolución de auth, así que req.auth se
// fabrica con un header de test.
//
// LO QUE ESTOS TESTS TIENEN QUE PROBAR NO ES "hay un rate limit" —eso ya
// existía—, sino que la cuota del preview es PROPIA Y MÁS ESTRICTA que la de
// negocio. Por eso el primer caso monta los DOS limiters en la misma app, con
// sus proporciones reales, y verifica que el del preview se agota mientras al
// otro todavía le queda cupo. Con dos assert sueltos sobre cada limiter por
// separado, un cambio que igualara los dos umbrales pasaría sin que nada lo
// note.
// ---------------------------------------------------------------------------

function mountPreviewAndBusinessWrite(app: express.Express, previewMax: number, writeMax: number) {
  const fabricarAuth = (
    req: express.Request,
    _res: express.Response,
    next: express.NextFunction,
  ) => {
    const userId = req.header("x-test-user-id") ?? "test-user-fixed";
    req.auth = {
      userId,
      organizationId: "test-org-fixed",
      role: "ADMIN",
      email: `${userId}@example.test`,
      fullName: "Test User",
    } satisfies AuthContext;
    next();
  };

  app.post(
    "/test/imports/preview",
    fabricarAuth,
    createImportPreviewRateLimiter({ windowMs: 60_000, max: previewMax }),
    (_req, res) => res.status(200).json({ ok: true }),
  );

  app.post(
    "/test/imports",
    fabricarAuth,
    createBusinessWriteRateLimiter({ windowMs: 60_000, max: writeMax }),
    (_req, res) => res.status(200).json({ ok: true }),
  );
}

test("importPreviewRateLimiter: se agota antes que el de negocio, y son cuotas separadas", async () => {
  // Proporción real (10 vs 100), reducida 1:10 para no disparar 100 requests.
  const previewMax = 2;
  const writeMax = 20;
  assert.equal(
    BUSINESS_WRITE_MAX / IMPORT_PREVIEW_MAX,
    writeMax / previewMax,
    "los máximos del test tienen que mantener la proporción real entre las dos cuotas",
  );

  const { url, close } = await startTestApp((app) =>
    mountPreviewAndBusinessWrite(app, previewMax, writeMax),
  );
  try {
    for (let i = 0; i < previewMax; i++) {
      const res = await fetch(`${url}/test/imports/preview`, { method: "POST" });
      assert.equal(res.status, 200, `preview ${i + 1}/${previewMax} debería contar, no bloquearse`);
    }

    const previewBlocked = await fetch(`${url}/test/imports/preview`, { method: "POST" });
    assert.equal(previewBlocked.status, 429, "el preview se agota en su propia cuota, más chica");
    assert.ok(
      previewBlocked.headers.get("retry-after"),
      "una respuesta 429 debe incluir el header Retry-After",
    );

    // LA AFIRMACIÓN QUE IMPORTA: la importación real sigue disponible para la
    // MISMA identidad. Si las dos cuotas fueran una sola, esto daría 429.
    const writeStillOk = await fetch(`${url}/test/imports`, { method: "POST" });
    assert.equal(
      writeStillOk.status,
      200,
      "agotar el preview no puede dejar sin cupo a POST /imports: son cuotas separadas",
    );
  } finally {
    await close();
  }
});

test("importPreviewRateLimiter: el cupo agotado de una identidad no afecta a otra", async () => {
  const max = 2;
  const { url, close } = await startTestApp((app) =>
    mountPreviewAndBusinessWrite(app, max, max * 10),
  );
  try {
    for (let i = 0; i < max; i++) {
      const res = await fetch(`${url}/test/imports/preview`, {
        method: "POST",
        headers: { "x-test-user-id": "preview-a" },
      });
      assert.equal(res.status, 200);
    }
    const aBlocked = await fetch(`${url}/test/imports/preview`, {
      method: "POST",
      headers: { "x-test-user-id": "preview-a" },
    });
    assert.equal(aBlocked.status, 429);

    const bStillOk = await fetch(`${url}/test/imports/preview`, {
      method: "POST",
      headers: { "x-test-user-id": "preview-b" },
    });
    assert.equal(
      bStillOk.status,
      200,
      "el keying es por identidad: el cupo de A no puede consumir el de B",
    );
  } finally {
    await close();
  }
});

// El número real que quedó en producción, afirmado explícitamente: si alguien
// lo sube a la altura de la cuota de negocio, S2-3 vuelve a estar abierto y
// este test lo dice.
test("la cuota del preview es un orden de magnitud menor que la de negocio", () => {
  assert.equal(IMPORT_PREVIEW_MAX, 10);
  assert.equal(BUSINESS_WRITE_MAX, 100);
  assert.ok(
    IMPORT_PREVIEW_MAX * 5 <= BUSINESS_WRITE_MAX,
    "el preview no puede acercarse a la cuota de escritura de negocio",
  );
});
