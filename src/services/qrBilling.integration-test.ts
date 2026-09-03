import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import express, { type NextFunction, type Request, type Response } from "express";
import { prisma } from "../lib/prisma";
import { errorHandler } from "../middlewares/errorHandler";
import { notFound } from "../middlewares/notFound";
import { requirePlatformAdmin } from "../middlewares/requirePlatformAdmin";
import {
  setQrBillingExemptionHandler,
  setQrSubscriptionStatusHandler,
} from "../controllers/qrAdmin.controller";
import type { AuthContext } from "../types/auth";
import { AppError } from "../utils/AppError";
import { adminSetQrSubscriptionStatus, setQrBillingExemption } from "./qrBilling.service";

// ---------------------------------------------------------------------------
// Activación manual del módulo QR contra Postgres real (docs/qr-integration.md,
// "Verificación"): requirePlatformAdmin rechaza a un ADMIN de organización
// común; un platform admin puede activar/desactivar y eximir; cada llamada se
// audita con el CHECK de changedByPlatformAdminId respetado; 404 para una
// organización inexistente.
//
// EL JWT NO SE PRUEBA ACÁ. La app de test reemplaza `authenticate` por un
// middleware que pone en req.auth la identidad que cada test elige: lo que
// está bajo prueba es la gate de platform admin y el service, no la
// verificación de firma de Supabase, que ya cubren me.controller y
// rateLimit.integration-test. Las filas de platform_admins se insertan
// directo por Prisma — es el único write path que existe, a propósito.
// ---------------------------------------------------------------------------

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

function startTestApp(): Promise<{ url: string; close: () => Promise<void> }> {
  const app = express();
  app.use(express.json());
  app.post(
    "/api/admin/organizations/:organizationId/qr-subscription-status",
    stubAuthenticate,
    requirePlatformAdmin,
    setQrSubscriptionStatusHandler,
  );
  app.post(
    "/api/admin/organizations/:organizationId/qr-billing-exemption",
    stubAuthenticate,
    requirePlatformAdmin,
    setQrBillingExemptionHandler,
  );
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
});

after(async () => {
  if (closeApp) await closeApp();
});

interface Escenario {
  organizationId: string;
  platformAdminUserId: string;
}

async function montar(etiqueta: string): Promise<Escenario> {
  const org = await prisma.organization.create({
    data: {
      name: `QR billing ${etiqueta} ${randomUUID()}`,
      slug: `qr-bill-${etiqueta}-${Date.now()}-${randomUUID().slice(0, 8)}`,
    },
  });
  // platform_admins.user_id no tiene FK a auth.users (ver schema.prisma): un
  // uuid cualquiera alcanza para la allowlist.
  const admin = await prisma.platformAdmin.create({ data: { userId: randomUUID() } });
  return { organizationId: org.id, platformAdminUserId: admin.userId };
}

async function desmontar(e: Escenario) {
  await prisma.qrSubscriptionStatusChange.deleteMany({
    where: { organizationId: e.organizationId },
  });
  await prisma.qrBillingExemptionChange.deleteMany({ where: { organizationId: e.organizationId } });
  await prisma.platformAdmin.delete({ where: { userId: e.platformAdminUserId } });
  await prisma.organization.delete({ where: { id: e.organizationId } });
}

function comoUsuario(
  userId: string,
  organizationId: string,
  role: "ADMIN" | "USER" = "ADMIN",
): AuthContext {
  return { userId, organizationId, role, email: `${userId}@example.test`, fullName: "Test" };
}

function post(path: string, body: unknown) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function org(e: Escenario) {
  return prisma.organization.findUniqueOrThrow({
    where: { id: e.organizationId },
    select: { qrSubscriptionStatus: true, qrBillingExempt: true },
  });
}

// ---------------------------------------------------------------------------
// requirePlatformAdmin
// ---------------------------------------------------------------------------

test("requirePlatformAdmin: un ADMIN de organización común (no platform admin) -> 403 con el mensaje genérico de authorize", async () => {
  const e = await montar("gate-admin");
  try {
    identidad = comoUsuario(randomUUID(), e.organizationId, "ADMIN");
    const res = await post(`/api/admin/organizations/${e.organizationId}/qr-subscription-status`, {
      newStatus: "ACTIVE",
    });
    assert.equal(res.status, 403);
    const body = (await res.json()) as { error: { message: string } };
    assert.equal(body.error.message, "No tenés permisos para realizar esta acción");

    assert.equal((await org(e)).qrSubscriptionStatus, "INACTIVE");
    assert.equal(
      await prisma.qrSubscriptionStatusChange.count({
        where: { organizationId: e.organizationId },
      }),
      0,
    );
  } finally {
    identidad = undefined;
    await desmontar(e);
  }
});

test("requirePlatformAdmin: sin identidad -> 401 (la ruta sigue detrás de authenticate)", async () => {
  identidad = undefined;
  const res = await post(`/api/admin/organizations/${randomUUID()}/qr-billing-exemption`, {
    newValue: true,
    reason: "x",
  });
  assert.equal(res.status, 401);
});

test("requirePlatformAdmin: un platform admin que NI SIQUIERA pertenece a la organización puede activarla — la gate es global", async () => {
  const e = await montar("gate-global");
  try {
    identidad = comoUsuario(e.platformAdminUserId, randomUUID(), "USER");
    const res = await post(`/api/admin/organizations/${e.organizationId}/qr-subscription-status`, {
      newStatus: "ACTIVE",
      reason: "pagó por transferencia",
    });
    assert.equal(res.status, 200);
    assert.equal((await org(e)).qrSubscriptionStatus, "ACTIVE");
  } finally {
    identidad = undefined;
    await desmontar(e);
  }
});

// ---------------------------------------------------------------------------
// Estado de suscripción
// ---------------------------------------------------------------------------

test("subscription-status: activar y desactivar por HTTP, cada llamada auditada con el platform admin como actor", async () => {
  const e = await montar("status");
  try {
    identidad = comoUsuario(e.platformAdminUserId, e.organizationId);
    const path = `/api/admin/organizations/${e.organizationId}/qr-subscription-status`;

    const activar = await post(path, { newStatus: "ACTIVE", reason: "efectivo" });
    assert.equal(activar.status, 200);
    assert.equal((await org(e)).qrSubscriptionStatus, "ACTIVE");

    const desactivar = await post(path, { newStatus: "INACTIVE" });
    assert.equal(desactivar.status, 200);
    assert.equal((await org(e)).qrSubscriptionStatus, "INACTIVE");

    const cambios = await prisma.qrSubscriptionStatusChange.findMany({
      where: { organizationId: e.organizationId },
      orderBy: { createdAt: "asc" },
    });
    assert.equal(cambios.length, 2);
    assert.deepEqual(
      cambios.map((c) => [
        c.previousStatus,
        c.newStatus,
        c.source,
        c.changedByPlatformAdminId,
        c.reason,
      ]),
      [
        ["INACTIVE", "ACTIVE", "PLATFORM_ADMIN", e.platformAdminUserId, "efectivo"],
        ["ACTIVE", "INACTIVE", "PLATFORM_ADMIN", e.platformAdminUserId, null],
      ],
    );
  } finally {
    identidad = undefined;
    await desmontar(e);
  }
});

test("subscription-status: el mismo estado que el actual se audita igual (confirmación explícita, a diferencia del webhook)", async () => {
  const e = await montar("status-mismo");
  try {
    await adminSetQrSubscriptionStatus({
      organizationId: e.organizationId,
      newStatus: "INACTIVE",
      reason: "sigue sin pagar",
      platformAdminUserId: e.platformAdminUserId,
    });
    const cambios = await prisma.qrSubscriptionStatusChange.findMany({
      where: { organizationId: e.organizationId },
    });
    assert.equal(cambios.length, 1);
    assert.equal(cambios[0].previousStatus, "INACTIVE");
    assert.equal(cambios[0].newStatus, "INACTIVE");
  } finally {
    await desmontar(e);
  }
});

test("subscription-status: organización inexistente -> 404; body inválido -> 400", async () => {
  const e = await montar("status-404");
  try {
    identidad = comoUsuario(e.platformAdminUserId, e.organizationId);
    const inexistente = await post(
      `/api/admin/organizations/${randomUUID()}/qr-subscription-status`,
      {
        newStatus: "ACTIVE",
      },
    );
    assert.equal(inexistente.status, 404);

    const invalido = await post(
      `/api/admin/organizations/${e.organizationId}/qr-subscription-status`,
      {
        newStatus: "active",
      },
    );
    assert.equal(invalido.status, 400);
  } finally {
    identidad = undefined;
    await desmontar(e);
  }
});

test("subscription-status: el CHECK de Fase 1 rechaza una fila PLATFORM_ADMIN sin actor y una MERCADOPAGO_WEBHOOK con actor", async () => {
  const e = await montar("check");
  try {
    await assert.rejects(
      prisma.qrSubscriptionStatusChange.create({
        data: {
          organizationId: e.organizationId,
          previousStatus: "INACTIVE",
          newStatus: "ACTIVE",
          source: "PLATFORM_ADMIN",
          changedByPlatformAdminId: null,
        },
      }),
    );
    await assert.rejects(
      prisma.qrSubscriptionStatusChange.create({
        data: {
          organizationId: e.organizationId,
          previousStatus: "INACTIVE",
          newStatus: "ACTIVE",
          source: "MERCADOPAGO_WEBHOOK",
          changedByPlatformAdminId: e.platformAdminUserId,
        },
      }),
    );
  } finally {
    await desmontar(e);
  }
});

// ---------------------------------------------------------------------------
// Exención de facturación
// ---------------------------------------------------------------------------

test("billing-exemption: eximir y revocar por HTTP; reason obligatorio; no toca qrSubscriptionStatus", async () => {
  const e = await montar("exempt");
  try {
    identidad = comoUsuario(e.platformAdminUserId, e.organizationId);
    const path = `/api/admin/organizations/${e.organizationId}/qr-billing-exemption`;

    const sinMotivo = await post(path, { newValue: true });
    assert.equal(sinMotivo.status, 400);
    const vacio = await post(path, { newValue: true, reason: "  " });
    assert.equal(vacio.status, 400);

    const eximir = await post(path, { newValue: true, reason: "piloto sin cargo" });
    assert.equal(eximir.status, 200);
    let o = await org(e);
    assert.equal(o.qrBillingExempt, true);
    assert.equal(o.qrSubscriptionStatus, "INACTIVE", "la exención es independiente del status");

    const revocar = await post(path, { newValue: false, reason: "fin del piloto" });
    assert.equal(revocar.status, 200);
    o = await org(e);
    assert.equal(o.qrBillingExempt, false);

    const cambios = await prisma.qrBillingExemptionChange.findMany({
      where: { organizationId: e.organizationId },
      orderBy: { createdAt: "asc" },
    });
    assert.deepEqual(
      cambios.map((c) => [c.previousValue, c.newValue, c.changedByPlatformAdminId, c.reason]),
      [
        [false, true, e.platformAdminUserId, "piloto sin cargo"],
        [true, false, e.platformAdminUserId, "fin del piloto"],
      ],
    );
    assert.equal(
      await prisma.qrSubscriptionStatusChange.count({
        where: { organizationId: e.organizationId },
      }),
      0,
    );
  } finally {
    identidad = undefined;
    await desmontar(e);
  }
});

test("billing-exemption: mismo valor que el actual se audita igual (DEC-062); organización inexistente -> 404", async () => {
  const e = await montar("exempt-mismo");
  try {
    await setQrBillingExemption({
      organizationId: e.organizationId,
      newValue: false,
      reason: "confirmado",
      platformAdminUserId: e.platformAdminUserId,
    });
    const cambios = await prisma.qrBillingExemptionChange.findMany({
      where: { organizationId: e.organizationId },
    });
    assert.equal(cambios.length, 1);
    assert.deepEqual([cambios[0].previousValue, cambios[0].newValue], [false, false]);

    await assert.rejects(
      setQrBillingExemption({
        organizationId: randomUUID(),
        newValue: true,
        reason: "x",
        platformAdminUserId: e.platformAdminUserId,
      }),
      (err: unknown) => err instanceof AppError && err.statusCode === 404,
    );
  } finally {
    await desmontar(e);
  }
});
