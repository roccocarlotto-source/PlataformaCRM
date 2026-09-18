import { describe, expect, it } from "vitest";
import {
  SIN_GUARDRAILS,
  formatGuardrails,
  resumirDescartes,
  resumirGuardrails,
} from "./guardrails";
import { AGENT_TOOL_OPTIONS } from "./tools";

// El resumen es lo ÚNICO que el ADMIN ve antes de confirmar un guardrail que
// después va a bloquear acciones de verdad, así que se prueba clave por clave:
// una que no se muestre sería un límite que el agente hace cumplir sin que
// nadie lo haya visto.

describe("formatGuardrails", () => {
  it("formatea con indentación de 2, para que el 'Ver JSON' del panel se pueda leer", () => {
    expect(formatGuardrails({ accionesProhibidas: ["update_opportunity"] })).toBe(
      '{\n  "accionesProhibidas": [\n    "update_opportunity"\n  ]\n}',
    );
  });

  it("un objeto vacío se muestra como {}", () => {
    expect(formatGuardrails({})).toBe("{}");
  });
});

describe("resumirGuardrails", () => {
  it("acciones prohibidas: usa el rótulo en castellano del catálogo, no el nombre crudo", () => {
    expect(
      resumirGuardrails(
        { accionesProhibidas: ["update_opportunity", "create_booking"] },
        AGENT_TOOL_OPTIONS,
      ),
    ).toEqual(["No puede ejecutar estas acciones: Modificar oportunidad, Reservar turno."]);
  });

  it("una tool que no está en el catálogo del frontend se muestra con su nombre crudo", () => {
    // Mismo criterio que agentToolOptions() con una tool desconocida: se
    // muestra, no se esconde. Esconderla haría que el ADMIN confirmara un
    // guardrail sin ver una de sus partes.
    expect(
      resumirGuardrails({ accionesProhibidas: ["tool_del_futuro"] }, AGENT_TOOL_OPTIONS),
    ).toEqual(["No puede ejecutar estas acciones: tool_del_futuro."]);
  });

  it("info no modificable: los nombres de campo van tal cual", () => {
    expect(
      resumirGuardrails({ infoNoModificable: ["Contact.email", "amount"] }, AGENT_TOOL_OPTIONS),
    ).toEqual(["No puede modificar estos datos: Contact.email, amount."]);
  });

  it("datos requeridos: una línea por acción, con su rótulo", () => {
    expect(
      resumirGuardrails(
        {
          datosRequeridosAntesDeAccion: {
            create_booking: ["serviceTypeId", "contactId"],
            create_opportunity: ["title"],
          },
        },
        AGENT_TOOL_OPTIONS,
      ),
    ).toEqual([
      'Antes de "Reservar turno" tiene que conocer: serviceTypeId, contactId.',
      'Antes de "Crear oportunidad" tiene que conocer: title.',
    ]);
  });

  it("temas, promesas y condiciones van frase por frase, sin reescribirlas", () => {
    expect(
      resumirGuardrails(
        {
          temasProhibidos: ["diagnósticos médicos", "asesoramiento legal"],
          promesasProhibidas: ["descuentos no publicados"],
          condicionesDeDerivacion: ["el cliente pide hablar con una persona"],
        },
        AGENT_TOOL_OPTIONS,
      ),
    ).toEqual([
      "No habla de: diagnósticos médicos.",
      "No habla de: asesoramiento legal.",
      "No promete: descuentos no publicados.",
      "Deriva a una persona si: el cliente pide hablar con una persona.",
    ]);
  });

  it("las seis claves juntas: primero lo que se hace cumplir con código", () => {
    const lineas = resumirGuardrails(
      {
        temasProhibidos: ["política"],
        accionesProhibidas: ["update_opportunity"],
        infoNoModificable: ["amount"],
        condicionesDeDerivacion: ["reclamo"],
        promesasProhibidas: ["plazos no confirmados"],
        datosRequeridosAntesDeAccion: { create_booking: ["serviceTypeId"] },
      },
      AGENT_TOOL_OPTIONS,
    );

    expect(lineas).toEqual([
      "No puede ejecutar estas acciones: Modificar oportunidad.",
      "No puede modificar estos datos: amount.",
      'Antes de "Reservar turno" tiene que conocer: serviceTypeId.',
      "No habla de: política.",
      "No promete: plazos no confirmados.",
      "Deriva a una persona si: reclamo.",
    ]);
  });

  it("un objeto vacío dice que no hay guardrails, no devuelve una lista vacía", () => {
    // "No hay nada declarado" y "no se entendió nada" se ven igual con una
    // lista vacía, y son cosas muy distintas para quien está por guardar.
    expect(resumirGuardrails({}, AGENT_TOOL_OPTIONS)).toEqual([SIN_GUARDRAILS]);
  });

  it("una clave presente pero vacía no genera línea: es lo mismo que ausente", () => {
    expect(
      resumirGuardrails(
        { accionesProhibidas: [], datosRequeridosAntesDeAccion: { create_booking: [] } },
        AGENT_TOOL_OPTIONS,
      ),
    ).toEqual([SIN_GUARDRAILS]);
  });

  it("una clave con el tipo equivocado se ignora, no rompe la pantalla", () => {
    // El objeto viene del backend ya sanitizado, pero el resumen es lo único
    // que el ADMIN ve antes de confirmar: mostrar de menos es mejor que
    // mostrar una excepción.
    expect(
      resumirGuardrails(
        { accionesProhibidas: "update_opportunity", temasProhibidos: ["política"] },
        AGENT_TOOL_OPTIONS,
      ),
    ).toEqual(["No habla de: política."]);
  });
});

describe("resumirDescartes", () => {
  it("un descarte se arma con el valor y el motivo que mandó el backend", () => {
    expect(
      resumirDescartes([
        {
          clave: "accionesProhibidas",
          valor: "enviar_email",
          motivo: '"enviar_email" no es ninguna de las acciones del agente',
        },
      ]),
    ).toEqual(['"enviar_email": "enviar_email" no es ninguna de las acciones del agente.']);
  });

  it("varios descartes son varias líneas, en el orden en que llegaron", () => {
    expect(
      resumirDescartes([
        { clave: "accionesProhibidas", valor: "enviar_email", motivo: "no es una acción" },
        { clave: "infoNoModificable", valor: "numeroDeSocio", motivo: "no es un dato del agente" },
      ]),
    ).toEqual(['"enviar_email": no es una acción.', '"numeroDeSocio": no es un dato del agente.']);
  });

  it("sin descartes no hay líneas: el panel no muestra la sección de advertencias", () => {
    expect(resumirDescartes([])).toEqual([]);
  });
});
