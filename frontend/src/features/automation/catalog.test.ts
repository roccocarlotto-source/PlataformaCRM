import { describe, expect, it } from "vitest";
import {
  ACTION_CREATE_FOLLOW_UP,
  ACTION_OPTIONS,
  CONFIG_DE_ACCION,
  DEFAULT_ACTION,
  DEFAULT_TRIGGER,
  MAX_NOTES,
  TRIGGER_OPPORTUNITY_WON,
  TRIGGER_OPTIONS,
  actionLabel,
  triggerLabel,
} from "./catalog";

// El catálogo del frontend es un espejo de dos listas que viven en código del
// backend y que ningún endpoint expone (automationTriggers.ts y el registro de
// automationActions.ts). Estos casos cubren lo que el formulario NO puede
// cubrir por su cuenta: el `validar` de cada acción es el backstop de la
// pantalla —en el formulario lo tapan el `required` y el `min`/`max` nativos
// del input, que corren antes del submit—, y sigue siendo la regla de la
// ACCIÓN, no del input que hoy le toca dibujar.

describe("catálogo de triggers y acciones", () => {
  it("los rótulos traducen el string técnico, y uno desconocido se muestra crudo", () => {
    expect(triggerLabel(TRIGGER_OPPORTUNITY_WON)).toBe("Oportunidad ganada");
    expect(actionLabel(ACTION_CREATE_FOLLOW_UP)).toBe("Crear actividad de seguimiento");
    // Un trigger o una acción que el backend ya conoce y este espejo todavía
    // no: el dato real informa más que un "—".
    expect(triggerLabel("appointment.reminder_due")).toBe("appointment.reminder_due");
    expect(actionLabel("whatsapp.send_message")).toBe("whatsapp.send_message");
  });

  it("los defaults del formulario son la primera entrada del catálogo, no un valor escrito a mano", () => {
    expect(DEFAULT_TRIGGER).toBe(TRIGGER_OPTIONS[0].value);
    expect(DEFAULT_ACTION).toBe(ACTION_OPTIONS[0].value);
  });

  it("toda acción ofrecida en el selector sabe configurarse", () => {
    // El invariante que hace que agregar una acción sea agregar DOS entradas:
    // una opción del selector sin su ConfigDeAccion sería un formulario que no
    // puede guardar.
    for (const option of ACTION_OPTIONS) {
      expect(CONFIG_DE_ACCION[option.value]).toBeDefined();
    }
  });
});

describe("configuración de activity.create_follow_up", () => {
  const config = CONFIG_DE_ACCION[ACTION_CREATE_FOLLOW_UP];

  it("el borrador vacío tiene los tres campos del schema del backend", () => {
    // notes incluido, aunque sea opcional: el borrador es lo que dibuja el
    // formulario, y un <textarea> controlado necesita su "" desde el arranque.
    expect(config.draftVacio()).toEqual({ subject: "", daysUntilDue: "", notes: "" });
  });

  it("abre el actionConfig guardado, con el número como texto", () => {
    expect(config.draftDesde({ subject: "Llamar", daysUntilDue: 7 })).toEqual({
      subject: "Llamar",
      daysUntilDue: "7",
      // La regla se guardó sin notas: la clave no viene, y el campo abre vacío.
      notes: "",
    });
  });

  it("abre las notas guardadas tal cual", () => {
    expect(
      config.draftDesde({ subject: "Llamar", daysUntilDue: 7, notes: "Preguntar la patente" }),
    ).toEqual({
      subject: "Llamar",
      daysUntilDue: "7",
      notes: "Preguntar la patente",
    });
  });

  it("una config guardada con otra forma no rompe: los campos quedan vacíos", () => {
    // No debería pasar —el backend valida antes de guardar— pero una regla
    // vieja o tocada a mano no puede dejar la pantalla en blanco.
    expect(config.draftDesde({ template: "recordatorio" })).toEqual({
      subject: "",
      daysUntilDue: "",
      notes: "",
    });
  });

  it("arma el payload con daysUntilDue como número y el título sin espacios de más", () => {
    expect(config.aPayload({ subject: "  Llamar  ", daysUntilDue: "3", notes: "" })).toEqual({
      subject: "Llamar",
      daysUntilDue: 3,
    });
  });

  it('sin notas la clave NO viaja en el payload, ni siquiera como ""', () => {
    // El schema del backend rechaza el string vacío a propósito: "sin notas"
    // se expresa omitiendo la clave. Ítem 68.
    const payload = config.aPayload({ subject: "Llamar", daysUntilDue: "3", notes: "   " });
    expect("notes" in payload).toBe(false);
    expect(payload).toEqual({ subject: "Llamar", daysUntilDue: 3 });
  });

  it("con notas viajan trimeadas", () => {
    expect(
      config.aPayload({ subject: "Llamar", daysUntilDue: "3", notes: "  Preguntar la patente  " }),
    ).toEqual({
      subject: "Llamar",
      daysUntilDue: 3,
      notes: "Preguntar la patente",
    });
  });

  it("acepta los dos extremos del rango", () => {
    expect(config.validar({ subject: "Llamar", daysUntilDue: "0", notes: "" })).toBeNull();
    expect(config.validar({ subject: "Llamar", daysUntilDue: "365", notes: "" })).toBeNull();
  });

  it("las notas son opcionales: vacías, con espacios o cargadas, todas pasan", () => {
    for (const notes of ["", "   ", "Preguntar la patente", "x".repeat(MAX_NOTES)]) {
      expect(config.validar({ subject: "Llamar", daysUntilDue: "3", notes })).toBeNull();
    }
  });

  it("rechaza notas de más de 5000 caracteres, con el tope en el mensaje", () => {
    // Desde el teclado no se llega —el <textarea> lleva maxLength— pero
    // validar() es el backstop de la ACCIÓN, no del input que hoy la dibuja.
    expect(
      config.validar({ subject: "Llamar", daysUntilDue: "3", notes: "x".repeat(MAX_NOTES + 1) }),
    ).toBe("Las notas no pueden superar los 5000 caracteres.");
  });

  it("rechaza el título vacío o solo de espacios", () => {
    expect(config.validar({ subject: "", daysUntilDue: "3", notes: "" })).toBe(
      "Escribí el título de la tarea que se va a crear.",
    );
    expect(config.validar({ subject: "   ", daysUntilDue: "3", notes: "" })).toBe(
      "Escribí el título de la tarea que se va a crear.",
    );
  });

  it("rechaza un título de más de 200 caracteres", () => {
    expect(config.validar({ subject: "x".repeat(201), daysUntilDue: "3", notes: "" })).toBe(
      "El título de la tarea no puede superar los 200 caracteres.",
    );
  });

  it("rechaza los días vacíos sin confundirlos con 0", () => {
    // Number("") es 0: sin este chequeo, un campo en blanco se guardaría como
    // "vence hoy" en silencio.
    expect(config.validar({ subject: "Llamar", daysUntilDue: "", notes: "" })).toBe(
      "Indicá en cuántos días vence la tarea.",
    );
  });

  it("rechaza días no enteros y días fuera del rango", () => {
    expect(config.validar({ subject: "Llamar", daysUntilDue: "3,5", notes: "" })).toBe(
      "Los días hasta el vencimiento tienen que ser un número entero.",
    );
    expect(config.validar({ subject: "Llamar", daysUntilDue: "2.5", notes: "" })).toBe(
      "Los días hasta el vencimiento tienen que ser un número entero.",
    );
    expect(config.validar({ subject: "Llamar", daysUntilDue: "-1", notes: "" })).toBe(
      "Los días hasta el vencimiento tienen que estar entre 0 y 365.",
    );
    expect(config.validar({ subject: "Llamar", daysUntilDue: "400", notes: "" })).toBe(
      "Los días hasta el vencimiento tienen que estar entre 0 y 365.",
    );
  });
});
