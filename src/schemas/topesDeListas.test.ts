import assert from "node:assert/strict";
import { test } from "node:test";
import { enabledToolsSchema } from "./agentModelConfig.schema";

// Las listas de los pedidos tienen .max(): con zod 4, sin tope, una lista
// enorme de elementos inválidos genera un error por elemento antes de
// rechazarse. Con tope corta en la primera revisión.

test("enabledTools: hasta 100 se acepta; más, se rechaza con UN error y no uno por elemento", () => {
  const cien = Array.from({ length: 100 }, (_, i) => `tool_${String(i)}`);
  assert.equal(enabledToolsSchema.safeParse(cien).success, true);

  const muchas = Array.from({ length: 5000 }, () => "NO VALE");
  const r = enabledToolsSchema.safeParse(muchas);
  assert.equal(r.success, false);
  assert.ok(r.error.issues.length < 10, `issues: ${String(r.error.issues.length)}`);
});
