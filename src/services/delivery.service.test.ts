import assert from "node:assert/strict";
import { test } from "node:test";
import type { VehicleStatus } from "@prisma/client";
import { AppError } from "../utils/AppError";
import {
  assertConfirmable,
  assertEditable,
  DEFAULT_DELIVERY_CHECKLIST_LABELS,
  defaultDeliveryChecklist,
  ENTREGA_CONFIRMADA_INMUTABLE,
  ENTREGA_YA_CONFIRMADA,
  normalizeChecklist,
  UNIDAD_NO_VENDIDA,
} from "./delivery.service";

// ---------------------------------------------------------------------------
// Reglas puras de la entrega (§40 de docs/frontend-cambios-pendientes.md).
// Sin base ni mocks, mismo criterio que quote.service.test.ts. La aplicación
// real —la creación automática al ganar, el lock de organización, las
// carreras y el aislamiento entre organizaciones— está en
// delivery.service.integration-test.ts y en tenant-isolation.integration-test.ts.
// ---------------------------------------------------------------------------

const VEHICLE_ID = "7a6f1c1e-7c1a-4b2a-9d53-0d6b7e0a1f01";

const TODOS_LOS_ESTADOS_DE_UNIDAD: VehicleStatus[] = [
  "AVAILABLE",
  "RESERVED",
  "IN_PREPARATION",
  "IN_TRANSIT",
  "SOLD",
  "DELIVERED",
];

function assertAppError(fn: () => unknown, statusCode: number, messageIncludes: string) {
  assert.throws(fn, (err: unknown) => {
    assert.ok(err instanceof AppError, `debe ser AppError. Fue: ${String(err)}`);
    assert.equal(err.statusCode, statusCode);
    assert.ok(err.message.includes(messageIncludes), `"${err.message}"`);
    return true;
  });
}

// --- Checklist default ------------------------------------------------------

test("el checklist default trae los cinco ítems fijos, todos sin tildar", () => {
  assert.deepEqual(defaultDeliveryChecklist(), [
    { label: "Documentación de transferencia", checked: false },
    { label: "Manual del vehículo", checked: false },
    { label: "Llave de repuesto", checked: false },
    { label: "Kit de herramientas / gato", checked: false },
    { label: "Service al día", checked: false },
  ]);
  assert.equal(DEFAULT_DELIVERY_CHECKLIST_LABELS.length, 5);
});

test("cada llamada devuelve una copia nueva: tildar el checklist de una entrega no altera el default", () => {
  const primera = defaultDeliveryChecklist();
  primera[0].checked = true;
  primera.push({ label: "Patente provisoria", checked: true });

  const segunda = defaultDeliveryChecklist();
  assert.equal(segunda.length, 5);
  assert.ok(segunda.every((item) => !item.checked));
});

test("normalizeChecklist recorta el texto y descarta claves extra", () => {
  const entrada = [
    { label: "  Llave de repuesto ", checked: true, extra: "x" },
  ] as unknown as Parameters<typeof normalizeChecklist>[0];
  assert.deepEqual(normalizeChecklist(entrada), [{ label: "Llave de repuesto", checked: true }]);
});

// --- Edición solo en PENDING ------------------------------------------------

test("editar el checklist o la fecha: permitido en PENDING", () => {
  assert.doesNotThrow(() => assertEditable({ status: "PENDING" }));
});

test("editar una entrega DELIVERED: 409, es un registro histórico", () => {
  assertAppError(() => assertEditable({ status: "DELIVERED" }), 409, ENTREGA_CONFIRMADA_INMUTABLE);
});

// --- Confirmar: PENDING -> DELIVERED ----------------------------------------

test("confirmar: PENDING con la unidad SOLD es la transición válida", () => {
  assert.doesNotThrow(() =>
    assertConfirmable({ status: "PENDING", vehicleId: VEHICLE_ID }, { status: "SOLD" }),
  );
});

test("confirmar una entrega que ya no está PENDING: 409, aunque la unidad siga SOLD", () => {
  assertAppError(
    () => assertConfirmable({ status: "DELIVERED", vehicleId: VEHICLE_ID }, { status: "SOLD" }),
    409,
    ENTREGA_YA_CONFIRMADA,
  );
});

test("confirmar con la unidad en cualquier estado que no sea SOLD: 409 (reversión o cambio a mano)", () => {
  for (const status of TODOS_LOS_ESTADOS_DE_UNIDAD.filter((s) => s !== "SOLD")) {
    assertAppError(
      () => assertConfirmable({ status: "PENDING", vehicleId: VEHICLE_ID }, { status }),
      409,
      UNIDAD_NO_VENDIDA,
    );
  }
});

test("confirmar sin unidad (vehicleId nulo o dada de baja): 409", () => {
  assertAppError(
    () => assertConfirmable({ status: "PENDING", vehicleId: null }, null),
    409,
    UNIDAD_NO_VENDIDA,
  );
  assertAppError(
    () => assertConfirmable({ status: "PENDING", vehicleId: VEHICLE_ID }, null),
    409,
    UNIDAD_NO_VENDIDA,
  );
});
