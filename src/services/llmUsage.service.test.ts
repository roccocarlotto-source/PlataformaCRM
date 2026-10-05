import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { logger } from "../lib/logger";
import {
  MENSAJE_DE_USO_DEL_TURNO,
  registrarUsoDelTurno,
  sumarUso,
  usoVacio,
} from "./llmUsage.service";

// ---------------------------------------------------------------------------
// FABLE-G-04 (docs-privados/auditoria-2026-10-05-FABLE.md, local): el consumo
// del modelo por turno y por organización.
// ---------------------------------------------------------------------------

test("sumarUso: suma tokens y costo de cada llamada; una llamada sin usage cuenta igual", () => {
  const uso = usoVacio();
  sumarUso(uso, { promptTokens: 1200, completionTokens: 80, costUsd: 0.0004 });
  sumarUso(uso, undefined);
  sumarUso(uso, { promptTokens: 1500, completionTokens: 120, costUsd: 0.0006 });

  assert.equal(uso.llamadas, 3);
  assert.equal(uso.promptTokens, 2700);
  assert.equal(uso.completionTokens, 200);
  assert.ok(Math.abs((uso.costUsd ?? 0) - 0.001) < 1e-9);
});

test("sumarUso: si ningún proveedor informó costo, el costo queda en null (no en 0)", () => {
  const uso = usoVacio();
  sumarUso(uso, { promptTokens: 10, completionTokens: 2, costUsd: null });
  assert.equal(uso.costUsd, null);
});

test("registrarUsoDelTurno: una línea por turno con la organización, el modelo y los totales", () => {
  const info = mock.method(logger, "info", () => undefined);
  try {
    const uso = usoVacio();
    sumarUso(uso, { promptTokens: 900, completionTokens: 60, costUsd: 0.0003 });
    registrarUsoDelTurno({
      organizationId: "org-1",
      agentId: "agente-1",
      conversationId: "conv-1",
      model: "proveedor/modelo",
      uso,
    });

    assert.equal(info.mock.callCount(), 1);
    assert.deepEqual(info.mock.calls[0].arguments, [
      {
        organizationId: "org-1",
        agentId: "agente-1",
        conversationId: "conv-1",
        model: "proveedor/modelo",
        llamadas: 1,
        promptTokens: 900,
        completionTokens: 60,
        costUsd: 0.0003,
      },
      MENSAJE_DE_USO_DEL_TURNO,
    ]);

    // Un turno que no llegó a llamar al modelo no registra nada.
    registrarUsoDelTurno({
      organizationId: "org-1",
      agentId: "agente-1",
      conversationId: "conv-1",
      model: "proveedor/modelo",
      uso: usoVacio(),
    });
    assert.equal(info.mock.callCount(), 1);
  } finally {
    info.mock.restore();
  }
});
