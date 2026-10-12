import { describe, expect, it } from "vitest";
import { VOCABULARIO_DE_CLINICA_POR_DEFECTO } from "../../auth/vocabulario";
import { INTERNAL_AGENT_TOOL_OPTIONS, internalAgentToolOptions } from "./tools";

// Una clínica no tiene oportunidades (docs/rubros.md §3.1): el texto de
// «Crear tarea» no las nombra y usa el término de contacto de la
// organización. El de una automotora queda igual que antes.

const subtitulo = (opciones: { value: string; subtitle?: string }[], tool: string) =>
  opciones.find((opcion) => opcion.value === tool)?.subtitle;

describe("internalAgentToolOptions", () => {
  it("automotora: los textos de siempre, byte a byte", () => {
    const opciones = internalAgentToolOptions([]);
    expect(opciones).toEqual(INTERNAL_AGENT_TOOL_OPTIONS);
    expect(subtitulo(opciones, "create_internal_task")).toBe(
      "Crea una tarea ligada a un contacto u oportunidad, asignada a quien la pide.",
    );
  });

  it("clínica: la tarea se liga al paciente, sin oportunidades", () => {
    const opciones = internalAgentToolOptions([], true);
    expect(subtitulo(opciones, "create_internal_task")).toBe(
      "Crea una tarea ligada a un paciente, asignada a quien la pide.",
    );
    expect(opciones.map((opcion) => opcion.subtitle).join(" ")).not.toMatch(/oportunidad/i);
    expect(opciones.map((opcion) => opcion.value)).toEqual(
      INTERNAL_AGENT_TOOL_OPTIONS.map((opcion) => opcion.value),
    );
  });

  it("clínica con otro término de contacto: lo usa, con su artículo", () => {
    const opciones = internalAgentToolOptions([], true, {
      ...VOCABULARIO_DE_CLINICA_POR_DEFECTO,
      contacto: {
        singular: "persona",
        plural: "personas",
        singularTitulo: "Persona",
        pluralTitulo: "Personas",
        genero: "femenino",
      },
    });
    expect(subtitulo(opciones, "create_internal_task")).toBe(
      "Crea una tarea ligada a una persona, asignada a quien la pide.",
    );
  });

  it("una tool guardada fuera del catálogo se sigue ofreciendo, también en una clínica", () => {
    expect(internalAgentToolOptions(["vieja"], true).at(-1)).toEqual({
      value: "vieja",
      label: "vieja",
      subtitle: "No está en el catálogo de tools de esta versión del backend.",
    });
  });
});
