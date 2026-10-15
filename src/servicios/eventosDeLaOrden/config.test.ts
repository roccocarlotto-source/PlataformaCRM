import assert from "node:assert/strict";
import { test } from "node:test";
import { configDelCambioDeEstadoSchema, laReglaCorreConElCambio } from "./config";

const ORDEN = {
  serviceOrderId: "11111111-1111-4111-8111-111111111111",
  customerVehicleId: "22222222-2222-4222-8222-222222222222",
  contactId: "33333333-3333-4333-8333-333333333333",
  branchId: "44444444-4444-4444-8444-444444444444",
};

test("toStatuses: al menos un estado, que exista y sin repetir; sin default", () => {
  assert.deepEqual(configDelCambioDeEstadoSchema.parse({ toStatuses: ["RECIBIDO"] }), {
    toStatuses: ["RECIBIDO"],
  });
  for (const malo of [
    {},
    { toStatuses: [] },
    { toStatuses: ["VOLANDO"] },
    { toStatuses: ["RECIBIDO", "RECIBIDO"] },
    { toStatuses: "RECIBIDO" },
  ]) {
    assert.equal(
      configDelCambioDeEstadoSchema.safeParse(malo).success,
      false,
      JSON.stringify(malo),
    );
  }
});

test("la regla corre solo si el estado destino está entre los suyos; también al nacer en ese estado", () => {
  const regla = { toStatuses: ["RECIBIDO", "LISTO_PARA_RETIRAR"] };
  assert.equal(
    laReglaCorreConElCambio(regla, { ...ORDEN, from: "AGENDADO", to: "RECIBIDO" }),
    true,
  );
  // Una orden que nace en Recibido (decisión de Rocco, 2026-10-15).
  assert.equal(laReglaCorreConElCambio(regla, { ...ORDEN, from: null, to: "RECIBIDO" }), true);
  assert.equal(
    laReglaCorreConElCambio(regla, { ...ORDEN, from: "RECIBIDO", to: "EN_TRABAJO" }),
    false,
  );
  // Una config o un evento que no pasan el schema no corren.
  assert.equal(laReglaCorreConElCambio({}, { ...ORDEN, from: null, to: "RECIBIDO" }), false);
  assert.equal(laReglaCorreConElCambio(regla, { to: "RECIBIDO" }), false);
});
