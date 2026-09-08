import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { Prisma } from "@prisma/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Db } from "../lib/prisma";
import { logger } from "../lib/logger";
import { AppError } from "../utils/AppError";
import {
  createOrganizationWithFoundingAdmin,
  primaryCorsOrigin,
  type OrganizationAdminDeps,
} from "./organizationAdmin.service";

// ---------------------------------------------------------------------------
// SIN BASE NI SUPABASE: cada dependencia externa del service entra por `deps`
// (ver el encabezado de organizationAdmin.service.ts) y acá se reemplaza por
// una función que registra con qué la llamaron. Lo que se prueba es el
// ORDEN y la COMPENSACIÓN —qué se escribió y qué se borró en cada camino—,
// que es exactamente lo que un test contra la base real no puede afirmar
// cuando Supabase está en el medio. El endpoint entero, contra Postgres y
// GoTrue reales, lo cubre organizationAdmin.controller.integration-test.ts.
// ---------------------------------------------------------------------------

const ROLE_ADMIN = { id: "role-admin", name: "ADMIN" };
const AUTH_USER_ID = "11111111-1111-4111-8111-111111111111";

interface Registro {
  invites: { email: string; options: unknown }[];
  deletedAuthUsers: string[];
  organizationsCreated: { name: string; slug: string }[];
  usersCreated: Record<string, unknown>[];
}

interface Escenario {
  deps: OrganizationAdminDeps;
  registro: Registro;
}

interface Opciones {
  usuarioExistente?: boolean;
  invitacionPendiente?: boolean;
  organizacionExistente?: boolean;
  inviteError?: { code?: string; message: string };
  fallaTransaccion?: unknown;
  fallaDeleteUser?: boolean;
}

// Un `tx` de mentira: el service solo lo pasa de largo a los repositorios
// inyectados, que acá también son de mentira, así que nunca se toca.
const TX = {} as Db;

function armar(opciones: Opciones = {}): Escenario {
  const registro: Registro = {
    invites: [],
    deletedAuthUsers: [],
    organizationsCreated: [],
    usersCreated: [],
  };

  const supabaseAdmin = {
    auth: {
      admin: {
        inviteUserByEmail: async (email: string, options: unknown) => {
          registro.invites.push({ email, options });
          if (opciones.inviteError) {
            return { data: { user: null }, error: opciones.inviteError };
          }
          return { data: { user: { id: AUTH_USER_ID, email } }, error: null };
        },
        deleteUser: async (id: string) => {
          if (opciones.fallaDeleteUser) {
            throw new Error("GoTrue caído");
          }
          registro.deletedAuthUsers.push(id);
          return { data: { user: null }, error: null };
        },
      },
    },
  } as unknown as SupabaseClient;

  const deps: OrganizationAdminDeps = {
    supabaseAdmin: () => supabaseAdmin,
    frontendOrigin: "https://app.test",
    findUserByEmail: async () => (opciones.usuarioExistente ? { id: "otro" } : null),
    findPendingInvitationByEmail: async () => (opciones.invitacionPendiente ? { id: "inv" } : null),
    findOrganizationBySlug: async () =>
      opciones.organizacionExistente ? { id: "org-vieja" } : null,
    findRoleByName: async () => ROLE_ADMIN,
    createOrganization: async (data) => {
      registro.organizationsCreated.push(data);
      return { id: "org-nueva", ...data };
    },
    createUser: async (data) => {
      registro.usersCreated.push(data);
      return data;
    },
    transaction: async (fn) => {
      if (opciones.fallaTransaccion !== undefined) {
        throw opciones.fallaTransaccion;
      }
      return fn(TX);
    },
  };

  return { deps, registro };
}

const INPUT = {
  organizationName: "Automotora Pérez",
  adminFullName: "Juan Pérez",
  adminEmail: "  Juan.Perez@Example.test ",
};

async function esperarAppError(fn: () => Promise<unknown>, status: number): Promise<AppError> {
  try {
    await fn();
  } catch (err) {
    assert.ok(err instanceof AppError, `esperaba AppError, vino ${String(err)}`);
    assert.equal(err.statusCode, status);
    return err;
  }
  assert.fail(`esperaba un AppError ${String(status)} y no lanzó nada`);
}

test("camino feliz: pre-chequeos, invite con redirectTo al frontend, Organization + User ADMIN, sin compensación", async () => {
  const { deps, registro } = armar();

  const result = await createOrganizationWithFoundingAdmin(INPUT, deps);

  // El email viaja normalizado (trim + lowercase) a todos lados.
  assert.deepEqual(registro.invites, [
    {
      email: "juan.perez@example.test",
      options: {
        data: { full_name: "Juan Pérez" },
        redirectTo: "https://app.test/reset-password",
      },
    },
  ]);
  assert.deepEqual(registro.organizationsCreated, [
    { name: "Automotora Pérez", slug: "automotora-perez" },
  ]);
  assert.deepEqual(registro.usersCreated, [
    {
      id: AUTH_USER_ID,
      organizationId: "org-nueva",
      roleId: ROLE_ADMIN.id,
      email: "juan.perez@example.test",
      fullName: "Juan Pérez",
    },
  ]);
  assert.deepEqual(registro.deletedAuthUsers, []);

  assert.deepEqual(result, {
    organization: { id: "org-nueva", name: "Automotora Pérez", slug: "automotora-perez" },
    admin: {
      id: AUTH_USER_ID,
      email: "juan.perez@example.test",
      fullName: "Juan Pérez",
      role: "ADMIN",
    },
  });
});

test("nombre que slugifica a vacío: 400 antes de tocar nada", async () => {
  const { deps, registro } = armar();

  await esperarAppError(
    () => createOrganizationWithFoundingAdmin({ ...INPUT, organizationName: "株式会社" }, deps),
    400,
  );
  assert.equal(registro.invites.length, 0);
});

test("conflicto de email (ya hay User con ese email): 409 sin invitar ni escribir", async () => {
  const { deps, registro } = armar({ usuarioExistente: true });

  const err = await esperarAppError(() => createOrganizationWithFoundingAdmin(INPUT, deps), 409);
  assert.equal(err.message, "Ya existe una cuenta con ese email");
  assert.equal(registro.invites.length, 0);
  assert.equal(registro.organizationsCreated.length, 0);
});

test("invitación pendiente para ese email: 409 sin invitar ni escribir", async () => {
  const { deps, registro } = armar({ invitacionPendiente: true });

  await esperarAppError(() => createOrganizationWithFoundingAdmin(INPUT, deps), 409);
  assert.equal(registro.invites.length, 0);
  assert.equal(registro.organizationsCreated.length, 0);
});

test("conflicto de slug (ya hay Organization con ese nombre): 409 sin invitar ni escribir", async () => {
  const { deps, registro } = armar({ organizacionExistente: true });

  const err = await esperarAppError(() => createOrganizationWithFoundingAdmin(INPUT, deps), 409);
  assert.equal(err.message, "Ya existe una organización con ese nombre");
  assert.equal(registro.invites.length, 0);
  assert.equal(registro.organizationsCreated.length, 0);
});

test("si Supabase falla al invitar: no se creó nada en Postgres y no hay nada que compensar", async () => {
  const { deps, registro } = armar({ inviteError: { message: "smtp caído" } });
  const errorLog = mock.method(logger, "error", () => undefined);
  try {
    const err = await esperarAppError(() => createOrganizationWithFoundingAdmin(INPUT, deps), 502);
    assert.equal(err.message, "No se pudo enviar la invitación");
  } finally {
    errorLog.mock.restore();
  }

  assert.equal(registro.invites.length, 1);
  assert.equal(registro.organizationsCreated.length, 0);
  assert.equal(registro.usersCreated.length, 0);
  assert.deepEqual(registro.deletedAuthUsers, []);
});

test("si Supabase rechaza el email por duplicado (email_exists): 409, no 502", async () => {
  const { deps } = armar({
    inviteError: {
      code: "email_exists",
      message: "A user with this email address has already been registered",
    },
  });

  const err = await esperarAppError(() => createOrganizationWithFoundingAdmin(INPUT, deps), 409);
  assert.equal(err.message, "Ese email ya está registrado en la plataforma");
});

test("si Prisma falla después de Supabase: se borra la identidad recién creada y sube el error traducido", async () => {
  const { deps, registro } = armar({ fallaTransaccion: new Error("postgres caído") });
  const errorLog = mock.method(logger, "error", () => undefined);
  try {
    await esperarAppError(() => createOrganizationWithFoundingAdmin(INPUT, deps), 500);
  } finally {
    errorLog.mock.restore();
  }

  assert.equal(registro.invites.length, 1);
  assert.deepEqual(registro.deletedAuthUsers, [AUTH_USER_ID]);
});

test("P2002 en la transacción se traduce a 409 por slug o por email, y también compensa", async () => {
  const p2002 = (target: string[]) =>
    new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "test",
      meta: { target },
    });

  {
    const { deps, registro } = armar({ fallaTransaccion: p2002(["slug"]) });
    const err = await esperarAppError(() => createOrganizationWithFoundingAdmin(INPUT, deps), 409);
    assert.equal(err.message, "Ya existe una organización con ese nombre");
    assert.deepEqual(registro.deletedAuthUsers, [AUTH_USER_ID]);
  }
  {
    const { deps, registro } = armar({ fallaTransaccion: p2002(["email"]) });
    const err = await esperarAppError(() => createOrganizationWithFoundingAdmin(INPUT, deps), 409);
    assert.equal(err.message, "Ya existe una cuenta con ese email");
    assert.deepEqual(registro.deletedAuthUsers, [AUTH_USER_ID]);
  }
});

test("si además falla el borrado de la identidad: el error que sube es el original y el huérfano queda en el log", async () => {
  const { deps } = armar({
    fallaTransaccion: new Error("postgres caído"),
    fallaDeleteUser: true,
  });
  const errorLog = mock.method(logger, "error", () => undefined);
  try {
    await esperarAppError(() => createOrganizationWithFoundingAdmin(INPUT, deps), 500);

    const huerfano = errorLog.mock.calls.find((call) => {
      const [payload] = call.arguments as [{ orphanedAuthUserId?: string }];
      return payload.orphanedAuthUserId === AUTH_USER_ID;
    });
    assert.ok(huerfano, "el id de la identidad huérfana tiene que quedar en el log");
  } finally {
    errorLog.mock.restore();
  }
});

test("primaryCorsOrigin toma el primer origen de la lista separada por comas, sin espacios", () => {
  assert.equal(primaryCorsOrigin("https://app.test"), "https://app.test");
  assert.equal(primaryCorsOrigin(" https://app.test , http://localhost:5173"), "https://app.test");
});
