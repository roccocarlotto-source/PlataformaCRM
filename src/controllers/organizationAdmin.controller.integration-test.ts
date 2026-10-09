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
import { ESENCIAL_HABILITADA, PROCESO_DE_VENTA_FIJO } from "../config/ediciones";
import {
  createOrganizationWithFoundingAdmin,
  defaultOrganizationAdminDeps,
} from "../services/organizationAdmin.service";
import {
  changeOrganizationEditionHandler,
  createOrganizationHandler,
  listEditionsHandler,
  listOrganizationsHandler,
} from "./organizationAdmin.controller";

// ---------------------------------------------------------------------------
// POST /api/admin/organizations contra Postgres y GoTrue reales (Fase 4a del
// módulo SaaS): la gate de platform admin rechaza a un ADMIN de organización
// común; un platform admin crea Organization + User ADMIN y la identidad
// queda en auth.users; los conflictos responden 409.
//
// EL JWT NO SE PRUEBA ACÁ: la app de test reemplaza `authenticate` por
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
  app.get(
    "/api/admin/organizations",
    stubAuthenticate,
    requirePlatformAdmin,
    listOrganizationsHandler,
  );
  app.get(
    "/api/admin/organizations/editions",
    stubAuthenticate,
    requirePlatformAdmin,
    listEditionsHandler,
  );
  app.patch(
    "/api/admin/organizations/:organizationId/edition",
    stubAuthenticate,
    requirePlatformAdmin,
    changeOrganizationEditionHandler,
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
  return {
    userId,
    organizationId,
    role,
    email: `${userId}@example.test`,
    fullName: "Test",
    edition: "COMPLETA",
  };
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
// requirePlatformAdmin
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

      // Rubros (20261031120000, docs/rubros.md §1.1): la API todavía no conoce
      // el rubro, y la organización nace AUTOMOTORA por el DEFAULT.
      const org = await prisma.organization.findUniqueOrThrow({
        where: { id: creado.organization.id },
        select: { industry: true },
      });
      assert.equal(org.industry, "AUTOMOTORA");

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

// ---------------------------------------------------------------------------
// GET /api/admin/organizations — el selector de las pantallas de plataforma
// (conexión con Facebook, 02/10/2026).
// ---------------------------------------------------------------------------

test("listado: 403 para un ADMIN común; el platform admin ve las vigentes con id, nombre y slug, sin las dadas de baja", async () => {
  const sufijo = randomUUID().slice(0, 8);
  const vigente = await prisma.organization.create({
    data: { name: `Listado vigente ${sufijo}`, slug: `listado-vigente-${sufijo}` },
  });
  const deBaja = await prisma.organization.create({
    data: {
      name: `Listado de baja ${sufijo}`,
      slug: `listado-de-baja-${sufijo}`,
      deletedAt: new Date(),
    },
  });
  try {
    identidad = comoUsuario(randomUUID(), vigente.id, "ADMIN");
    const prohibido = await fetch(`${baseUrl}/api/admin/organizations`);
    assert.equal(prohibido.status, 403);

    await conPlatformAdmin(async (platformAdminUserId) => {
      identidad = comoUsuario(platformAdminUserId, randomUUID(), "USER");
      const res = await fetch(`${baseUrl}/api/admin/organizations`);
      assert.equal(res.status, 200);
      const lista = (await res.json()) as Record<string, unknown>[];
      const encontrada = lista.find((o) => o.id === vigente.id);
      assert.deepEqual(encontrada, {
        id: vigente.id,
        name: vigente.name,
        slug: vigente.slug,
        edition: "COMPLETA",
      });
      assert.equal(
        lista.some((o) => o.id === deBaja.id),
        false,
      );
    });
  } finally {
    identidad = undefined;
    await prisma.organization.deleteMany({ where: { id: { in: [vigente.id, deBaja.id] } } });
  }
});

// ---------------------------------------------------------------------------
// Ediciones (docs/ediciones.md §10, PR 4). La llave ESENCIAL_HABILITADA está
// en false hasta el PR 5: por la API, ESENCIAL se rechaza. El camino con la
// llave en true se prueba llamando al service con la llave inyectada, contra
// Postgres y GoTrue reales.
// ---------------------------------------------------------------------------

test("la llave ESENCIAL_HABILITADA sigue en false hasta el PR 5", () => {
  // El PR 5 la pone en true y cambia esta línea.
  assert.equal(ESENCIAL_HABILITADA, false);
});

test("GET /editions: el platform admin ve solo COMPLETA; un ADMIN común recibe 403", async () => {
  identidad = comoUsuario(randomUUID(), randomUUID(), "ADMIN");
  try {
    assert.equal((await fetch(`${baseUrl}/api/admin/organizations/editions`)).status, 403);
    await conPlatformAdmin(async (platformAdminUserId) => {
      identidad = comoUsuario(platformAdminUserId, randomUUID(), "USER");
      const res = await fetch(`${baseUrl}/api/admin/organizations/editions`);
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { editions: ["COMPLETA"] });
    });
  } finally {
    identidad = undefined;
  }
});

test("alta con edition ESENCIAL y la llave en false: 400 y no se crea nada (ni la identidad)", async () => {
  await conPlatformAdmin(async (platformAdminUserId) => {
    identidad = comoUsuario(platformAdminUserId, randomUUID(), "USER");
    const email = emailDePrueba("esencial-cerrada");
    try {
      const res = await post({
        organizationName: `Esencial Cerrada ${Date.now()}`,
        adminFullName: "Ana Pérez",
        adminEmail: email,
        edition: "ESENCIAL",
      });
      assert.equal(res.status, 400);
      const body = (await res.json()) as { error: { message: string } };
      assert.match(body.error.message, /ESENCIAL todavía no está disponible/);
      assert.equal(await prisma.user.findUnique({ where: { email } }), null);
      const { data } = await getSupabaseAdmin().auth.admin.listUsers({ perPage: 1000 });
      assert.equal(
        data.users.some((u) => u.email === email),
        false,
        "no se mandó la invitación",
      );
    } finally {
      identidad = undefined;
    }
  });
});

test("alta con edition COMPLETA: 201, nace COMPLETA y sin proceso de venta", async () => {
  await conPlatformAdmin(async (platformAdminUserId) => {
    identidad = comoUsuario(platformAdminUserId, randomUUID(), "USER");
    let creado: (Creado & { organization: { edition: string } }) | undefined;
    try {
      const res = await post({
        organizationName: `Completa Explicita ${Date.now()}`,
        adminFullName: "Ana Pérez",
        adminEmail: emailDePrueba("completa"),
        edition: "COMPLETA",
      });
      const texto = await res.text();
      assert.equal(res.status, 201, texto);
      creado = JSON.parse(texto) as Creado & { organization: { edition: string } };
      assert.equal(creado.organization.edition, "COMPLETA");
      assert.equal(
        await prisma.pipeline.count({ where: { organizationId: creado.organization.id } }),
        0,
      );
    } finally {
      identidad = undefined;
      if (creado) await limpiarCreado(creado);
    }
  });
});

test("alta con un valor de edition que no existe: 400", async () => {
  await conPlatformAdmin(async (platformAdminUserId) => {
    identidad = comoUsuario(platformAdminUserId, randomUUID(), "USER");
    try {
      const res = await post({
        organizationName: "x",
        adminFullName: "y",
        adminEmail: emailDePrueba("edicion-rara"),
        edition: "PREMIUM",
      });
      assert.equal(res.status, 400);
    } finally {
      identidad = undefined;
    }
  });
});

test("con la llave en true (service inyectado): ESENCIAL nace con el proceso de venta fijo, en la misma alta", async () => {
  let creado: Awaited<ReturnType<typeof createOrganizationWithFoundingAdmin>> | undefined;
  try {
    creado = await createOrganizationWithFoundingAdmin(
      {
        organizationName: `Esencial Abierta ${Date.now()}`,
        adminFullName: "Ana Pérez",
        adminEmail: emailDePrueba("esencial-abierta"),
        edition: "ESENCIAL",
      },
      { ...defaultOrganizationAdminDeps, esencialHabilitada: true },
    );
    assert.equal(creado.organization.edition, "ESENCIAL");
    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: creado.organization.id },
      select: { edition: true },
    });
    assert.equal(org.edition, "ESENCIAL");

    const pipelines = await prisma.pipeline.findMany({
      where: { organizationId: creado.organization.id },
      include: { stages: { orderBy: { order: "asc" } } },
    });
    assert.equal(pipelines.length, 1);
    assert.equal(pipelines[0].name, PROCESO_DE_VENTA_FIJO.name);
    assert.equal(pipelines[0].isDefault, true);
    assert.deepEqual(
      pipelines[0].stages.map((st) => [st.name, st.order, st.isWon, st.isLost]),
      [
        ["En curso", 1, false, false],
        ["Vendida", 2, true, false],
        ["Perdida", 3, false, true],
      ],
    );
  } finally {
    if (creado) {
      await prisma.stage.deleteMany({ where: { organizationId: creado.organization.id } });
      await prisma.pipeline.deleteMany({ where: { organizationId: creado.organization.id } });
      await limpiarCreado(creado);
    }
  }
});

test("PATCH /edition: sube ESENCIAL a COMPLETA; repetir es 200 sin cambios; bajar es 409; inexistente 404; no platform admin 403", async () => {
  const sufijo = randomUUID().slice(0, 8);
  const org = await prisma.organization.create({
    data: { name: `Edicion ${sufijo}`, slug: `edicion-cambio-${sufijo}`, edition: "ESENCIAL" },
  });
  const patch = (id: string, edition: string) =>
    fetch(`${baseUrl}/api/admin/organizations/${id}/edition`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ edition }),
    });
  try {
    identidad = comoUsuario(randomUUID(), org.id, "ADMIN");
    assert.equal((await patch(org.id, "COMPLETA")).status, 403);
    assert.equal(
      (await prisma.organization.findUniqueOrThrow({ where: { id: org.id } })).edition,
      "ESENCIAL",
    );

    await conPlatformAdmin(async (platformAdminUserId) => {
      identidad = comoUsuario(platformAdminUserId, randomUUID(), "USER");

      const subir = await patch(org.id, "COMPLETA");
      assert.equal(subir.status, 200);
      assert.deepEqual(await subir.json(), { id: org.id, edition: "COMPLETA" });
      assert.equal(
        (await prisma.organization.findUniqueOrThrow({ where: { id: org.id } })).edition,
        "COMPLETA",
      );

      const repetir = await patch(org.id, "COMPLETA");
      assert.equal(repetir.status, 200);

      const bajar = await patch(org.id, "ESENCIAL");
      assert.equal(bajar.status, 409);
      assert.equal(
        (await prisma.organization.findUniqueOrThrow({ where: { id: org.id } })).edition,
        "COMPLETA",
      );

      assert.equal((await patch(randomUUID(), "COMPLETA")).status, 404);
      assert.equal((await patch(org.id, "PREMIUM")).status, 400);
    });
  } finally {
    identidad = undefined;
    await prisma.organization.deleteMany({ where: { id: org.id } });
  }
});
