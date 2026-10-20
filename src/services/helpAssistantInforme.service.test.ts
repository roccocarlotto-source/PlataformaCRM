import assert from "node:assert/strict";
import { test } from "node:test";
import type { FiltroDelInforme } from "../repositories/helpAssistantQuestion.repository";
import {
  informeDePreguntas,
  tituloDePantalla,
  type DepsDelInforme,
} from "./helpAssistantInforme.service";

// ---------------------------------------------------------------------------
// "Preguntas a la ayuda": cómo se arma el informe con lo que devuelve la base.
// Las consultas mismas las prueba helpAssistant.integration-test.ts.
// ---------------------------------------------------------------------------

const AHORA = new Date("2026-10-20T12:00:00Z");

function deps(
  cambios: Partial<DepsDelInforme> = {},
): DepsDelInforme & { filtros: FiltroDelInforme[] } {
  const filtros: FiltroDelInforme[] = [];
  return {
    filtros,
    totalesPorResultado: async (f) => {
      filtros.push(f);
      return [];
    },
    preguntasPorPantalla: async () => [],
    preguntasFrecuentes: async () => [],
    preguntasRecientes: async () => [],
    ahora: () => AHORA,
    ...cambios,
  };
}

test("el período va de hoy hacia atrás y los filtros pasan tal cual", async () => {
  const d = deps();
  await informeDePreguntas(
    { dias: 7, industry: "CLINICA", role: "RECEPCION", outcome: "NOT_COVERED" },
    d,
  );
  assert.deepEqual(d.filtros[0], {
    desde: new Date("2026-10-13T12:00:00Z"),
    industry: "CLINICA",
    role: "RECEPCION",
    outcome: "NOT_COVERED",
  });
});

test("sin preguntas: todo en cero y el costo en null (no en 0)", async () => {
  const informe = await informeDePreguntas({ dias: 30 }, deps());
  assert.equal(informe.dias, 30);
  assert.deepEqual(informe.resumen, {
    preguntas: 0,
    porResultado: { ANSWERED: 0, NOT_COVERED: 0, DATA_REDIRECT: 0, OFF_TOPIC: 0, ERROR: 0 },
    utiles: 0,
    noUtiles: 0,
    conCache: 0,
    costoUsd: null,
  });
});

test("el resumen suma los resultados; el caché no cuenta las que fallaron", async () => {
  const informe = await informeDePreguntas(
    { dias: 30 },
    deps({
      totalesPorResultado: async () => [
        { outcome: "ANSWERED", preguntas: 8, utiles: 3, noUtiles: 1, conCache: 5, costoUsd: 0.02 },
        {
          outcome: "NOT_COVERED",
          preguntas: 2,
          utiles: 0,
          noUtiles: 2,
          conCache: 1,
          costoUsd: null,
        },
        { outcome: "ERROR", preguntas: 1, utiles: 0, noUtiles: 0, conCache: 1, costoUsd: 0.001 },
      ],
    }),
  );
  assert.equal(informe.resumen.preguntas, 11);
  assert.equal(informe.resumen.porResultado.ANSWERED, 8);
  assert.equal(informe.resumen.porResultado.NOT_COVERED, 2);
  assert.equal(informe.resumen.porResultado.OFF_TOPIC, 0);
  assert.equal(informe.resumen.utiles, 3);
  assert.equal(informe.resumen.noUtiles, 3);
  assert.equal(informe.resumen.conCache, 6);
  assert.ok(Math.abs((informe.resumen.costoUsd ?? 0) - 0.021) < 1e-9);
});

test("las pantallas llevan el título de su tema en la guía", async () => {
  const informe = await informeDePreguntas(
    { dias: 30 },
    deps({
      preguntasPorPantalla: async () => [
        { screen: "contactos", preguntas: 4 },
        { screen: null, preguntas: 2 },
        { screen: "no-existe", preguntas: 1 },
      ],
    }),
  );
  assert.deepEqual(informe.pantallas, [
    { clave: "contactos", titulo: tituloDePantalla("contactos"), preguntas: 4 },
    { clave: null, titulo: null, preguntas: 2 },
    { clave: "no-existe", titulo: null, preguntas: 1 },
  ]);
  assert.ok(tituloDePantalla("contactos"));
});

test("tituloDePantalla: la guía de siempre, y la de clínicas si la pantalla es solo de clínica", () => {
  assert.equal(tituloDePantalla("usoDeIa"), "Uso de IA");
  // Profesionales existe solo en la guía de clínicas.
  assert.ok(tituloDePantalla("profesionales"));
  assert.equal(tituloDePantalla(null), null);
  assert.equal(tituloDePantalla("toString"), null);
});
