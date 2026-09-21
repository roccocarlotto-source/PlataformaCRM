import assert from "node:assert/strict";
import { test } from "node:test";
import { limiteDeEstancamiento, umbralesPorOrganizacion } from "./opportunityStaleWorker";

// Unitarios, sin base: las dos decisiones puras del barrido de oportunidades
// estancadas (ítem 76). El barrido contra Postgres real —qué oportunidades
// califican y el anti-redraft— vive en
// opportunityStaleWorker.integration-test.ts.

test("el límite es ahora menos N días exactos de 24 horas; con 0 es ahora mismo", () => {
  const ahora = new Date("2026-09-21T15:30:00.000Z");
  assert.equal(limiteDeEstancamiento(ahora, 7).toISOString(), "2026-09-14T15:30:00.000Z");
  assert.equal(limiteDeEstancamiento(ahora, 0).toISOString(), ahora.toISOString());
});

test("un umbral por organización, el de su regla", () => {
  const umbrales = umbralesPorOrganizacion([
    { id: "r1", organizationId: "org-a", triggerConfig: { daysWithoutActivity: 7 } },
    { id: "r2", organizationId: "org-b", triggerConfig: { daysWithoutActivity: 3 } },
  ]);
  assert.deepEqual(
    [...umbrales],
    [
      ["org-a", 7],
      ["org-b", 3],
    ],
  );
});

test("si una carrera dejó dos reglas activas en la misma organización, manda la MENOR", () => {
  const umbrales = umbralesPorOrganizacion([
    { id: "r1", organizationId: "org-a", triggerConfig: { daysWithoutActivity: 10 } },
    { id: "r2", organizationId: "org-a", triggerConfig: { daysWithoutActivity: 4 } },
    { id: "r3", organizationId: "org-a", triggerConfig: { daysWithoutActivity: 6 } },
  ]);
  assert.deepEqual([...umbrales], [["org-a", 4]]);
});

test("una regla con triggerConfig inválido se saltea sin tumbar a las demás", () => {
  const umbrales = umbralesPorOrganizacion([
    { id: "r1", organizationId: "org-a", triggerConfig: {} },
    { id: "r2", organizationId: "org-b", triggerConfig: { daysWithoutActivity: "7" } },
    { id: "r3", organizationId: "org-c", triggerConfig: { daysWithoutActivity: 2 } },
  ]);
  assert.deepEqual([...umbrales], [["org-c", 2]]);
});
