import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import express, { type NextFunction, type Request, type Response } from "express";
import { prisma } from "../lib/prisma";
import { getSupabaseAdmin } from "../lib/supabaseAdmin";
import { errorHandler } from "../middlewares/errorHandler";
import { notFound } from "../middlewares/notFound";
import { requirePlatformAdmin } from "../middlewares/requirePlatformAdmin";
import type { AuthContext } from "../types/auth";
import { AppError } from "../utils/AppError";
import { createOrganizationHandler } from "./organizationAdmin.controller";

// ---------------------------------------------------------------------------
// POST /api/admin/organizations contra Postgres y GoTrue reales (Fase 4a del
// módulo SaaS): la gate de platform admin rechaza a un ADMIN de organización
// común; un platform admin crea Organization + User ADMIN y la identidad
// queda en auth.users; los conflictos responden 409.
//
// EL JWT NO SE PRUEBA ACÁ — mismo criterio y mismo stub que
// qrBilling.integration-test.ts: la app de test reemplaza `authenticate` por
// un middleware que pone en req.auth la identidad que cada test elige. Las
// filas de platform_admins se insertan directo por Prisma, el único write
// path que existe, a propósito.
//
// Los caminos de compensación (Prisma falla después de Supabase) no se
// fuerzan acá: los cubre organizationAdmin.service.test.ts con dependencias
// inyectadas, donde se pueden hacer fallar a voluntad.
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
    "/api/admin/organizations",
    stubAuthenticate,
    requirePlatformAdmin,
    createOrganizationHandler,
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

function comoUsuario(
  userId: string,
  organizationId: string,
  role: "ADMIN" | "USER" = "ADMIN",
): AuthContext {
  return { userId, organizationId, role, email: `${userId}@example.test`, fullName: "Test" };
}

function post(body: unknown) {
  return fetch(`${baseUrl}/api/admin/organizations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function emailDePrueba(etiqueta: string): string {
  return `orgadmin-${etiqueta}-${Date.now()}-${randomUUID().slice(0, 8)}@example.test`;
}

// platform_admins.user_id no tiene FK a auth.users: un uuid cualquiera alcanza.
async function conPlatformAdmin<T>(fn: (platformAdminUserId: string) => Promise<T>): Promise<T> {
  const admin = await prisma.platformAdmin.create({ data: { userId: randomUUID() } });
  try {
    return await fn(admin.userId);
  } finally {
    await prisma.platformAdmin.delete({ where: { userId: admin.userId } });
  }
}

interface Creado {
  organization: { id: string; name: string; slug: string };
  admin: { id: string; email: string; fullName: string; role: string };
}

async function limpiarCreado(creado: Creado) {
  await prisma.user.deleteMany({ where: { id: creado.admin.id } });
  await prisma.organization.deleteMany({ where: { id: creado.organization.id } });
  await getSupabaseAdmin().auth.admin.deleteUser(creado.admin.id);
}

// ---------------------------------------------------------------------------
// requirePlatformAdmin — mismo test que ya existe para los endpoints de qrAdmin
// ---------------------------------------------------------------------------

test("un ADMIN de organización común (no platform admin) -> 403 con el mensaje genérico, y no se crea nada", async () => {
  const email = emailDePrueba("403");
  identidad = comoUsuario(randomUUID(), randomUUID(), "ADMIN");
  try {
    const res = await post({
      organizationName: "Org que no debería existir",
      adminFullName: "Nadie",
      adminEmail: email,
    });
    assert.equal(res.status, 403);
    const body = (await res.json()) as { error: { message: string } };
    assert.equal(body.error.message, "No tenés permisos para realizar esta acción");

    assert.equal(await prisma.user.findUnique({ where: { email } }), null);
  } finally {
    identidad = undefined;
  }
});

test("sin identidad -> 401 (la ruta sigue detrás de authenticate)", async () => {
  identidad = undefined;
  const res = await post({
    organizationName: "x",
    adminFullName: "y",
    adminEmail: "z@example.test",
  });
  assert.equal(res.status, 401);
});

// ---------------------------------------------------------------------------
// Camino feliz y conflictos
// ---------------------------------------------------------------------------

test("platform admin: 201 con Organization + User ADMIN creados, identidad en auth.users con la metadata del invite", async () => {
  await conPlatformAdmin(async (platformAdminUserId) => {
    // Con rol USER y una organización cualquiera adrede: la gate es global,
    // independiente del rol y de la pertenencia.
    identidad = comoUsuario(platformAdminUserId, randomUUID(), "USER");
    const email = emailDePrueba("feliz");
    const nombre = `Automotora Feliz ${Date.now()}`;
    let creado: Creado | undefined;
    try {
      const res = await post({
        organizationName: nombre,
        adminFullName: "Ana Fundadora",
        // Con mayúsculas y espacios: el 201 tiene que devolver el email
        // normalizado.
        adminEmail: `  ${email.toUpperCase()} `,
      });
      const texto = await res.text();
      assert.equal(res.status, 201, texto);
      creado = JSON.parse(texto) as Creado;

      assert.equal(creado.organization.name, nombre);
      assert.match(creado.organization.slug, /^automotora-feliz-\d+$/);
      assert.equal(creado.admin.email, email);
      assert.equal(creado.admin.fullName, "Ana Fundadora");
      assert.equal(creado.admin.role, "ADMIN");

      const user = await prisma.user.findUniqueOrThrow({
        where: { id: creado.admin.id },
        include: { role: true },
      });
      assert.equal(user.organizationId, creado.organization.id);
      assert.equal(user.role.name, "ADMIN");
      assert.equal(user.email, email);

      const { data, error } = await getSupabaseAdmin().auth.admin.getUserById(creado.admin.id);
      assert.equal(error, null);
      assert.equal(data.user?.email, email);
      assert.equal(data.user?.user_metadata.full_name, "Ana Fundadora");
      // Nació por invitación: GoTrue sella invited_at solo en ese camino (es el
      // discriminador del que depende authCleanup.service.ts).
      assert.ok(data.user?.invited_at, "la identidad tiene que tener invited_at");
    } finally {
      identidad = undefined;
      if (creado) await limpiarCreado(creado);
    }
  });
});

test("platform admin: mismo nombre -> 409 por slug; mismo email -> 409 por email; body inválido -> 400", async () => {
  await conPlatformAdmin(async (platformAdminUserId) => {
    identidad = comoUsuario(platformAdminUserId, randomUUID());
    const email = emailDePrueba("conflicto");
    const nombre = `Automotora Conflicto ${Date.now()}`;
    let creado: Creado | undefined;
    try {
      const primera = await post({
        organizationName: nombre,
        adminFullName: "Uno",
        adminEmail: email,
      });
      const texto = await primera.text();
      assert.equal(primera.status, 201, texto);
      creado = JSON.parse(texto) as Creado;

      // Mismo nombre (distinto email): choca el slug. Sin escritura: el
      // pre-chequeo corta antes de invitar a nadie.
      const porSlug = await post({
        organizationName: nombre.toUpperCase(),
        adminFullName: "Dos",
        adminEmail: emailDePrueba("otro"),
      });
      assert.equal(porSlug.status, 409);
      assert.equal(
        ((await porSlug.json()) as { error: { message: string } }).error.message,
        "Ya existe una organización con ese nombre",
      );

      // Mismo email (distinto nombre): ya es User de la primera.
      const porEmail = await post({
        organizationName: `${nombre} bis`,
        adminFullName: "Tres",
        adminEmail: email,
      });
      assert.equal(porEmail.status, 409);
      assert.equal(
        ((await porEmail.json()) as { error: { message: string } }).error.message,
        "Ya existe una cuenta con ese email",
      );
      assert.equal(
        await prisma.organization.findUnique({
          where: { slug: `${creado.organization.slug}-bis` },
        }),
        null,
      );

      const invalido = await post({
        organizationName: "",
        adminFullName: "x",
        adminEmail: "no-es-email",
      });
      assert.equal(invalido.status, 400);
    } finally {
      identidad = undefined;
      if (creado) await limpiarCreado(creado);
    }
  });
});
