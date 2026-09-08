import assert from "node:assert/strict";
import { test } from "node:test";
import { Prisma } from "@prisma/client";
import { AppError } from "../utils/AppError";
import {
  CONSIGNMENT_FIELDS,
  PUBLISH_REQUIRED_FIELDS,
  PUBLISH_REQUIRED_FIELDS_USED,
  PUBLISH_REQUIRED_PHOTOS,
  applyConsignmentRule,
  assertIdentifiersAvailable,
  computeChangeLogEntries,
  computeMissingFieldsForPublish,
  formatInternalCode,
  serializeChangeLogValue,
  type VehicleWritableFields,
} from "./vehicle.service";

// ---------------------------------------------------------------------------
// Las reglas puras del módulo de stock (Fase 2a), sin base: completitud para
// publicar, historial de cambios, vaciado de consignación y unicidad de
// VIN/patente. Mismo criterio que stage.service.test.ts / user.service.test.ts:
// la decisión se prueba acá, y su aplicación contra Postgres real en
// vehicle.integration-test.ts.
// ---------------------------------------------------------------------------

function assertAppError(fn: () => unknown, statusCode: number, messageIncludes: string) {
  assert.throws(fn, (err: unknown) => {
    assert.ok(err instanceof AppError, "debería ser un AppError");
    assert.equal(err.statusCode, statusCode);
    assert.ok(
      err.message.includes(messageIncludes),
      `"${err.message}" no contiene "${messageIncludes}"`,
    );
    return true;
  });
}

// ---------------------------------------------------------------------------
// formatInternalCode
// ---------------------------------------------------------------------------

test("internalCode: STK- con seis dígitos, y sigue creciendo sin truncarse", () => {
  assert.equal(formatInternalCode(1), "STK-000001");
  assert.equal(formatInternalCode(123), "STK-000123");
  assert.equal(formatInternalCode(999_999), "STK-999999");
  assert.equal(formatInternalCode(1_000_000), "STK-1000000");
});

// ---------------------------------------------------------------------------
// computeMissingFieldsForPublish
// ---------------------------------------------------------------------------

const completoNuevo = {
  condition: "NEW" as const,
  bodyType: "SEDAN",
  make: "Toyota",
  model: "Corolla",
  year: 2024,
  priceListUsd: 25_000,
  priceListLocal: 30_000_000,
  transmission: "CVT",
  fuelType: "GASOLINE",
  exteriorColor: "Blanco",
  vin: "9BR53ZEC2P0000001",
};

// La galería con la que la unidad queda. Desde la Fase 2b es el segundo
// argumento: sin foto no se publica.
const conFoto = { photoCount: 1 };
const sinFoto = { photoCount: 0 };

test("publicar: un 0 km con los diez campos siempre exigidos y una foto no tiene faltantes", () => {
  assert.deepEqual(computeMissingFieldsForPublish(completoNuevo, conFoto), []);
});

test("publicar: un usado exige además patente, kilometraje y titular registral", () => {
  assert.deepEqual(
    computeMissingFieldsForPublish({ ...completoNuevo, condition: "USED" }, conFoto),
    [...PUBLISH_REQUIRED_FIELDS_USED],
  );

  assert.deepEqual(
    computeMissingFieldsForPublish(
      {
        ...completoNuevo,
        condition: "USED",
        licensePlate: "AB123CD",
        mileage: 0,
        titleHolder: "Juan Pérez",
      },
      conFoto,
    ),
    [],
  );
});

test("publicar: mileage 0 cuenta como cargado (un 0 km tiene cero kilómetros)", () => {
  const faltantes = computeMissingFieldsForPublish(
    {
      ...completoNuevo,
      condition: "USED",
      licensePlate: "AB123CD",
      mileage: 0,
      titleHolder: "x",
    },
    conFoto,
  );
  assert.deepEqual(faltantes, []);
});

test("publicar: null, undefined y texto en blanco son 'falta'; se listan en el orden de la regla", () => {
  const faltantes = computeMissingFieldsForPublish(
    {
      condition: "NEW",
      bodyType: null,
      make: "Toyota",
      model: "   ",
      year: 2024,
      priceListUsd: undefined,
      priceListLocal: 0,
      transmission: "CVT",
      fuelType: null,
      exteriorColor: "",
      vin: "X",
    },
    conFoto,
  );
  assert.deepEqual(faltantes, ["bodyType", "model", "priceListUsd", "fuelType", "exteriorColor"]);

  // Una ficha vacía lista los diez, en el orden de PUBLISH_REQUIRED_FIELDS.
  assert.deepEqual(computeMissingFieldsForPublish({ condition: "NEW" }, conFoto), [
    ...PUBLISH_REQUIRED_FIELDS,
  ]);
});

test("publicar: sin fotos falta 'photos', siempre al final de la lista, y con una alcanza", () => {
  // Ficha completa, galería vacía: el único faltante es la foto.
  assert.deepEqual(computeMissingFieldsForPublish(completoNuevo, sinFoto), [
    PUBLISH_REQUIRED_PHOTOS,
  ]);
  assert.equal(PUBLISH_REQUIRED_PHOTOS, "photos");

  // Ficha vacía y sin fotos: los diez campos y después la foto, en ese orden.
  assert.deepEqual(computeMissingFieldsForPublish({ condition: "NEW" }, sinFoto), [
    ...PUBLISH_REQUIRED_FIELDS,
    PUBLISH_REQUIRED_PHOTOS,
  ]);

  // Una foto o más: no falta. Un valor negativo sería un bug del caller y
  // cuenta como "sin fotos".
  assert.deepEqual(computeMissingFieldsForPublish(completoNuevo, { photoCount: 3 }), []);
  assert.deepEqual(computeMissingFieldsForPublish(completoNuevo, { photoCount: -1 }), [
    PUBLISH_REQUIRED_PHOTOS,
  ]);
});

// ---------------------------------------------------------------------------
// applyConsignmentRule
// ---------------------------------------------------------------------------

const datosConsignante = {
  consignorName: "María",
  consignorDocument: "12345678",
  consignmentAgreedPriceUsd: 10_000,
};

test("consignación: con origin CONSIGNMENT los datos pasan tal cual", () => {
  const data = { origin: "CONSIGNMENT" as const, ...datosConsignante };
  assert.deepEqual(applyConsignmentRule("CONSIGNMENT", data), data);
});

test("consignación: si la fila no queda en CONSIGNMENT, los ocho campos van a NULL en la misma escritura", () => {
  for (const origin of [
    "DIRECT_PURCHASE",
    "TRADE_IN",
    "IMPORT",
    "BRANCH_TRANSFER",
    null,
  ] as const) {
    const input: Partial<VehicleWritableFields> = { origin, make: "Fiat" };
    const result = applyConsignmentRule(origin, input);
    assert.equal(result.make, "Fiat");
    for (const field of CONSIGNMENT_FIELDS) {
      assert.equal(result[field], null, `${field} debería quedar en null con origin ${origin}`);
    }
    assert.equal(Object.keys(result).length, 2 + CONSIGNMENT_FIELDS.length);
  }
});

test("consignación: un body que manda datos de consignante sin quedar en CONSIGNMENT es 400, no un vaciado silencioso", () => {
  assertAppError(
    () => applyConsignmentRule("TRADE_IN", { origin: "TRADE_IN", ...datosConsignante }),
    400,
    "consignorName, consignorDocument, consignmentAgreedPriceUsd",
  );
  // origin ausente (PATCH que no lo manda) sobre una unidad que no está en
  // consignación: mismo 400.
  assertAppError(() => applyConsignmentRule(null, datosConsignante), 400, "CONSIGNMENT");
  // Mandar los campos EN null sí está permitido: es lo mismo que vaciarlos.
  const result = applyConsignmentRule("IMPORT", { consignorName: null, consignorPhone: null });
  assert.equal(result.consignorName, null);
});

// ---------------------------------------------------------------------------
// serializeChangeLogValue / computeChangeLogEntries
// ---------------------------------------------------------------------------

test("serialización: null/undefined -> null; Date -> día del calendario; Decimal y number iguales comparan igual", () => {
  assert.equal(serializeChangeLogValue(null), null);
  assert.equal(serializeChangeLogValue(undefined), null);
  assert.equal(serializeChangeLogValue(new Date("2026-09-07T00:00:00.000Z")), "2026-09-07");
  assert.equal(serializeChangeLogValue(new Prisma.Decimal("25000.5")), "25000.5");
  assert.equal(serializeChangeLogValue(25_000.5), "25000.5");
  assert.equal(
    serializeChangeLogValue(new Prisma.Decimal("25000")),
    serializeChangeLogValue(25_000),
  );
  assert.equal(serializeChangeLogValue(true), "true");
  assert.equal(serializeChangeLogValue("USED"), "USED");
  assert.equal(serializeChangeLogValue(["ABS", "ESP"]), '["ABS","ESP"]');
});

test("historial: una fila por campo que cambia; lo que llega con el mismo valor no genera fila", () => {
  const before = {
    make: "Toyota",
    priceListUsd: new Prisma.Decimal("25000"),
    stockEnteredAt: new Date("2026-09-01T00:00:00.000Z"),
    equipment: ["ABS"],
    vin: null,
    publishOnWebsite: false,
  };
  const after = {
    make: "Toyota", // igual: sin fila
    priceListUsd: 24_000, // cambia
    stockEnteredAt: new Date("2026-09-01T00:00:00.000Z"), // igual (Date distinto, mismo día)
    equipment: ["ABS", "ESP"], // cambia
    vin: "9BR53ZEC2P0000001", // de null a valor
    publishOnWebsite: undefined, // no vino: se ignora
  };
  assert.deepEqual(computeChangeLogEntries(before, after), [
    { fieldName: "priceListUsd", oldValue: "25000", newValue: "24000" },
    { fieldName: "equipment", oldValue: '["ABS"]', newValue: '["ABS","ESP"]' },
    { fieldName: "vin", oldValue: null, newValue: "9BR53ZEC2P0000001" },
  ]);
});

test("historial: vaciar un campo es una fila con newValue null; un body sin cambios reales es una lista vacía", () => {
  assert.deepEqual(computeChangeLogEntries({ trim: "XEI" }, { trim: null }), [
    { fieldName: "trim", oldValue: "XEI", newValue: null },
  ]);
  assert.deepEqual(
    computeChangeLogEntries({ trim: "XEI", doors: 4 }, { trim: "XEI", doors: 4 }),
    [],
  );
});

// ---------------------------------------------------------------------------
// assertIdentifiersAvailable
// ---------------------------------------------------------------------------

test("unicidad: sin filas en conflicto no pasa nada; con VIN repetido es 409; con patente repetida es 409", () => {
  assert.doesNotThrow(() =>
    assertIdentifiersAvailable([], { vin: "VIN1", licensePlate: "AB123CD" }),
  );
  assert.doesNotThrow(() =>
    assertIdentifiersAvailable([{ vin: "OTRO", licensePlate: "ZZ999ZZ" }], { vin: "VIN1" }),
  );
  assertAppError(
    () => assertIdentifiersAvailable([{ vin: "VIN1", licensePlate: null }], { vin: "VIN1" }),
    409,
    "VIN",
  );
  assertAppError(
    () =>
      assertIdentifiersAvailable([{ vin: null, licensePlate: "AB123CD" }], {
        licensePlate: "AB123CD",
      }),
    409,
    "patente",
  );
});

test("unicidad: un identificador vacío (null/undefined) nunca choca, aunque haya filas con null", () => {
  assert.doesNotThrow(() =>
    assertIdentifiersAvailable([{ vin: null, licensePlate: null }], {
      vin: null,
      licensePlate: undefined,
    }),
  );
});
