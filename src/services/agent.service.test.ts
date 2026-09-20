import assert from "node:assert/strict";
import { test } from "node:test";
import { preservarGuardrailsHeredados } from "./agent.service";

// ---------------------------------------------------------------------------
// La única regla pura de agent.service.ts, y la que no puede fallar del ítem
// 72: guardar un agente NUNCA le borra los guardrails que esta pantalla ya no
// sabe escribir. El resto del service es CRUD contra Postgres y se prueba en
// src/controllers/agent.controller.integration-test.ts, con filas de verdad —
// incluido el recorrido completo del PATCH que motivó esta función.
// ---------------------------------------------------------------------------

const HEREDADAS = {
  temasProhibidos: ["diagnósticos médicos"],
  promesasProhibidas: ["descuentos no publicados"],
  condicionesDeDerivacion: ["reclamo o queja"],
};

test("las tres claves heredadas sobreviven a un guardado que solo trae las de código", () => {
  const fusionado = preservarGuardrailsHeredados(
    { ...HEREDADAS, accionesProhibidas: ["create_booking"] },
    { accionesProhibidas: ["update_opportunity"] },
  );

  assert.deepEqual(fusionado, {
    // Lo nuevo manda en las claves que la pantalla sí escribe.
    accionesProhibidas: ["update_opportunity"],
    // Y lo viejo queda intacto en las tres que ya no puede escribir.
    ...HEREDADAS,
  });
});

test("un guardrails nuevo vacío tampoco las borra: el input no puede vaciarlas nunca", () => {
  // Es el caso exacto del ADMIN que abre un agente viejo, le cambia el Nombre
  // y guarda sin tocar las Reglas del agente.
  assert.deepEqual(preservarGuardrailsHeredados(HEREDADAS, {}), HEREDADAS);
});

test("lo que el agente no tenía no aparece: no se inventan claves vacías", () => {
  const fusionado = preservarGuardrailsHeredados(
    { temasProhibidos: ["política"] },
    { infoNoModificable: ["email"] },
  );

  assert.deepEqual(fusionado, {
    infoNoModificable: ["email"],
    temasProhibidos: ["política"],
  });
  assert.ok(!("promesasProhibidas" in fusionado));
  assert.ok(!("condicionesDeDerivacion" in fusionado));
});

test("un agente sin guardrails viejos guarda exactamente lo que vino", () => {
  const nuevos = { accionesProhibidas: ["update_opportunity"] };

  for (const actuales of [{}, null, undefined, [], "{}", 42]) {
    assert.deepEqual(
      preservarGuardrailsHeredados(actuales, nuevos),
      nuevos,
      `no debería tocar el input con actuales = ${JSON.stringify(actuales)}`,
    );
  }
});

test("no muta ninguno de los dos objetos que recibe", () => {
  const actuales = { ...HEREDADAS };
  const nuevos: Record<string, unknown> = { accionesProhibidas: ["update_opportunity"] };

  preservarGuardrailsHeredados(actuales, nuevos);

  assert.deepEqual(actuales, HEREDADAS);
  assert.deepEqual(nuevos, { accionesProhibidas: ["update_opportunity"] });
});
