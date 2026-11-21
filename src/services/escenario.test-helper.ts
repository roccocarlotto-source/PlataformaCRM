import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../lib/prisma";
import { getSupabaseAdmin } from "../lib/supabaseAdmin";
import { findRoleByName } from "../repositories/role.repository";
import { AppError } from "../utils/AppError";
import { createBranch } from "./branch.service";

// ---------------------------------------------------------------------------
// Escenario genérico para los tests de integración del núcleo: una
// organización con su sucursal y su ADMIN (usuario real de Supabase Auth, como
// en activity.service.integration-test.ts: users.id comparte valor con
// auth.users.id). SOLO PARA TESTS: el nombre *.test-helper.ts lo deja fuera
// del build, igual que lib/carreras.test-helper.ts.
//
// Vivía en vehicle.test-helper.ts (docs/ordenamiento-productos.md, P3). Los
// tests que crean unidades del stock siguen usando ese helper: su `desmontar`
// borra primero las tablas de vehículos y después llama a este.
//
// El slug y el email empiezan con "veh-" por esa historia. No se cambian: la
// purga de organizaciones de prueba (testOrganizationsPurge.service.ts)
// reconoce por ese prefijo las que quedaron de corridas anteriores.
// ---------------------------------------------------------------------------

const TZ = "America/Argentina/Buenos_Aires";

export interface Escenario {
  organizationId: string;
  branchId: string;
  userId: string;
  authUserId: string;
}

async function createRealAuthUser(label: string) {
  const email = `veh-${label}-${Date.now()}-${randomUUID().slice(0, 8)}@example.test`;
  const { data, error } = await getSupabaseAdmin().auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`No se pudo crear usuario real de Supabase Auth (${label}): ${error?.message}`);
  }
  return { id: data.user.id, email };
}

export async function montar(etiqueta: string): Promise<Escenario> {
  const adminRole = await findRoleByName("ADMIN");
  if (!adminRole) {
    throw new Error("No está sembrado el rol ADMIN. Abortando.");
  }
  const org = await prisma.organization.create({
    data: {
      name: `Vehicle ${etiqueta} ${randomUUID()}`,
      slug: `veh-${etiqueta}-${Date.now()}-${randomUUID().slice(0, 8)}`,
    },
  });
  const branch = await createBranch(org.id, { name: "Casa central", timezone: TZ });
  const auth = await createRealAuthUser(etiqueta);
  const user = await prisma.user.create({
    data: {
      id: auth.id,
      organizationId: org.id,
      roleId: adminRole.id,
      email: auth.email,
      fullName: `Admin ${etiqueta}`,
    },
  });
  return { organizationId: org.id, branchId: branch.id, userId: user.id, authUserId: auth.id };
}

// Borra en el orden que las FK RESTRICT exigen. Lo que el test creó además de
// esto (oportunidades, contactos…) lo borra el propio test antes.
export async function desmontar(...escenarios: Escenario[]) {
  for (const e of escenarios) {
    // Una oportunidad que pasa a WON emite opportunity.won al outbox: la fila
    // referencia la organización.
    await prisma.outboxEvent.deleteMany({ where: { organizationId: e.organizationId } });
    await prisma.branch.deleteMany({ where: { organizationId: e.organizationId } });
    await prisma.user.deleteMany({ where: { organizationId: e.organizationId } });
    await prisma.organization.delete({ where: { id: e.organizationId } });
    await getSupabaseAdmin().auth.admin.deleteUser(e.authUserId);
  }
}

export function assertAppError(err: unknown, statusCode: number, messageIncludes: string) {
  assert.ok(err instanceof AppError, `debe ser AppError, no un error crudo. Fue: ${String(err)}`);
  assert.equal(err.statusCode, statusCode);
  assert.ok(
    err.message.includes(messageIncludes),
    `"${err.message}" no contiene "${messageIncludes}"`,
  );
  return err;
}

export async function capturar(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
  } catch (err) {
    return err;
  }
  assert.fail("se esperaba un error y no hubo ninguno");
}
