import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../lib/prisma";
import { getSupabaseAdmin } from "../lib/supabaseAdmin";
import { findRoleByName } from "../repositories/role.repository";
import { AppError } from "../utils/AppError";
import { createBranch } from "./branch.service";
import { createVehicle, type CreateVehicleInput } from "./vehicle.service";

// ---------------------------------------------------------------------------
// Escenarios del módulo de stock de vehículos para los tests de integración
// (vehicle.integration-test.ts y vehiclePhoto.integration-test.ts). SOLO PARA
// TESTS: el nombre *.test-helper.ts lo deja fuera del build, igual que
// lib/carreras.test-helper.ts.
//
// Una organización con su sucursal y su ADMIN (usuario real de Supabase Auth,
// como en activity.service.integration-test.ts: users.id comparte valor con
// auth.users.id). desmontar borra en el orden que las FK RESTRICT exigen —
// las fotos antes que las unidades.
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

export async function desmontar(...escenarios: Escenario[]) {
  for (const e of escenarios) {
    await prisma.vehiclePhoto.deleteMany({ where: { organizationId: e.organizationId } });
    await prisma.vehicleChangeLog.deleteMany({ where: { organizationId: e.organizationId } });
    await prisma.vehicle.deleteMany({ where: { organizationId: e.organizationId } });
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

export function borrador(e: Escenario, extra: Partial<CreateVehicleInput> = {}) {
  return createVehicle(e.organizationId, {
    condition: "USED",
    make: "Toyota",
    model: "Corolla",
    year: 2022,
    branchId: e.branchId,
    ...extra,
  });
}

// Una ficha que cumple los diez campos siempre exigidos más los tres de usado.
// Le falta solo la foto para poder publicarse.
export const completoUsado: Partial<CreateVehicleInput> = {
  bodyType: "SEDAN",
  priceListUsd: 25_000,
  priceListLocal: 30_000_000,
  transmission: "CVT",
  fuelType: "GASOLINE",
  exteriorColor: "Blanco",
  vin: "9BR53ZEC2P0000001",
  licensePlate: "AB123CD",
  mileage: 45_000,
  titleHolder: "Juan Pérez",
};

// Una fila de VehiclePhoto SIN objeto en Storage, para los tests que solo
// necesitan que la unidad "tenga una foto" (la regla de completitud) y no
// hablan con Storage. Los que sí lo hacen usan uploadVehiclePhoto.
export function fotoSinStorage(e: Escenario, vehicleId: string, position = 0, isCover = true) {
  return prisma.vehiclePhoto.create({
    data: {
      organizationId: e.organizationId,
      vehicleId,
      storagePath: `${e.organizationId}/${vehicleId}/${randomUUID()}.jpg`,
      position,
      isCover,
    },
  });
}
