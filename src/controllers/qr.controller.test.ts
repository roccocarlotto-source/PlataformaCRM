import assert from "node:assert/strict";
import { test } from "node:test";
import { setQrBillingExemptionSchema, setQrSubscriptionStatusSchema } from "./qrAdmin.controller";
import {
  QR_DESTINATION_URL_MAX_LENGTH,
  QR_MESSAGE_MAX_LENGTH,
  QR_NAME_MAX_LENGTH,
  claimQrSchema,
  createDigitalQrSchema,
  listQrQuerySchema,
  updateQrSchema,
} from "./qr.controller";

// La frontera de validación del módulo QR, sin base y sin HTTP — mismo
// criterio que company.controller.test.ts (M-10). Los límites son los de
// create_digital_qr_code / update_qr_code del original (0008/0015): name <= 80,
// destinationUrl http(s) y <= 2048, message <= 500, todos con trim.

const QR_ID = "d54f2f0e-4d3c-4a3b-9a3e-8f2c9c1f0a11";
const BRANCH_ID = "0a3f0d9c-1b2e-4c5d-8e7f-9a0b1c2d3e4f";

const base = {
  branchId: BRANCH_ID,
  name: " Mostrador ",
  destinationUrl: " https://g.page/r/xyz/review ",
};

test("digital: camino feliz — trim, message null por default y qrType REUSABLE por default", () => {
  const r = createDigitalQrSchema.safeParse(base);
  assert.equal(r.success, true);
  assert.deepEqual(r.success && r.data, {
    branchId: BRANCH_ID,
    name: "Mostrador",
    destinationUrl: "https://g.page/r/xyz/review",
    message: null,
    qrType: "REUSABLE",
  });
});

test("digital: qrType SINGLE_USE se acepta; cualquier otro valor no", () => {
  assert.equal(createDigitalQrSchema.safeParse({ ...base, qrType: "SINGLE_USE" }).success, true);
  assert.equal(createDigitalQrSchema.safeParse({ ...base, qrType: "single_use" }).success, false);
  assert.equal(createDigitalQrSchema.safeParse({ ...base, qrType: "OTRO" }).success, false);
});

test("claim: exige qrId UUID y NO acepta elegir qrType (un físico es siempre REUSABLE)", () => {
  assert.equal(claimQrSchema.safeParse({ ...base, qrId: QR_ID }).success, true);
  assert.equal(claimQrSchema.safeParse({ ...base, qrId: "no-es-uuid" }).success, false);
  assert.equal(claimQrSchema.safeParse(base).success, false);

  const conTipo = claimQrSchema.safeParse({ ...base, qrId: QR_ID, qrType: "SINGLE_USE" });
  assert.equal(conTipo.success, true);
  assert.equal(
    conTipo.success && "qrType" in conTipo.data,
    false,
    "qrType se descarta, no se acepta",
  );
});

test("name: requerido, no vacío tras trim, máximo 80", () => {
  assert.equal(createDigitalQrSchema.safeParse({ ...base, name: "   " }).success, false);
  assert.equal(createDigitalQrSchema.safeParse({ ...base, name: undefined }).success, false);
  assert.equal(
    createDigitalQrSchema.safeParse({ ...base, name: "a".repeat(QR_NAME_MAX_LENGTH) }).success,
    true,
  );
  assert.equal(
    createDigitalQrSchema.safeParse({ ...base, name: "a".repeat(QR_NAME_MAX_LENGTH + 1) }).success,
    false,
  );
});

test("destinationUrl: requerido, http(s):// (insensible a mayúsculas), máximo 2048", () => {
  for (const url of ["ftp://x", "g.page/r/xyz", "javascript:alert(1)", "   ", "https:/x"]) {
    assert.equal(
      createDigitalQrSchema.safeParse({ ...base, destinationUrl: url }).success,
      false,
      url,
    );
  }
  assert.equal(
    createDigitalQrSchema.safeParse({ ...base, destinationUrl: "HTTP://x.test" }).success,
    true,
  );
  assert.equal(
    createDigitalQrSchema.safeParse({ ...base, destinationUrl: "http://x.test" }).success,
    true,
  );

  const largo =
    "https://x.test/" + "a".repeat(QR_DESTINATION_URL_MAX_LENGTH - "https://x.test/".length);
  assert.equal(largo.length, QR_DESTINATION_URL_MAX_LENGTH);
  assert.equal(createDigitalQrSchema.safeParse({ ...base, destinationUrl: largo }).success, true);
  assert.equal(
    createDigitalQrSchema.safeParse({ ...base, destinationUrl: largo + "a" }).success,
    false,
  );
});

test("message: opcional, vacío -> null, null -> null, máximo 500", () => {
  const vacio = createDigitalQrSchema.safeParse({ ...base, message: "   " });
  assert.equal(vacio.success && vacio.data.message, null);

  const nulo = createDigitalQrSchema.safeParse({ ...base, message: null });
  assert.equal(nulo.success && nulo.data.message, null);

  const conTexto = createDigitalQrSchema.safeParse({ ...base, message: " Dejanos tu reseña " });
  assert.equal(conTexto.success && conTexto.data.message, "Dejanos tu reseña");

  assert.equal(
    createDigitalQrSchema.safeParse({ ...base, message: "m".repeat(QR_MESSAGE_MAX_LENGTH) })
      .success,
    true,
  );
  assert.equal(
    createDigitalQrSchema.safeParse({ ...base, message: "m".repeat(QR_MESSAGE_MAX_LENGTH + 1) })
      .success,
    false,
  );
});

test("PATCH: parcial, exige al menos un campo, message admite null, y no acepta qrType ni branchId", () => {
  assert.equal(updateQrSchema.safeParse({}).success, false);
  assert.equal(updateQrSchema.safeParse({ name: "Nuevo" }).success, true);

  const limpiar = updateQrSchema.safeParse({ message: null });
  assert.equal(limpiar.success, true);
  assert.equal(limpiar.success && limpiar.data.message, null);

  // Campos desconocidos se descartan (strip): no llegan al service.
  const conTipo = updateQrSchema.safeParse({
    name: "x",
    qrType: "SINGLE_USE",
    branchId: BRANCH_ID,
  });
  assert.equal(conTipo.success, true);
  assert.deepEqual(conTipo.success && Object.keys(conTipo.data), ["name"]);

  // Solo campos desconocidos = ningún campo para actualizar.
  assert.equal(updateQrSchema.safeParse({ qrType: "SINGLE_USE" }).success, false);
});

test("listado: defaults y tope de pageSize, branchId opcional y UUID", () => {
  const r = listQrQuerySchema.safeParse({});
  assert.deepEqual(r.success && r.data, {
    page: 1,
    pageSize: 20,
    sortBy: "createdAt",
    sortOrder: "desc",
  });
  assert.equal(listQrQuerySchema.safeParse({ pageSize: "101" }).success, false);
  assert.equal(listQrQuerySchema.safeParse({ branchId: "x" }).success, false);
  assert.equal(
    listQrQuerySchema.safeParse({ branchId: BRANCH_ID, sortBy: "displayNumber" }).success,
    true,
  );
});

// ---------------------------------------------------------------------------
// Endpoints de platform admin.
// ---------------------------------------------------------------------------

test("subscription-status: newStatus ACTIVE|INACTIVE, reason opcional (vacío -> null)", () => {
  assert.equal(setQrSubscriptionStatusSchema.safeParse({ newStatus: "active" }).success, false);

  const sinMotivo = setQrSubscriptionStatusSchema.safeParse({ newStatus: "ACTIVE" });
  assert.equal(sinMotivo.success && sinMotivo.data.reason, null);

  const vacio = setQrSubscriptionStatusSchema.safeParse({ newStatus: "INACTIVE", reason: "  " });
  assert.equal(vacio.success && vacio.data.reason, null);

  const conMotivo = setQrSubscriptionStatusSchema.safeParse({
    newStatus: "ACTIVE",
    reason: " pagó en efectivo ",
  });
  assert.equal(conMotivo.success && conMotivo.data.reason, "pagó en efectivo");
});

test("billing-exemption: newValue boolean real y reason OBLIGATORIO no vacío (DEC-061)", () => {
  assert.equal(
    setQrBillingExemptionSchema.safeParse({ newValue: true, reason: "piloto" }).success,
    true,
  );
  assert.equal(
    setQrBillingExemptionSchema.safeParse({ newValue: "true", reason: "piloto" }).success,
    false,
  );
  assert.equal(setQrBillingExemptionSchema.safeParse({ newValue: true }).success, false);
  assert.equal(
    setQrBillingExemptionSchema.safeParse({ newValue: true, reason: "   " }).success,
    false,
  );
  assert.equal(
    setQrBillingExemptionSchema.safeParse({ newValue: false, reason: null }).success,
    false,
  );
});
