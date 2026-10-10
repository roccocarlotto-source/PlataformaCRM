import assert from "node:assert/strict";
import { test } from "node:test";
import { CATALOGO_DE_TOOLS } from "../services/agentTools.service";
import { SIN_REGLAS, reglasDelRubro } from "../services/reglasDelRubro";
import { ordenParaElPrimeroLibre } from "./services/agendaClinica.service";
import { TOOLS_DE_AGENDA_DE_CLINICA } from "./toolsDeAgenda";

// ---------------------------------------------------------------------------
// Agenda de clínica (docs/rubros.md §4.3, R5), sin base. La disponibilidad y
// la reserva contra Postgres están en agendaClinica.integration-test.ts.
// ---------------------------------------------------------------------------

test("el primero libre: el de menos turnos ese día; a igual cantidad, por nombre y después por id", () => {
  const candidatos = [
    { id: "c", name: "Lucía" },
    { id: "a", name: "Ana" },
    { id: "b", name: "Ana" },
    { id: "d", name: "Bruno" },
  ];
  assert.deepEqual(
    ordenParaElPrimeroLibre(
      candidatos,
      new Map([
        ["c", 0],
        ["a", 2],
        ["b", 2],
        ["d", 1],
      ]),
    ),
    ["c", "d", "a", "b"],
  );
  // Sin turnos ese día cuentan como cero.
  assert.deepEqual(ordenParaElPrimeroLibre(candidatos, new Map([["a", 1]])), ["b", "d", "c", "a"]);
  assert.deepEqual(ordenParaElPrimeroLibre([], new Map()), []);
});

test("las tools de agenda de una clínica reemplazan a las del catálogo con el mismo nombre y los mismos argumentos", () => {
  assert.deepEqual(Object.keys(TOOLS_DE_AGENDA_DE_CLINICA).sort(), [
    "create_booking",
    "get_availability",
    "get_service_types",
  ]);
  for (const [nombre, tool] of Object.entries(TOOLS_DE_AGENDA_DE_CLINICA)) {
    assert.equal(tool.definition.name, nombre);
    const delCatalogo = CATALOGO_DE_TOOLS.get(nombre);
    assert.ok(delCatalogo, nombre);
    // El mismo contrato de argumentos: un agente que pasa de una versión a la
    // otra no ve campos nuevos ni pierde los que usaba.
    const props = (t: typeof tool) =>
      Object.keys((t.definition.parameters as { properties?: object }).properties ?? {}).sort();
    assert.deepEqual(props(tool), props(delCatalogo), nombre);
    assert.deepEqual(
      (tool.definition.parameters as { required?: string[] }).required ?? [],
      (delCatalogo.definition.parameters as { required?: string[] }).required ?? [],
      nombre,
    );
    // Y no es la misma: es la versión con profesionales.
    assert.notEqual(tool, delCatalogo);
  }
});

test("solo CLINICA tiene tools propias; una automotora, ninguna", () => {
  assert.equal(reglasDelRubro("CLINICA").toolsPropias, TOOLS_DE_AGENDA_DE_CLINICA);
  assert.deepEqual(reglasDelRubro("AUTOMOTORA").toolsPropias, {});
  assert.equal(reglasDelRubro("AUTOMOTORA"), SIN_REGLAS);
});
