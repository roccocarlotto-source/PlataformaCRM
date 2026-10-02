import { describe, expect, it } from "vitest";
import {
  ACCIONES_POR_TRIGGER,
  ACTION_CREATE_FOLLOW_UP,
  ACTION_DRAFT_FOLLOW_UP,
  ACTION_OPTIONS,
  ACTION_SEND_DISCOUNT_VOUCHER,
  ACTION_SEND_QR_FOLLOWUP,
  CONFIG_DE_ACCION,
  CONFIG_DE_TRIGGER,
  DEFAULT_ACTION,
  DEFAULT_TRIGGER,
  MAX_NOTES,
  TRIGGER_OPPORTUNITY_STALE,
  TRIGGER_OPPORTUNITY_WON,
  TRIGGER_OPTIONS,
  accionConMensajeDeWhatsapp,
  accionesParaTrigger,
  actionLabel,
  formatoLlevaImagen,
  formatoLlevaLink,
  textoInicial,
  textoParaFormato,
  triggerLabel,
  validarMensaje,
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
    expect(triggerLabel(TRIGGER_OPPORTUNITY_STALE)).toBe("Oportunidad sin movimiento");
    expect(actionLabel(ACTION_CREATE_FOLLOW_UP)).toBe("Crear actividad de seguimiento");
    expect(actionLabel(ACTION_DRAFT_FOLLOW_UP)).toBe("Redactar seguimiento con IA");
    // Un trigger o una acción que el backend ya conoce y este espejo todavía
    // no: el dato real informa más que un "—".
    expect(triggerLabel("appointment.reminder_due")).toBe("appointment.reminder_due");
    expect(actionLabel("whatsapp.send_message")).toBe("whatsapp.send_message");
  });

  it("los defaults del formulario son la primera entrada del catálogo, no un valor escrito a mano", () => {
    expect(DEFAULT_TRIGGER).toBe(TRIGGER_OPTIONS[0].value);
    expect(DEFAULT_ACTION).toBe(accionesParaTrigger(DEFAULT_TRIGGER)[0].value);
    expect(DEFAULT_ACTION).toBe(ACTION_CREATE_FOLLOW_UP);
  });

  it("todo trigger ofrecido sabe configurarse, y cada uno admite al menos una acción del catálogo", () => {
    for (const option of TRIGGER_OPTIONS) {
      expect(CONFIG_DE_TRIGGER[option.value]).toBeDefined();
      expect(accionesParaTrigger(option.value).length).toBeGreaterThan(0);
    }
  });

  it("espejo de la compatibilidad del backend: ganada -> tarea, QR o cupón, sin movimiento -> borrador con IA", () => {
    expect(ACCIONES_POR_TRIGGER).toEqual({
      [TRIGGER_OPPORTUNITY_WON]: [
        ACTION_CREATE_FOLLOW_UP,
        ACTION_SEND_QR_FOLLOWUP,
        ACTION_SEND_DISCOUNT_VOUCHER,
      ],
      [TRIGGER_OPPORTUNITY_STALE]: [ACTION_DRAFT_FOLLOW_UP],
    });
    // Un trigger que el espejo no conoce no restringe: decide el backend.
    expect(accionesParaTrigger("booking.reminder")).toEqual(ACTION_OPTIONS);
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

describe("configuración de opportunity.stale (ítem 76)", () => {
  const config = CONFIG_DE_TRIGGER[TRIGGER_OPPORTUNITY_STALE];

  it("borrador vacío, lectura del guardado y payload con el número como número", () => {
    expect(config.draftVacio()).toEqual({ daysWithoutActivity: "" });
    expect(config.draftDesde({ daysWithoutActivity: 7 })).toEqual({ daysWithoutActivity: "7" });
    expect(config.draftDesde({})).toEqual({ daysWithoutActivity: "" });
    expect(config.aPayload({ daysWithoutActivity: "7" })).toEqual({ daysWithoutActivity: 7 });
  });

  it("valida: requerido (sin confundir vacío con 0), entero y entre 0 y 365", () => {
    expect(config.validar({ daysWithoutActivity: "" })).toMatch(/Indicá cuántos días/);
    expect(config.validar({ daysWithoutActivity: "2.5" })).toMatch(/número entero/);
    expect(config.validar({ daysWithoutActivity: "-1" })).toMatch(/entre 0 y 365/);
    expect(config.validar({ daysWithoutActivity: "366" })).toMatch(/entre 0 y 365/);
    expect(config.validar({ daysWithoutActivity: "0" })).toBeNull();
    expect(config.validar({ daysWithoutActivity: "365" })).toBeNull();
  });

  it("opportunity.won y agent.draft_follow_up no tienen campos: siempre válidos y viajan como {}", () => {
    for (const vacia of [
      CONFIG_DE_TRIGGER[TRIGGER_OPPORTUNITY_WON],
      CONFIG_DE_ACCION[ACTION_DRAFT_FOLLOW_UP],
    ]) {
      expect(vacia.draftVacio()).toEqual({});
      expect(vacia.draftDesde({ loQueSea: 1 })).toEqual({});
      expect(vacia.validar({})).toBeNull();
      expect(vacia.aPayload({})).toEqual({});
    }
  });
});

describe("configuración de opportunity.send_qr_followup (ítem 159)", () => {
  const config = CONFIG_DE_ACCION[ACTION_SEND_QR_FOLLOWUP];
  const QR = "d54f2f0e-4d3c-4a3b-9a3e-8f2c9c1f0a11";
  const TEXTO = textoInicial(ACTION_SEND_QR_FOLLOWUP, "LINK");
  const MENSAJE = { whatsappFormat: "LINK", messageText: TEXTO };

  it("borrador vacío, lectura del guardado y payload con las horas como número y el mensaje", () => {
    expect(config.draftVacio()).toEqual({ qrCodeId: "", delayHours: "", ...MENSAJE });
    expect(config.draftDesde({ qrCodeId: QR, delayHours: 48, ...MENSAJE })).toEqual({
      qrCodeId: QR,
      delayHours: "48",
      ...MENSAJE,
    });
    // Una regla vieja: solo link, y el texto lo completa el formulario.
    expect(config.draftDesde({})).toEqual({
      qrCodeId: "",
      delayHours: "",
      whatsappFormat: "LINK",
      messageText: "",
    });
    expect(
      config.aPayload({
        qrCodeId: QR,
        delayHours: "48",
        whatsappFormat: "IMAGE",
        messageText: " Hola {nombre}, QR. ",
      }),
    ).toEqual({
      qrCodeId: QR,
      delayHours: 48,
      whatsappFormat: "IMAGE",
      messageText: "Hola {nombre}, QR.",
    });
  });

  it("valida: QR elegido, horas requeridas (sin confundir vacío con 0), enteras y entre 0 y 720", () => {
    const base = { qrCodeId: QR, ...MENSAJE };
    expect(config.validar({ ...base, qrCodeId: "", delayHours: "24" })).toMatch(/Elegí el QR/);
    expect(config.validar({ ...base, delayHours: "" })).toMatch(/cuántas horas/);
    expect(config.validar({ ...base, delayHours: "1.5" })).toMatch(/número entero/);
    expect(config.validar({ ...base, delayHours: "-1" })).toMatch(/entre 0 y 720/);
    expect(config.validar({ ...base, delayHours: "721" })).toMatch(/entre 0 y 720/);
    expect(config.validar({ ...base, delayHours: "0" })).toBeNull();
    expect(config.validar({ ...base, delayHours: "720" })).toBeNull();
  });
});

describe("configuración de opportunity.send_discount_voucher (ítem 177)", () => {
  const config = CONFIG_DE_ACCION[ACTION_SEND_DISCOUNT_VOUCHER];
  const SUCURSAL = "d54f2f0e-4d3c-4a3b-9a3e-8f2c9c1f0a11";
  const VALIDO = {
    label: "15% en el taller",
    branchId: SUCURSAL,
    delayHours: "24",
    expiresInDays: "30",
    whatsappFormat: "LINK_AND_IMAGE",
    messageText: textoInicial(ACTION_SEND_DISCOUNT_VOUCHER, "LINK_AND_IMAGE"),
  };

  it("se ofrece con Oportunidad ganada y arranca con el texto del cupón", () => {
    expect(accionesParaTrigger(TRIGGER_OPPORTUNITY_WON).map((o) => o.value)).toContain(
      ACTION_SEND_DISCOUNT_VOUCHER,
    );
    expect(config.draftVacio().messageText).toMatch(/cupón de descuento/);
  });

  it("payload con los números como número, la sucursal y el mensaje", () => {
    expect(config.aPayload(VALIDO)).toEqual({
      label: "15% en el taller",
      branchId: SUCURSAL,
      delayHours: 24,
      expiresInDays: 30,
      whatsappFormat: "LINK_AND_IMAGE",
      messageText: VALIDO.messageText,
    });
    expect(config.draftDesde(config.aPayload(VALIDO))).toEqual(VALIDO);
  });

  it("valida descuento, sucursal, horas, vencimiento y mensaje", () => {
    expect(config.validar(VALIDO)).toBeNull();
    expect(config.validar({ ...VALIDO, label: " " })).toMatch(/qué descuento/);
    expect(config.validar({ ...VALIDO, branchId: "" })).toMatch(/sucursal/);
    expect(config.validar({ ...VALIDO, delayHours: "" })).toMatch(/cuántas horas/);
    expect(config.validar({ ...VALIDO, expiresInDays: "0" })).toMatch(/entre 1 y 365/);
    expect(config.validar({ ...VALIDO, expiresInDays: "" })).toMatch(/entre 1 y 365/);
    expect(config.validar({ ...VALIDO, messageText: "" })).toMatch(/texto del mensaje/);
  });
});

describe("el mensaje de WhatsApp (formato y texto)", () => {
  it("con link: {nombre} y {link} una vez cada uno, en ese orden", () => {
    const conLink = (messageText: string) =>
      validarMensaje({ whatsappFormat: "LINK", messageText });
    expect(conLink("Hola {nombre}, acá: {link} gracias")).toBeNull();
    expect(conLink("Hola, acá: {link} gracias")).toMatch(/\{nombre\}/);
    expect(conLink("Hola {nombre}, gracias")).toMatch(/\{link\} una vez/);
    expect(conLink("Acá {link}, hola {nombre} chau")).toMatch(/antes que/);
  });

  it("solo imagen: sin {link}", () => {
    const soloImagen = (messageText: string) =>
      validarMensaje({ whatsappFormat: "IMAGE", messageText });
    expect(soloImagen("Hola {nombre}, tu QR. Gracias")).toBeNull();
    expect(soloImagen("Hola {nombre}, acá: {link} gracias")).toMatch(/sacá \{link\}/);
  });

  it("cambiar de formato cambia el texto inicial, pero nunca uno escrito por el negocio", () => {
    const inicial = textoInicial(ACTION_SEND_QR_FOLLOWUP, "LINK");
    expect(textoParaFormato(ACTION_SEND_QR_FOLLOWUP, inicial, "IMAGE")).toBe(
      textoInicial(ACTION_SEND_QR_FOLLOWUP, "IMAGE"),
    );
    expect(textoParaFormato(ACTION_SEND_QR_FOLLOWUP, "Mi texto {nombre} {link} fin", "IMAGE")).toBe(
      "Mi texto {nombre} {link} fin",
    );
    expect(formatoLlevaLink("IMAGE")).toBe(false);
    expect(formatoLlevaImagen("LINK_AND_IMAGE")).toBe(true);
    expect(accionConMensajeDeWhatsapp(ACTION_SEND_QR_FOLLOWUP)).toBe(true);
    expect(accionConMensajeDeWhatsapp(ACTION_CREATE_FOLLOW_UP)).toBe(false);
  });
});
