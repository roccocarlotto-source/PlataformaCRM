import assert from "node:assert/strict";
import { test } from "node:test";
import { WhatsappGraphError } from "./whatsappGraph.service";
import { esPlantillaInexistenteEnMeta, estadoLocalDeMeta } from "./whatsappTemplate.service";

// ---------------------------------------------------------------------------
// Las decisiones puras del service de plantillas (ítem 160), sin base ni red:
// cómo se traduce el estado de Meta y qué error de Meta cuenta como "ya no
// existe". El flujo completo (reserva, alta, 409, borrado) va por HTTP en
// whatsappTemplate.controller.integration-test.ts.
// ---------------------------------------------------------------------------

test("estadoLocalDeMeta: solo APPROVED, REINSTATED y FLAGGED mandan", () => {
  for (const estado of ["APPROVED", "REINSTATED", "FLAGGED", "approved"]) {
    assert.deepEqual(estadoLocalDeMeta(estado), { status: "APPROVED", rejectedReason: null });
  }
});

test("estadoLocalDeMeta: PENDING e IN_APPEAL siguen en revisión", () => {
  assert.deepEqual(estadoLocalDeMeta("PENDING"), { status: "PENDING", rejectedReason: null });
  assert.deepEqual(estadoLocalDeMeta("IN_APPEAL", "NONE"), {
    status: "PENDING",
    rejectedReason: null,
  });
});

test("estadoLocalDeMeta: REJECTED con el motivo de Meta; 'NONE' o vacío cuenta como sin motivo", () => {
  assert.deepEqual(estadoLocalDeMeta("REJECTED", "INVALID_FORMAT"), {
    status: "REJECTED",
    rejectedReason: "INVALID_FORMAT",
  });
  assert.deepEqual(estadoLocalDeMeta("REJECTED", "NONE"), {
    status: "REJECTED",
    rejectedReason: "Meta la rechazó sin dar un motivo",
  });
  assert.deepEqual(estadoLocalDeMeta("REJECTED", "  "), {
    status: "REJECTED",
    rejectedReason: "Meta la rechazó sin dar un motivo",
  });
});

test("estadoLocalDeMeta: pausada, deshabilitada o un estado desconocido NO manda, y dice cuál", () => {
  assert.deepEqual(estadoLocalDeMeta("PAUSED", "Calidad baja"), {
    status: "REJECTED",
    rejectedReason: "Meta la dejó en estado PAUSED (Calidad baja)",
  });
  assert.deepEqual(estadoLocalDeMeta("DISABLED"), {
    status: "REJECTED",
    rejectedReason: "Meta la dejó en estado DISABLED",
  });
  assert.equal(estadoLocalDeMeta("ALGO_NUEVO_DE_META").status, "REJECTED");
});

test("esPlantillaInexistenteEnMeta: 404, o un 400 que dice que no existe", () => {
  assert.equal(esPlantillaInexistenteEnMeta(new WhatsappGraphError(404, "")), true);
  assert.equal(
    esPlantillaInexistenteEnMeta(
      new WhatsappGraphError(
        400,
        JSON.stringify({
          error: { message: "Invalid parameter", error_user_msg: "Template not found" },
        }),
      ),
    ),
    true,
  );
});

test("esPlantillaInexistenteEnMeta: cualquier otro error sigue siendo un error", () => {
  assert.equal(esPlantillaInexistenteEnMeta(new WhatsappGraphError(401, "token vencido")), false);
  assert.equal(
    esPlantillaInexistenteEnMeta(new WhatsappGraphError(400, "Invalid parameter")),
    false,
  );
  assert.equal(esPlantillaInexistenteEnMeta(new WhatsappGraphError(503, "not found")), false);
  assert.equal(esPlantillaInexistenteEnMeta(new TypeError("fetch failed")), false);
});
