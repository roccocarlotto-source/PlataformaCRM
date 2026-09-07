import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { prisma } from "../lib/prisma";
import { getSupabaseAdmin } from "../lib/supabaseAdmin";
import { findRoleByName } from "../repositories/role.repository";
import { AppError } from "../utils/AppError";
import { createBranch } from "./branch.service";
import {
  createVehicle,
  deleteVehicle,
  getVehicleById,
  getVehicleChangeLog,
  listVehicles,
  updateVehicle,
  type CreateVehicleInput,
} from "./vehicle.service";

// ---------------------------------------------------------------------------
// Vehicle contra Postgres real (Fase 2a). Lo que no se puede probar sin base:
// el contador de internalCode y su rollback, el aislamiento entre
// organizaciones, la unicidad de VIN/patente con soft delete de por medio, el
// CHECK de consignación (el vaciado tiene que satisfacerlo de verdad), y que
// el historial se escriba en la misma transacción que el UPDATE.
//
// Las reglas puras están en vehicle.service.test.ts; acá se prueba que el
// service las aplica sobre filas reales. Dos organizaciones, cada una con su
// sucursal y su ADMIN (usuarios reales de Supabase Auth, como en
// activity.service.integration-test.ts).
// ---------------------------------------------------------------------------

const TZ = "America/Argentina/Buenos_Aires";

interface Escenario {
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

async function montar(etiqueta: string): Promise<Escenario> {
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

async function desmontar(...escenarios: Escenario[]) {
  for (const e of escenarios) {
    await prisma.vehicleChangeLog.deleteMany({ where: { organizationId: e.organizationId } });
    await prisma.vehicle.deleteMany({ where: { organizationId: e.organizationId } });
    await prisma.branch.deleteMany({ where: { organizationId: e.organizationId } });
    await prisma.user.deleteMany({ where: { organizationId: e.organizationId } });
    await prisma.organization.delete({ where: { id: e.organizationId } });
    await getSupabaseAdmin().auth.admin.deleteUser(e.authUserId);
  }
}

function assertAppError(err: unknown, statusCode: number, messageIncludes: string) {
  assert.ok(err instanceof AppError, `debe ser AppError, no un error crudo. Fue: ${String(err)}`);
  assert.equal(err.statusCode, statusCode);
  assert.ok(
    err.message.includes(messageIncludes),
    `"${err.message}" no contiene "${messageIncludes}"`,
  );
  return err;
}

async function capturar(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
  } catch (err) {
    return err;
  }
  assert.fail("se esperaba un error y no hubo ninguno");
}

function borrador(e: Escenario, extra: Partial<CreateVehicleInput> = {}) {
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
const completoUsado: Partial<CreateVehicleInput> = {
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

let a: Escenario;
let b: Escenario;

before(async () => {
  a = await montar("a");
  b = await montar("b");
});

after(async () => {
  const vivos = [a, b].filter(Boolean);
  await desmontar(...vivos);
});

// ---------------------------------------------------------------------------
// Crear
// ---------------------------------------------------------------------------

test("crear: internalCode correlativo por organización (STK-000001, STK-000002), y cada organización arranca de 1", async () => {
  const primero = await borrador(a);
  const segundo = await borrador(a);
  const ajeno = await borrador(b);
  assert.equal(primero.internalCode, "STK-000001");
  assert.equal(segundo.internalCode, "STK-000002");
  assert.equal(ajeno.internalCode, "STK-000001");
  assert.equal(primero.status, "AVAILABLE");
  assert.equal(primero.publishOnWebsite, false);
});

test("crear: una transacción que falla revierte el contador — el código no se quema", async () => {
  const antes = await prisma.organization.findUniqueOrThrow({
    where: { id: a.organizationId },
    select: { nextVehicleStockNumber: true },
  });

  // Sucursal de OTRA organización: 400 sin confirmar que exista.
  const ajena = await capturar(() => borrador(a, { branchId: b.branchId }));
  assertAppError(ajena, 400, "La sucursal indicada no existe o no pertenece a tu organización");

  // Vendedor de OTRA organización: mismo criterio.
  const vendedorAjeno = await capturar(() => borrador(a, { assignedSalespersonId: b.userId }));
  assertAppError(vendedorAjeno, 400, "assignedSalespersonId");

  const despues = await prisma.organization.findUniqueOrThrow({
    where: { id: a.organizationId },
    select: { nextVehicleStockNumber: true },
  });
  assert.equal(despues.nextVehicleStockNumber, antes.nextVehicleStockNumber);

  // Y el vendedor propio sí se acepta.
  const conVendedor = await borrador(a, { assignedSalespersonId: a.userId });
  assert.equal(conVendedor.assignedSalespersonId, a.userId);
});

test("crear publicando: 422 con la lista de faltantes en details; completa, se publica", async () => {
  const err = await capturar(() => borrador(a, { publishOnWebsite: true, vin: "VINPUB1" }));
  const appErr = assertAppError(err, 422, "no está completa para publicar");
  assert.deepEqual(appErr.details, {
    missingFields: [
      "bodyType",
      "priceListUsd",
      "priceListLocal",
      "transmission",
      "fuelType",
      "exteriorColor",
      "licensePlate",
      "mileage",
      "titleHolder",
    ],
  });

  const publicado = await borrador(a, {
    ...completoUsado,
    vin: "VINPUB2",
    licensePlate: "PUB002",
    publishOnWebsite: true,
  });
  assert.equal(publicado.publishOnWebsite, true);
});

// ---------------------------------------------------------------------------
// Editar: historial y consignación
// ---------------------------------------------------------------------------

test("editar: una fila de historial por campo que cambia, con quién y los valores serializados; lo que no cambia no genera fila", async () => {
  const v = await borrador(a, { priceListUsd: 25_000, trim: "XEI", equipment: ["ABS"] });

  const editado = await updateVehicle(a.organizationId, a.userId, v.id, {
    priceListUsd: 24_000, // cambia
    trim: "XEI", // igual: sin fila
    make: "Toyota", // igual: sin fila
    equipment: ["ABS", "ESP"], // cambia
    stockEnteredAt: new Date("2026-09-01T00:00:00.000Z"), // de null a fecha
    internalNotes: null, // ya era null: sin fila
  });
  assert.equal(editado.priceListUsd?.toString(), "24000");
  assert.deepEqual(editado.equipment, ["ABS", "ESP"]);

  const log = await getVehicleChangeLog(a.organizationId, v.id, { page: 1, pageSize: 20 });
  assert.equal(log.pagination.total, 3);
  const porCampo = Object.fromEntries(log.data.map((row) => [row.fieldName, row]));
  assert.deepEqual(Object.keys(porCampo).sort(), ["equipment", "priceListUsd", "stockEnteredAt"]);
  assert.equal(porCampo.priceListUsd.oldValue, "25000");
  assert.equal(porCampo.priceListUsd.newValue, "24000");
  assert.equal(porCampo.equipment.oldValue, '["ABS"]');
  assert.equal(porCampo.equipment.newValue, '["ABS","ESP"]');
  assert.equal(porCampo.stockEnteredAt.oldValue, null);
  assert.equal(porCampo.stockEnteredAt.newValue, "2026-09-01");
  for (const row of log.data) {
    assert.equal(row.changedById, a.userId);
    assert.equal(row.changedBy.fullName, "Admin a");
  }

  // Un PATCH sin cambios reales: sin filas nuevas y sin mover updatedAt.
  const sinCambios = await updateVehicle(a.organizationId, a.userId, v.id, {
    priceListUsd: 24_000,
  });
  assert.equal(sinCambios.updatedAt.getTime(), editado.updatedAt.getTime());
  const log2 = await getVehicleChangeLog(a.organizationId, v.id, { page: 1, pageSize: 20 });
  assert.equal(log2.pagination.total, 3);
});

test("editar: el historial va más reciente primero", async () => {
  const v = await borrador(a);
  await updateVehicle(a.organizationId, a.userId, v.id, { mileage: 100 });
  await updateVehicle(a.organizationId, a.userId, v.id, { mileage: 200 });
  const log = await getVehicleChangeLog(a.organizationId, v.id, { page: 1, pageSize: 20 });
  assert.deepEqual(
    log.data.map((row) => row.newValue),
    ["200", "100"],
  );
});

test("consignación: cambiar el origen vacía los ocho campos en la misma escritura (el CHECK lo exige) y queda en el historial", async () => {
  const v = await borrador(a, {
    origin: "CONSIGNMENT",
    consignorName: "María López",
    consignorDocument: "12345678",
    consignorEmail: "maria@example.test",
    consignmentAgreedPriceUsd: 20_000,
    consignmentCommissionPercent: 5,
    consignmentAgreementExpiresAt: new Date("2026-12-31T00:00:00.000Z"),
  });
  assert.equal(v.consignorName, "María López");

  const editado = await updateVehicle(a.organizationId, a.userId, v.id, { origin: "TRADE_IN" });
  assert.equal(editado.origin, "TRADE_IN");
  assert.equal(editado.consignorName, null);
  assert.equal(editado.consignorDocument, null);
  assert.equal(editado.consignorEmail, null);
  assert.equal(editado.consignmentAgreedPriceUsd, null);
  assert.equal(editado.consignmentCommissionPercent, null);
  assert.equal(editado.consignmentAgreementExpiresAt, null);

  const log = await getVehicleChangeLog(a.organizationId, v.id, { page: 1, pageSize: 20 });
  // origin + los seis campos que tenían valor (los dos que ya eran null no
  // generan fila).
  assert.deepEqual(log.data.map((row) => row.fieldName).sort(), [
    "consignmentAgreedPriceUsd",
    "consignmentAgreementExpiresAt",
    "consignmentCommissionPercent",
    "consignorDocument",
    "consignorEmail",
    "consignorName",
    "origin",
  ]);
});

test("consignación: datos de consignante sin quedar en CONSIGNMENT son 400 — en POST y en PATCH", async () => {
  const enPost = await capturar(() =>
    borrador(a, { origin: "DIRECT_PURCHASE", consignorName: "x" }),
  );
  assertAppError(enPost, 400, "CONSIGNMENT");

  const v = await borrador(a, { origin: "IMPORT" });
  const enPatch = await capturar(() =>
    updateVehicle(a.organizationId, a.userId, v.id, { consignorPhone: "123" }),
  );
  assertAppError(enPatch, 400, "CONSIGNMENT");

  // Pasarla a consignación y cargar al consignante en el mismo PATCH sí vale.
  const consignada = await updateVehicle(a.organizationId, a.userId, v.id, {
    origin: "CONSIGNMENT",
    consignorName: "Pedro",
  });
  assert.equal(consignada.consignorName, "Pedro");
});

test("editar publicando: 422 si falta algo; y una unidad publicada no puede quedar incompleta por un PATCH", async () => {
  const v = await borrador(a, { ...completoUsado, vin: "VINED1", licensePlate: "ED0001" });

  const incompleta = await capturar(() =>
    updateVehicle(a.organizationId, a.userId, v.id, { publishOnWebsite: true, vin: null }),
  );
  const err = assertAppError(incompleta, 422, "vin");
  assert.deepEqual(err.details, { missingFields: ["vin"] });

  const publicada = await updateVehicle(a.organizationId, a.userId, v.id, {
    publishOnWebsite: true,
  });
  assert.equal(publicada.publishOnWebsite, true);

  // Ya publicada: vaciar el titular registral la dejaría publicada e
  // incompleta. 422 y nada escrito.
  const vaciar = await capturar(() =>
    updateVehicle(a.organizationId, a.userId, v.id, { titleHolder: null }),
  );
  assertAppError(vaciar, 422, "titleHolder");
  const intacta = await getVehicleById(a.organizationId, v.id);
  assert.equal(intacta.titleHolder, "Juan Pérez");

  // Despublicar y recién ahí vaciar: válido.
  await updateVehicle(a.organizationId, a.userId, v.id, {
    publishOnWebsite: false,
    titleHolder: null,
  });
});

// ---------------------------------------------------------------------------
// Unicidad de VIN / patente
// ---------------------------------------------------------------------------

test("unicidad: VIN/patente no se repiten entre unidades vivas de la organización; sí entre organizaciones y con una dada de baja", async () => {
  const original = await borrador(a, { vin: "VINUNI1", licensePlate: "UNI001" });

  const mismoVin = await capturar(() => borrador(a, { vin: "VINUNI1" }));
  assertAppError(mismoVin, 409, "VIN");
  const mismaPatente = await capturar(() => borrador(a, { licensePlate: "UNI001" }));
  assertAppError(mismaPatente, 409, "patente");

  // Otra organización puede tener la misma unidad cargada.
  const enOtraOrg = await borrador(b, { vin: "VINUNI1", licensePlate: "UNI001" });
  assert.equal(enOtraOrg.vin, "VINUNI1");

  // PATCH hacia un VIN ocupado por otra unidad viva: 409. Hacia el propio: ok.
  const otra = await borrador(a, { vin: "VINUNI2" });
  const choque = await capturar(() =>
    updateVehicle(a.organizationId, a.userId, otra.id, { vin: "VINUNI1" }),
  );
  assertAppError(choque, 409, "VIN");
  const propio = await updateVehicle(a.organizationId, a.userId, original.id, {
    vin: "VINUNI1",
    mileage: 1,
  });
  assert.equal(propio.vin, "VINUNI1");

  // Dada de baja la original, su VIN vuelve a estar disponible.
  await deleteVehicle(a.organizationId, original.id);
  const reutilizado = await updateVehicle(a.organizationId, a.userId, otra.id, {
    vin: "VINUNI1",
  });
  assert.equal(reutilizado.vin, "VINUNI1");
});

// ---------------------------------------------------------------------------
// Listar, dar de baja, anti-enumeración
// ---------------------------------------------------------------------------

test("listar: solo la organización del caller y sin dadas de baja; status multi, consignmentOnly y q", async () => {
  const c = await montar("c");
  try {
    const disponible = await borrador(c, { make: "Fiat", model: "Cronos", status: "AVAILABLE" });
    const reservada = await borrador(c, { make: "Fiat", model: "Argo", status: "RESERVED" });
    const vendida = await borrador(c, { make: "Peugeot", model: "208", status: "SOLD" });
    const consignada = await borrador(c, {
      make: "Renault",
      model: "Kwid",
      origin: "CONSIGNMENT",
      licensePlate: "KW1234",
    });
    const baja = await borrador(c, { make: "Baja", model: "X" });
    await deleteVehicle(c.organizationId, baja.id);

    const base = { page: 1, pageSize: 20, sortBy: "createdAt" as const, sortOrder: "asc" as const };

    const todos = await listVehicles(c.organizationId, base);
    assert.deepEqual(
      todos.data.map((v) => v.id),
      [disponible.id, reservada.id, vendida.id, consignada.id],
    );
    assert.equal(todos.pagination.total, 4);

    const porEstado = await listVehicles(c.organizationId, {
      ...base,
      status: ["AVAILABLE", "RESERVED"],
      make: "Fiat",
    });
    assert.deepEqual(
      porEstado.data.map((v) => v.id),
      [disponible.id, reservada.id],
    );

    const soloConsignacion = await listVehicles(c.organizationId, {
      ...base,
      consignmentOnly: true,
    });
    assert.deepEqual(
      soloConsignacion.data.map((v) => v.id),
      [consignada.id],
    );

    const porTexto = await listVehicles(c.organizationId, { ...base, q: "kw12" });
    assert.deepEqual(
      porTexto.data.map((v) => v.id),
      [consignada.id],
    );
    const porCodigo = await listVehicles(c.organizationId, { ...base, q: "stk-00000" });
    assert.equal(porCodigo.pagination.total, 4);

    // Desde otra organización no se ve nada de esto.
    const desdeA = await listVehicles(a.organizationId, { ...base, q: "Cronos" });
    assert.equal(desdeA.pagination.total, 0);
  } finally {
    await desmontar(c);
  }
});

test("anti-enumeración: una unidad de otra organización, inexistente o dada de baja es el mismo 404 en detalle, historial, PATCH y DELETE", async () => {
  const ajena = await borrador(b);
  const propia = await borrador(a);
  await deleteVehicle(a.organizationId, propia.id);

  for (const id of [ajena.id, randomUUID(), propia.id]) {
    for (const fn of [
      () => getVehicleById(a.organizationId, id),
      () => getVehicleChangeLog(a.organizationId, id, { page: 1, pageSize: 20 }),
      () => updateVehicle(a.organizationId, a.userId, id, { mileage: 1 }),
      () => deleteVehicle(a.organizationId, id),
    ]) {
      assertAppError(await capturar(fn), 404, "Vehículo no encontrado");
    }
  }

  // Y la ajena sigue intacta.
  const intacta = await getVehicleById(b.organizationId, ajena.id);
  assert.equal(intacta.deletedAt, null);
});
