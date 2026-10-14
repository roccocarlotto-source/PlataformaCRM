import assert from "node:assert/strict";
import { test } from "node:test";
import { aprobacionPendienteDe } from "./ordenes.service";

// La ficha calcula "falta registrar la aprobación" con el historial y las
// aprobaciones que ya trae, sin volver a la base: mismo criterio que la
// transición (§2.5), una aprobación registrada desde la ÚLTIMA entrada a
// Esperando aprobación.

const t = (min: number) => new Date(Date.UTC(2026, 9, 14, 19, min));
const cambio = (toStatus: "EN_TRABAJO" | "ESPERANDO_APROBACION", min: number) => ({
  toStatus,
  changedAt: t(min),
});
const aprobacion = (min: number) => ({ createdAt: t(min) });

function pendiente(
  status: "EN_TRABAJO" | "ESPERANDO_APROBACION",
  // Del más nuevo al más viejo, como viene la ficha.
  historial: ReturnType<typeof cambio>[],
  aprobaciones: ReturnType<typeof aprobacion>[],
) {
  return aprobacionPendienteDe({
    status,
    statusChanges: historial,
    approvals: aprobaciones,
  } as unknown as Parameters<typeof aprobacionPendienteDe>[0]);
}

test("fuera de Esperando aprobación nunca está pendiente", () => {
  assert.equal(pendiente("EN_TRABAJO", [cambio("EN_TRABAJO", 1)], []), false);
});

test("recién entrada, sin aprobaciones: pendiente", () => {
  assert.equal(pendiente("ESPERANDO_APROBACION", [cambio("ESPERANDO_APROBACION", 5)], []), true);
});

test("una aprobación desde la entrada (incluso en el mismo instante) la resuelve", () => {
  assert.equal(
    pendiente("ESPERANDO_APROBACION", [cambio("ESPERANDO_APROBACION", 5)], [aprobacion(5)]),
    false,
  );
});

test("una aprobación de una vuelta anterior no cuenta", () => {
  const historial = [
    cambio("ESPERANDO_APROBACION", 9),
    cambio("EN_TRABAJO", 7),
    cambio("ESPERANDO_APROBACION", 5),
  ];
  assert.equal(pendiente("ESPERANDO_APROBACION", historial, [aprobacion(6)]), true);
  assert.equal(
    pendiente("ESPERANDO_APROBACION", historial, [aprobacion(10), aprobacion(6)]),
    false,
  );
});
