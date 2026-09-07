import assert from "node:assert/strict";
import { test } from "node:test";
import {
  changeLogQuerySchema,
  createVehicleSchema,
  listVehiclesQuerySchema,
  updateVehicleSchema,
} from "./vehicle.controller";

// La frontera de validación del módulo de stock de vehículos, sin base y sin
// HTTP — mismo criterio que qr.controller.test.ts. Los permisos (lectura para
// cualquier autenticado, escritura solo ADMIN) los fija vehicle.routes.ts y
// su montaje se verifica en routes/index.test.ts contra la app real.

const BRANCH_ID = "0a3f0d9c-1b2e-4c5d-8e7f-9a0b1c2d3e4f";
const USER_ID = "1b4f0d9c-1b2e-4c5d-8e7f-9a0b1c2d3e4f";

const minimo = {
  condition: "USED",
  make: " Toyota ",
  model: "Corolla",
  year: 2022,
  branchId: BRANCH_ID,
};

test("POST: camino feliz mínimo — solo los NOT NULL reales, trim en make, nada más se inventa", () => {
  const r = createVehicleSchema.safeParse(minimo);
  assert.equal(r.success, true);
  assert.deepEqual(r.success && r.data, {
    condition: "USED",
    make: "Toyota",
    model: "Corolla",
    year: 2022,
    branchId: BRANCH_ID,
  });
});

test("POST: condition, make, model, year y branchId son obligatorios", () => {
  for (const campo of ["condition", "make", "model", "year", "branchId"] as const) {
    const sin = { ...minimo, [campo]: undefined };
    assert.equal(createVehicleSchema.safeParse(sin).success, false, campo);
  }
  assert.equal(createVehicleSchema.safeParse({ ...minimo, make: "   " }).success, false);
  assert.equal(createVehicleSchema.safeParse({ ...minimo, condition: "0KM" }).success, false);
  assert.equal(createVehicleSchema.safeParse({ ...minimo, branchId: "x" }).success, false);
});

test("POST: year entero entre 1900 y 2100 (el CHECK de la base, repetido en el borde)", () => {
  assert.equal(createVehicleSchema.safeParse({ ...minimo, year: 1899 }).success, false);
  assert.equal(createVehicleSchema.safeParse({ ...minimo, year: 2101 }).success, false);
  assert.equal(createVehicleSchema.safeParse({ ...minimo, year: 2022.5 }).success, false);
  assert.equal(createVehicleSchema.safeParse({ ...minimo, year: "2022" }).success, false);
  assert.equal(createVehicleSchema.safeParse({ ...minimo, year: 1900 }).success, true);
  assert.equal(createVehicleSchema.safeParse({ ...minimo, year: 2100 }).success, true);
});

test("VIN y patente: mayúsculas y sin espacios; vacío -> null; largo máximo del VarChar", () => {
  const r = createVehicleSchema.safeParse({
    ...minimo,
    vin: " 9br53zec2p0000001 ",
    licensePlate: "ab 123 cd",
  });
  assert.equal(r.success, true);
  assert.equal(r.success && r.data.vin, "9BR53ZEC2P0000001");
  assert.equal(r.success && r.data.licensePlate, "AB123CD");

  const vacio = createVehicleSchema.safeParse({ ...minimo, vin: "   ", licensePlate: "" });
  assert.equal(vacio.success && vacio.data.vin, null);
  assert.equal(vacio.success && vacio.data.licensePlate, null);

  assert.equal(createVehicleSchema.safeParse({ ...minimo, vin: "a".repeat(31) }).success, false);
  assert.equal(
    createVehicleSchema.safeParse({ ...minimo, licensePlate: "a".repeat(21) }).success,
    false,
  );
});

test("texto nullable: trim y vacío -> null; largo del VarChar", () => {
  const r = createVehicleSchema.safeParse({ ...minimo, trim: "  ", exteriorColor: " Gris " });
  assert.equal(r.success, true);
  assert.equal(r.success && r.data.trim, null);
  assert.equal(r.success && r.data.exteriorColor, "Gris");
  assert.equal(
    createVehicleSchema.safeParse({ ...minimo, exteriorColor: "a".repeat(51) }).success,
    false,
  );
});

test("montos: z.number() sin coerce (M-9), >= 0, null admitido; comisión 0..100", () => {
  assert.equal(createVehicleSchema.safeParse({ ...minimo, priceListUsd: -1 }).success, false);
  assert.equal(createVehicleSchema.safeParse({ ...minimo, priceListUsd: "25000" }).success, false);
  assert.equal(createVehicleSchema.safeParse({ ...minimo, priceListUsd: 0 }).success, true);
  const nulo = createVehicleSchema.safeParse({ ...minimo, priceListUsd: null });
  assert.equal(nulo.success && nulo.data.priceListUsd, null);

  assert.equal(
    createVehicleSchema.safeParse({ ...minimo, consignmentCommissionPercent: 100.01 }).success,
    false,
  );
  assert.equal(
    createVehicleSchema.safeParse({ ...minimo, consignmentCommissionPercent: 12.5 }).success,
    true,
  );
});

test("magnitudes técnicas: mileage >= 0 entero; puertas/asientos/hp enteros > 0; cilindrada > 0", () => {
  assert.equal(createVehicleSchema.safeParse({ ...minimo, mileage: 0 }).success, true);
  assert.equal(createVehicleSchema.safeParse({ ...minimo, mileage: -1 }).success, false);
  assert.equal(createVehicleSchema.safeParse({ ...minimo, mileage: 10.5 }).success, false);
  assert.equal(createVehicleSchema.safeParse({ ...minimo, doors: 0 }).success, false);
  assert.equal(createVehicleSchema.safeParse({ ...minimo, seats: 5 }).success, true);
  assert.equal(createVehicleSchema.safeParse({ ...minimo, powerHp: 1.5 }).success, false);
  assert.equal(
    createVehicleSchema.safeParse({ ...minimo, cylinderCapacityLiters: 0 }).success,
    false,
  );
  assert.equal(
    createVehicleSchema.safeParse({ ...minimo, cylinderCapacityLiters: 1.6 }).success,
    true,
  );
});

test("fechas: @db.Date llegan como ISO y se coaccionan a Date; null las vacía", () => {
  const r = createVehicleSchema.safeParse({ ...minimo, stockEnteredAt: "2026-09-07" });
  assert.equal(r.success, true);
  assert.ok(r.success && r.data.stockEnteredAt instanceof Date);
  assert.equal(r.success && r.data.stockEnteredAt?.toISOString(), "2026-09-07T00:00:00.000Z");
  const nulo = createVehicleSchema.safeParse({ ...minimo, stockEnteredAt: null });
  assert.equal(nulo.success && nulo.data.stockEnteredAt, null);
  assert.equal(createVehicleSchema.safeParse({ ...minimo, stockEnteredAt: "ayer" }).success, false);
});

test("consignorEmail válido o null; URLs http(s) y hasta 2048", () => {
  assert.equal(
    createVehicleSchema.safeParse({ ...minimo, consignorEmail: "no-es-email" }).success,
    false,
  );
  assert.equal(
    createVehicleSchema.safeParse({ ...minimo, consignorEmail: "maria@example.test" }).success,
    true,
  );
  assert.equal(createVehicleSchema.safeParse({ ...minimo, consignorEmail: null }).success, true);
  assert.equal(
    createVehicleSchema.safeParse({ ...minimo, videoUrl: "javascript:alert(1)" }).success,
    false,
  );
  assert.equal(
    createVehicleSchema.safeParse({ ...minimo, tour360Url: "https://x.test/tour" }).success,
    true,
  );
});

test("equipment: códigos en mayúsculas, sin repetidos, forma [A-Z0-9_]", () => {
  const r = createVehicleSchema.safeParse({ ...minimo, equipment: [" abs ", "AIRBAG_LATERAL"] });
  assert.deepEqual(r.success && r.data.equipment, ["ABS", "AIRBAG_LATERAL"]);
  assert.equal(
    createVehicleSchema.safeParse({ ...minimo, equipment: ["ABS", "abs"] }).success,
    false,
  );
  assert.equal(
    createVehicleSchema.safeParse({ ...minimo, equipment: ["aire acondicionado"] }).success,
    false,
  );
  assert.equal(createVehicleSchema.safeParse({ ...minimo, equipment: [] }).success, true);
});

test("enums y booleanos: valores del schema, sin coerción", () => {
  assert.equal(createVehicleSchema.safeParse({ ...minimo, status: "SOLD" }).success, true);
  assert.equal(createVehicleSchema.safeParse({ ...minimo, status: "VENDIDO" }).success, false);
  assert.equal(createVehicleSchema.safeParse({ ...minimo, origin: null }).success, true);
  assert.equal(
    createVehicleSchema.safeParse({ ...minimo, publishOnWebsite: "true" }).success,
    false,
  );
  assert.equal(createVehicleSchema.safeParse({ ...minimo, publishOnWebsite: true }).success, true);
  assert.equal(
    createVehicleSchema.safeParse({ ...minimo, assignedSalespersonId: USER_ID }).success,
    true,
  );
  assert.equal(
    createVehicleSchema.safeParse({ ...minimo, assignedSalespersonId: null }).success,
    true,
  );
});

test("campos desconocidos y campos del sistema se descartan (strip): no llegan al service", () => {
  const r = createVehicleSchema.safeParse({
    ...minimo,
    internalCode: "STK-999999",
    organizationId: BRANCH_ID,
    deletedAt: "2026-01-01",
    loQueSea: 1,
  });
  assert.equal(r.success, true);
  assert.deepEqual(r.success && Object.keys(r.data).sort(), [
    "branchId",
    "condition",
    "make",
    "model",
    "year",
  ]);
});

test("PATCH: parcial, exige al menos un campo, null vacía, obligatorios de POST son opcionales acá", () => {
  assert.equal(updateVehicleSchema.safeParse({}).success, false);
  assert.equal(updateVehicleSchema.safeParse({ internalCode: "x" }).success, false);
  assert.equal(updateVehicleSchema.safeParse({ status: "RESERVED" }).success, true);

  const limpiar = updateVehicleSchema.safeParse({ vin: null, priceListUsd: null });
  assert.equal(limpiar.success, true);
  assert.deepEqual(limpiar.success && limpiar.data, { vin: null, priceListUsd: null });

  // Los NOT NULL no admiten null tampoco en PATCH.
  assert.equal(updateVehicleSchema.safeParse({ make: null }).success, false);
  assert.equal(updateVehicleSchema.safeParse({ branchId: null }).success, false);
  assert.equal(updateVehicleSchema.safeParse({ year: null }).success, false);
});

test("listado: defaults, tope de pageSize (B-21), filtros opcionales", () => {
  const r = listVehiclesQuerySchema.safeParse({});
  assert.deepEqual(r.success && r.data, {
    page: 1,
    pageSize: 20,
    sortBy: "createdAt",
    sortOrder: "desc",
  });
  assert.equal(listVehiclesQuerySchema.safeParse({ pageSize: "101" }).success, false);
  assert.equal(listVehiclesQuerySchema.safeParse({ page: "10001" }).success, false);
  assert.equal(listVehiclesQuerySchema.safeParse({ branchId: "x" }).success, false);
  assert.equal(listVehiclesQuerySchema.safeParse({ sortBy: "make" }).success, false);
  assert.equal(
    listVehiclesQuerySchema.safeParse({ sortBy: "priceListUsd", sortOrder: "asc" }).success,
    true,
  );
});

test("listado: status es multi-selección — repetido (array de Express) o separado por comas", () => {
  const uno = listVehiclesQuerySchema.safeParse({ status: "AVAILABLE" });
  assert.deepEqual(uno.success && uno.data.status, ["AVAILABLE"]);

  const repetido = listVehiclesQuerySchema.safeParse({ status: ["AVAILABLE", "RESERVED"] });
  assert.deepEqual(repetido.success && repetido.data.status, ["AVAILABLE", "RESERVED"]);

  const comas = listVehiclesQuerySchema.safeParse({ status: "AVAILABLE,SOLD" });
  assert.deepEqual(comas.success && comas.data.status, ["AVAILABLE", "SOLD"]);

  assert.equal(listVehiclesQuerySchema.safeParse({ status: "VENDIDO" }).success, false);
  assert.equal(listVehiclesQuerySchema.safeParse({ status: ["AVAILABLE", "x"] }).success, false);
});

test("listado: consignmentOnly es 'true'/'false' explícito; precios y q se coaccionan/recortan", () => {
  const si = listVehiclesQuerySchema.safeParse({ consignmentOnly: "true" });
  assert.equal(si.success && si.data.consignmentOnly, true);
  const no = listVehiclesQuerySchema.safeParse({ consignmentOnly: "false" });
  assert.equal(no.success && no.data.consignmentOnly, false);
  assert.equal(listVehiclesQuerySchema.safeParse({ consignmentOnly: "1" }).success, false);

  const rango = listVehiclesQuerySchema.safeParse({
    minPriceUsd: "10000",
    maxPriceUsd: "20000",
    q: " corolla ",
    condition: "USED",
  });
  assert.equal(rango.success, true);
  assert.equal(rango.success && rango.data.minPriceUsd, 10_000);
  assert.equal(rango.success && rango.data.maxPriceUsd, 20_000);
  assert.equal(rango.success && rango.data.q, "corolla");
  assert.equal(listVehiclesQuerySchema.safeParse({ minPriceUsd: "-1" }).success, false);
  assert.equal(listVehiclesQuerySchema.safeParse({ q: "   " }).success, false);
});

test("historial: paginado con los mismos defaults y tope", () => {
  const r = changeLogQuerySchema.safeParse({});
  assert.deepEqual(r.success && r.data, { page: 1, pageSize: 20 });
  assert.equal(changeLogQuerySchema.safeParse({ pageSize: "101" }).success, false);
});
