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

test("registrarUsoDelTurno: una línea de log y una fila por turno con la organización, el canal, el modelo y los totales", async () => {
  const info = mock.method(logger, "info", () => undefined);
  const guardadas: unknown[] = [];
  const deps = { guardar: async (data: unknown) => void guardadas.push(data) };
  try {
    const uso = usoVacio();
    sumarUso(uso, { promptTokens: 900, completionTokens: 60, costUsd: 0.0003 });
    await registrarUsoDelTurno(
      {
        organizationId: "org-1",
        agentId: "agente-1",
        conversationId: "conv-1",
        channel: "MESSENGER",
        model: "proveedor/modelo",
        uso,
      },
      deps,
    );

    assert.equal(info.mock.callCount(), 1);
    assert.deepEqual(info.mock.calls[0].arguments, [
      {
        organizationId: "org-1",
        agentId: "agente-1",
        conversationId: "conv-1",
        channel: "MESSENGER",
        model: "proveedor/modelo",
        llamadas: 1,
        promptTokens: 900,
        completionTokens: 60,
        costUsd: 0.0003,
      },
      MENSAJE_DE_USO_DEL_TURNO,
    ]);
    // B4: la fila de llm_turn_usages, con lo mismo.
    assert.deepEqual(guardadas, [
      {
        organizationId: "org-1",
        agentId: "agente-1",
        conversationId: "conv-1",
        channel: "MESSENGER",
        model: "proveedor/modelo",
        calls: 1,
        promptTokens: 900,
        completionTokens: 60,
        costUsd: 0.0003,
      },
    ]);

    // Un turno que no llegó a llamar al modelo no registra nada.
    await registrarUsoDelTurno(
      {
        organizationId: "org-1",
        agentId: "agente-1",
        conversationId: "conv-1",
        channel: "MESSENGER",
        model: "proveedor/modelo",
        uso: usoVacio(),
      },
      deps,
    );
    assert.equal(info.mock.callCount(), 1);
    assert.equal(guardadas.length, 1);
  } finally {
    info.mock.restore();
  }
});

test("registrarUsoDelTurno: si la fila no se puede guardar, se loguea y no lanza (el turno ya respondió)", async () => {
  const info = mock.method(logger, "info", () => undefined);
  const error = mock.method(logger, "error", () => undefined);
  try {
    const uso = usoVacio();
    sumarUso(uso, { promptTokens: 1, completionTokens: 1, costUsd: null });
    await registrarUsoDelTurno(
      {
        organizationId: "org-1",
        agentId: "agente-1",
        conversationId: "conv-1",
        channel: "WEB",
        model: "proveedor/modelo",
        uso,
      },
      { guardar: () => Promise.reject(new Error("la base no respondió")) },
    );
    assert.equal(error.mock.callCount(), 1);
  } finally {
    info.mock.restore();
    error.mock.restore();
  }
});
