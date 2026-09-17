import assert from "node:assert/strict";
import { test } from "node:test";
import {
  confirmDeliverySchema,
  listDeliveriesQuerySchema,
  updateDeliverySchema,
} from "./delivery.controller";

// ---------------------------------------------------------------------------
// El borde de /api/deliveries (§40): qué rechazan los schemas antes de llegar
// al service. Sin HTTP ni base, mismo criterio que quote.controller.test.ts.
// ---------------------------------------------------------------------------

test("confirmar: solo { status: 'DELIVERED' }", () => {
  assert.deepEqual(confirmDeliverySchema.parse({ status: "DELIVERED" }), { status: "DELIVERED" });
  for (const status of ["PENDING", "delivered", null, undefined]) {
    assert.equal(confirmDeliverySchema.safeParse({ status }).success, false, String(status));
  }
});

test("confirmar: status junto con checklist o scheduledAt es 400 — las dos formas no se mezclan", () => {
  assert.equal(
    confirmDeliverySchema.safeParse({ status: "DELIVERED", scheduledAt: "2026-09-30" }).success,
    false,
  );
  assert.equal(
    confirmDeliverySchema.safeParse({ status: "DELIVERED", checklist: [] }).success,
    false,
  );
});

test("editar: checklist con label recortado; agregar y quitar ítems es mandar la lista entera", () => {
  const parsed = updateDeliverySchema.parse({
    checklist: [
      { label: "  Manual del vehículo ", checked: true },
      { label: "Patente provisoria", checked: false },
    ],
  });
  assert.deepEqual(parsed.checklist, [
    { label: "Manual del vehículo", checked: true },
    { label: "Patente provisoria", checked: false },
  ]);
  // Una lista vacía es válida: la persona quitó todos los ítems.
  assert.deepEqual(updateDeliverySchema.parse({ checklist: [] }).checklist, []);
});

test("editar: ítems inválidos son 400 (label vacío, checked no booleano, clave extra)", () => {
  for (const item of [
    { label: "   ", checked: true },
    { label: "Llave", checked: "true" },
    { label: "Llave" },
    { label: "Llave", checked: true, id: "x" },
    { label: "x".repeat(201), checked: false },
  ]) {
    assert.equal(
      updateDeliverySchema.safeParse({ checklist: [item] }).success,
      false,
      JSON.stringify(item),
    );
  }
});

test("editar: tope de 50 ítems", () => {
  const item = { label: "Ítem", checked: false };
  assert.equal(
    updateDeliverySchema.safeParse({ checklist: Array.from({ length: 50 }, () => item) }).success,
    true,
  );
  assert.equal(
    updateDeliverySchema.safeParse({ checklist: Array.from({ length: 51 }, () => item) }).success,
    false,
  );
});

test("editar: scheduledAt como fecha sola, y null explícito se queda null (no 1970)", () => {
  assert.equal(
    updateDeliverySchema.parse({ scheduledAt: "2026-09-30" }).scheduledAt?.toISOString(),
    "2026-09-30T00:00:00.000Z",
  );
  assert.equal(updateDeliverySchema.parse({ scheduledAt: null }).scheduledAt, null);
  assert.equal(updateDeliverySchema.safeParse({ scheduledAt: "no-es-fecha" }).success, false);
});

test("editar: body vacío o con campos no permitidos es 400", () => {
  assert.equal(updateDeliverySchema.safeParse({}).success, false);
  assert.equal(updateDeliverySchema.safeParse({ deliveredAt: "2026-09-30" }).success, false);
  assert.equal(updateDeliverySchema.safeParse({ vehicleId: null }).success, false);
});

test("listar: opportunityId obligatorio y UUID", () => {
  assert.equal(listDeliveriesQuerySchema.safeParse({}).success, false);
  assert.equal(listDeliveriesQuerySchema.safeParse({ opportunityId: "abc" }).success, false);
  assert.equal(
    listDeliveriesQuerySchema.safeParse({ opportunityId: "7a6f1c1e-7c1a-4b2a-9d53-0d6b7e0a1f01" })
      .success,
    true,
  );
});
