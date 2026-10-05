import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { DiscountVoucher } from "@prisma/client";
import {
  cuponParaLaPantalla,
  puedeGestionarCupon,
  textoDelCupon,
} from "./discountVoucherManual.service";

// "Crear cupón" a mano: las reglas puras. El recorrido HTTP está en
// voucherManual.integration-test.ts.

const AHORA = new Date("2026-10-04T12:00:00.000Z");

function cupon(extra: Partial<DiscountVoucher> = {}): DiscountVoucher {
  return {
    id: randomUUID(),
    organizationId: randomUUID(),
    opportunityId: null,
    contactId: randomUUID(),
    automationId: null,
    createdByUserId: randomUUID(),
    branchId: randomUUID(),
    label: "15% en el taller",
    status: "ACTIVE",
    expiresAt: new Date("2026-10-10T12:00:00.000Z"),
    consumedAt: null,
    consumedByUserId: null,
    createdAt: AHORA,
    updatedAt: AHORA,
    ...extra,
  };
}

test("permisos: ADMIN siempre; un USER, por la oportunidad si la hay, si no por el contacto", () => {
  const admin = { userId: "a", role: "ADMIN" as const };
  const vendedor = { userId: "v", role: "USER" as const };
  const deOtro = { ownerId: "otro" };
  assert.equal(puedeGestionarCupon(admin, { oportunidad: null, contacto: deOtro }), true);
  assert.equal(
    puedeGestionarCupon(vendedor, { oportunidad: null, contacto: { ownerId: "v" } }),
    true,
  );
  assert.equal(puedeGestionarCupon(vendedor, { oportunidad: null, contacto: deOtro }), false);
  assert.equal(
    puedeGestionarCupon(vendedor, { oportunidad: null, contacto: { ownerId: null } }),
    false,
  );
  assert.equal(
    puedeGestionarCupon(vendedor, { oportunidad: { ownerId: "v" }, contacto: deOtro }),
    true,
    "el dueño de la venta, aunque el contacto sea de otro",
  );
  assert.equal(
    puedeGestionarCupon(vendedor, { oportunidad: deOtro, contacto: { ownerId: "v" } }),
    false,
  );
});

test("la proyección deriva el estado (vencido no se guarda) y el origen", () => {
  assert.equal(cuponParaLaPantalla(cupon(), AHORA).status, "ACTIVE");
  assert.equal(
    cuponParaLaPantalla(cupon({ expiresAt: new Date("2026-10-01T00:00:00.000Z") }), AHORA).status,
    "EXPIRED",
  );
  assert.equal(cuponParaLaPantalla(cupon({ status: "CONSUMED" }), AHORA).status, "CONSUMED");
  assert.equal(cuponParaLaPantalla(cupon(), AHORA).origin, "MANUAL");
  assert.equal(
    cuponParaLaPantalla(cupon({ automationId: randomUUID(), createdByUserId: null }), AHORA).origin,
    "AUTOMATION",
  );
});

test("el texto del WhatsApp: saludo, descuento, la fecha en la zona de la sucursal y el link", () => {
  const texto = textoDelCupon({
    nombre: "Ana",
    label: "15% en el taller",
    // 02:00 UTC del 11 es todavía el 10 en Montevideo (UTC-3).
    expiresAt: new Date("2026-10-11T02:00:00.000Z"),
    zona: "America/Montevideo",
    link: "https://example.com/v/abc",
  });
  assert.equal(
    texto,
    "¡Hola Ana! Te dejamos tu cupón: 15% en el taller. Vale hasta el 10/10/2026. Mostrá este link en la sucursal: https://example.com/v/abc",
  );
  assert.ok(
    textoDelCupon({ nombre: " ", label: "x", expiresAt: AHORA, zona: "UTC", link: "l" }).startsWith(
      "¡Hola! ",
    ),
  );
});
