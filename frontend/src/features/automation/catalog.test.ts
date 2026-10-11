import { describe, expect, it } from "vitest";
import { previewDePlantilla } from "./whatsappPreview";
import {
  ACCIONES_POR_TRIGGER,
  ACTION_CREATE_FOLLOW_UP,
  ACTION_DRAFT_FOLLOW_UP,
  ACTION_INQUIRY_FOLLOW_UP,
  ACTION_OPTIONS,
  ACTION_SEND_DISCOUNT_VOUCHER,
  ACTION_SEND_QR_FOLLOWUP,
  CONFIG_DE_ACCION,
  CONFIG_DE_TRIGGER,
  DEFAULT_ACTION,
  DEFAULT_TRIGGER,
  MAX_DELAY_MINUTES,
  MAX_NOTES,
  TRIGGER_CONTACT_INQUIRY_STALLED,
  TRIGGER_OPPORTUNITY_STALE,
  TRIGGER_OPPORTUNITY_WON,
  TRIGGER_OPTIONS,
  TEXTO_INICIAL_DE_CONSULTA,
  TEXTO_INICIAL_DE_CONSULTA_DE_CLINICA,
  TEXTO_INICIAL_DEL_RECORDATORIO,
  mensajeDeLaAccion,
  validarMensajeDeConsulta,
  accionConMensajeDeWhatsapp,
  accionesParaTrigger,
  actionLabel,
  demoraEnUnidad,
  formatoLlevaImagen,
  formatoLlevaLink,
  minutosDeLaDemora,
  textoInicial,
  textoParaFormato,
  triggerLabel,
  triggerOptions,
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

  it("espejo de la compatibilidad del backend: ganada -> tarea, QR o cupón; sin movimiento -> borrador con IA; consulta sin avance -> retomar la consulta", () => {
    expect(ACCIONES_POR_TRIGGER).toEqual({
      [TRIGGER_OPPORTUNITY_WON]: [
        ACTION_CREATE_FOLLOW_UP,
        ACTION_SEND_QR_FOLLOWUP,
        ACTION_SEND_DISCOUNT_VOUCHER,
      ],
      [TRIGGER_OPPORTUNITY_STALE]: [ACTION_DRAFT_FOLLOW_UP],
      [TRIGGER_CONTACT_INQUIRY_STALLED]: [ACTION_INQUIRY_FOLLOW_UP],
      // R13: solo clínicas.
      "booking.reminder_due": ["booking.send_reminder"],
      // R14: solo clínicas.
      "booking.completed": ["booking.send_qr_review", "booking.schedule_control"],
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

describe("la demora de las reglas que agendan un WhatsApp: minutos, horas o días", () => {
  it("lee delayMinutes, o convierte el delayHours de una regla vieja", () => {
    expect(minutosDeLaDemora({ delayMinutes: 15 })).toBe(15);
    expect(minutosDeLaDemora({ delayHours: 24 })).toBe(1440);
    expect(minutosDeLaDemora({ delayHours: 0 })).toBe(0);
    expect(minutosDeLaDemora({})).toBeNull();
  });

  it("muestra los minutos en la unidad más grande que los divide exacto", () => {
    expect(demoraEnUnidad(1440)).toEqual({ cantidad: 1, unidad: "days" });
    expect(demoraEnUnidad(MAX_DELAY_MINUTES)).toEqual({ cantidad: 30, unidad: "days" });
    expect(demoraEnUnidad(2880 + 60)).toEqual({ cantidad: 49, unidad: "hours" });
    expect(demoraEnUnidad(60)).toEqual({ cantidad: 1, unidad: "hours" });
    expect(demoraEnUnidad(90)).toEqual({ cantidad: 90, unidad: "minutes" });
    expect(demoraEnUnidad(15)).toEqual({ cantidad: 15, unidad: "minutes" });
    expect(demoraEnUnidad(0)).toEqual({ cantidad: 0, unidad: "hours" });
  });
});

describe("configuración de opportunity.send_qr_followup (ítem 159)", () => {
  const config = CONFIG_DE_ACCION[ACTION_SEND_QR_FOLLOWUP];
  const QR = "d54f2f0e-4d3c-4a3b-9a3e-8f2c9c1f0a11";
  const TEXTO = textoInicial(ACTION_SEND_QR_FOLLOWUP, "LINK");
  const MENSAJE = { whatsappFormat: "LINK", messageText: TEXTO };

  it("borrador vacío, lectura del guardado y payload con la demora en minutos y el mensaje", () => {
    expect(config.draftVacio()).toEqual({
      qrCodeId: "",
      delayAmount: "",
      delayUnit: "hours",
      ...MENSAJE,
    });
    expect(config.draftDesde({ qrCodeId: QR, delayMinutes: 30, ...MENSAJE })).toEqual({
      qrCodeId: QR,
      delayAmount: "30",
      delayUnit: "minutes",
      ...MENSAJE,
    });
    // Una regla vieja: solo link, y el texto lo completa el formulario.
    expect(config.draftDesde({})).toEqual({
      qrCodeId: "",
      delayAmount: "",
      delayUnit: "hours",
      whatsappFormat: "LINK",
      messageText: "",
    });
    expect(
      config.aPayload({
        qrCodeId: QR,
        delayAmount: "2",
        delayUnit: "days",
        whatsappFormat: "IMAGE",
        messageText: " Hola {nombre}, QR. ",
      }),
    ).toEqual({
      qrCodeId: QR,
      delayMinutes: 2880,
      whatsappFormat: "IMAGE",
      messageText: "Hola {nombre}, QR.",
    });
  });

  it("una regla vieja con delayHours se abre en su unidad y se guarda en minutos", () => {
    const draft = config.draftDesde({ qrCodeId: QR, delayHours: 24, ...MENSAJE });
    expect(draft).toMatchObject({ delayAmount: "1", delayUnit: "days" });
    expect(config.draftDesde({ qrCodeId: QR, delayHours: 5, ...MENSAJE })).toMatchObject({
      delayAmount: "5",
      delayUnit: "hours",
    });
    const payload = config.aPayload(draft);
    expect(payload.delayMinutes).toBe(1440);
    expect(payload).not.toHaveProperty("delayHours");
  });

  it("valida: QR elegido, espera requerida (sin confundir vacío con 0), entera y hasta 30 días en cualquier unidad", () => {
    const base = { qrCodeId: QR, delayUnit: "hours", ...MENSAJE };
    expect(config.validar({ ...base, qrCodeId: "", delayAmount: "24" })).toMatch(/Elegí el QR/);
    expect(config.validar({ ...base, delayAmount: "" })).toMatch(/cuánto esperar/);
    expect(config.validar({ ...base, delayAmount: "1.5" })).toMatch(/número entero/);
    expect(config.validar({ ...base, delayAmount: "-1" })).toMatch(/negativa/);
    expect(config.validar({ ...base, delayAmount: "721" })).toMatch(/30 días/);
    expect(config.validar({ ...base, delayAmount: "0" })).toBeNull();
    expect(config.validar({ ...base, delayAmount: "720" })).toBeNull();
    expect(config.validar({ ...base, delayUnit: "minutes", delayAmount: "15" })).toBeNull();
    expect(config.validar({ ...base, delayUnit: "minutes", delayAmount: "43200" })).toBeNull();
    expect(config.validar({ ...base, delayUnit: "minutes", delayAmount: "43201" })).toMatch(
      /30 días/,
    );
    expect(config.validar({ ...base, delayUnit: "days", delayAmount: "30" })).toBeNull();
    expect(config.validar({ ...base, delayUnit: "days", delayAmount: "31" })).toMatch(/30 días/);
  });
});

describe("configuración de opportunity.send_discount_voucher (ítem 177)", () => {
  const config = CONFIG_DE_ACCION[ACTION_SEND_DISCOUNT_VOUCHER];
  const SUCURSAL = "d54f2f0e-4d3c-4a3b-9a3e-8f2c9c1f0a11";
  const VALIDO = {
    label: "15% en el taller",
    branchId: SUCURSAL,
    delayAmount: "1",
    delayUnit: "days",
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
      delayMinutes: 1440,
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
    expect(config.validar({ ...VALIDO, delayAmount: "" })).toMatch(/cuánto esperar/);
    expect(config.validar({ ...VALIDO, delayAmount: "31" })).toMatch(/30 días/);
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

// Ítem 185: el trigger "Consulta sin avance" y la acción "Retomar la consulta".
describe("contact.inquiry_stalled e inquiry.follow_up (ítem 185)", () => {
  const trigger = CONFIG_DE_TRIGGER[TRIGGER_CONTACT_INQUIRY_STALLED];
  const accion = CONFIG_DE_ACCION[ACTION_INQUIRY_FOLLOW_UP];

  it("el trigger arranca con 3 días y 1 seguimiento, lee lo guardado y viaja como números", () => {
    expect(trigger.draftVacio()).toEqual({ daysSinceLastMessage: "3", maxFollowUps: "1" });
    expect(trigger.draftDesde({ daysSinceLastMessage: 7, maxFollowUps: 2 })).toEqual({
      daysSinceLastMessage: "7",
      maxFollowUps: "2",
    });
    expect(trigger.aPayload({ daysSinceLastMessage: "7", maxFollowUps: "2" })).toEqual({
      daysSinceLastMessage: 7,
      maxFollowUps: 2,
    });
    expect(trigger.validar({ daysSinceLastMessage: "0", maxFollowUps: "1" })).toBeNull();
    expect(trigger.validar({ daysSinceLastMessage: "", maxFollowUps: "1" })).toMatch(
      /días sin respuesta/,
    );
    expect(trigger.validar({ daysSinceLastMessage: "366", maxFollowUps: "1" })).toMatch(
      /entre 0 y 365/,
    );
    expect(trigger.validar({ daysSinceLastMessage: "3", maxFollowUps: "0" })).toMatch(
      /entre 1 y 20/,
    );
    expect(trigger.validar({ daysSinceLastMessage: "3", maxFollowUps: "1.5" })).toMatch(/entero/);
  });

  it("la acción arranca con el texto por defecto, sin formato, con {saludo} y {vehiculo}", () => {
    expect(accion.draftVacio()).toEqual({ messageText: TEXTO_INICIAL_DE_CONSULTA });
    expect(accion.aPayload({ messageText: "  ¡{saludo}! ¿Seguís?  " })).toEqual({
      messageText: "¡{saludo}! ¿Seguís?",
    });
    const mensaje = mensajeDeLaAccion(ACTION_INQUIRY_FOLLOW_UP, "LINK");
    expect(mensaje.conFormato).toBe(false);
    expect(mensaje.variables.map((v) => v.token)).toEqual(["{saludo}", "{vehiculo}"]);
    expect(
      mensajeDeLaAccion(ACTION_SEND_QR_FOLLOWUP, "LINK").variables.map((v) => v.token),
    ).toEqual(["{nombre}", "{link}"]);
    expect(
      mensajeDeLaAccion(ACTION_SEND_QR_FOLLOWUP, "IMAGE").variables.map((v) => v.token),
    ).toEqual(["{nombre}"]);
  });

  it("valida el mensaje: {saludo} una vez, {vehiculo} a lo sumo una y después, y ningún {nombre}/{link}", () => {
    expect(validarMensajeDeConsulta({ messageText: TEXTO_INICIAL_DE_CONSULTA })).toBeNull();
    expect(validarMensajeDeConsulta({ messageText: "¡{saludo}! ¿Seguís?" })).toBeNull();
    expect(validarMensajeDeConsulta({ messageText: "" })).toMatch(/Escribí el texto/);
    expect(validarMensajeDeConsulta({ messageText: "¿Seguís interesado en {vehiculo}?" })).toMatch(
      /incluir {saludo} una vez/,
    );
    expect(
      validarMensajeDeConsulta({ messageText: "¡{saludo}! {vehiculo} y {vehiculo}." }),
    ).toMatch(/más de una vez/);
    expect(validarMensajeDeConsulta({ messageText: "¡{saludo}! Hola {nombre}." })).toMatch(
      /solo valen/,
    );
    expect(validarMensajeDeConsulta({ messageText: "Por {vehiculo}. ¡{saludo}!" })).toMatch(
      /antes que/,
    );
  });
});

// Ediciones (docs/ediciones.md §8): el mismo catálogo, con la venta nombrada
// como en ESENCIAL.
describe("catálogo — rótulos por edición", () => {
  it("ESENCIAL nombra la venta «Venta registrada»; lo demás, igual", () => {
    expect(triggerLabel(TRIGGER_OPPORTUNITY_WON, true)).toBe("Venta registrada");
    expect(triggerOptions(true).find((o) => o.value === TRIGGER_OPPORTUNITY_WON)?.subtitle).toBe(
      "Cuando se registra una venta",
    );
    expect(triggerLabel(TRIGGER_OPPORTUNITY_STALE, true)).toBe("Oportunidad sin movimiento");
    expect(triggerOptions(true).map((o) => o.value)).toEqual(TRIGGER_OPTIONS.map((o) => o.value));
  });

  it("COMPLETA, los rótulos de siempre", () => {
    expect(triggerOptions(false)).toBe(TRIGGER_OPTIONS);
    expect(triggerLabel(TRIGGER_OPPORTUNITY_WON, false)).toBe("Oportunidad ganada");
  });
});

// R15 (docs/rubros.md §9.1): el seguimiento de consultas de una clínica.
describe("seguimiento de consultas por rubro", () => {
  it("una automotora: el texto, las variables y la validación de siempre", () => {
    expect(textoInicial(ACTION_INQUIRY_FOLLOW_UP, "LINK")).toBe(TEXTO_INICIAL_DE_CONSULTA);
    expect(
      mensajeDeLaAccion(ACTION_INQUIRY_FOLLOW_UP, "LINK").variables.map((v) => v.token),
    ).toEqual(["{saludo}", "{vehiculo}"]);
    expect(validarMensajeDeConsulta({ messageText: TEXTO_INICIAL_DE_CONSULTA })).toBeNull();
    expect(validarMensajeDeConsulta({ messageText: TEXTO_INICIAL_DE_CONSULTA_DE_CLINICA })).toMatch(
      /solo valen \{saludo\} y \{vehiculo\}/,
    );
  });

  it("una clínica: {prestacion} en lugar de {vehiculo}, con su texto inicial", () => {
    expect(textoInicial(ACTION_INQUIRY_FOLLOW_UP, "LINK", true)).toBe(
      TEXTO_INICIAL_DE_CONSULTA_DE_CLINICA,
    );
    expect(
      mensajeDeLaAccion(ACTION_INQUIRY_FOLLOW_UP, "LINK", true).variables.map((v) => v.token),
    ).toEqual(["{saludo}", "{prestacion}"]);
    expect(
      validarMensajeDeConsulta({ messageText: TEXTO_INICIAL_DE_CONSULTA_DE_CLINICA }, true),
    ).toBeNull();
    expect(validarMensajeDeConsulta({ messageText: TEXTO_INICIAL_DE_CONSULTA }, true)).toMatch(
      /solo valen \{saludo\} y \{prestacion\}/,
    );
    expect(CONFIG_DE_ACCION[ACTION_INQUIRY_FOLLOW_UP].draftVacio(true).messageText).toBe(
      TEXTO_INICIAL_DE_CONSULTA_DE_CLINICA,
    );
    expect(previewDePlantilla(TEXTO_INICIAL_DE_CONSULTA_DE_CLINICA)).toContain("limpieza facial");
  });
});

// R13 (docs/rubros.md §6): el recordatorio de turno, solo en una clínica.
describe("recordatorio de turno (clínica)", () => {
  it("una automotora no ve el trigger ni la acción; una clínica sí", () => {
    expect(triggerOptions(false).map((o) => o.value)).not.toContain("booking.reminder_due");
    expect(triggerOptions(true).map((o) => o.value)).not.toContain("booking.reminder_due");
    expect(triggerOptions(false, true).map((o) => o.value)).toContain("booking.reminder_due");
    for (const trigger of ["opportunity.won", "opportunity.stale", "contact.inquiry_stalled"]) {
      expect(accionesParaTrigger(trigger).map((o) => o.value)).not.toContain(
        "booking.send_reminder",
      );
    }
    expect(accionesParaTrigger("booking.reminder_due").map((o) => o.value)).toEqual([
      "booking.send_reminder",
    ]);
    expect(triggerLabel("booking.reminder_due")).toBe("Recordatorio antes del turno");
    expect(actionLabel("booking.send_reminder")).toBe("Mandar el recordatorio por WhatsApp");
  });

  it("el texto inicial, las variables y la validación", () => {
    const config = CONFIG_DE_ACCION["booking.send_reminder"];
    const draft = config.draftVacio();
    expect(draft.messageText).toBe(TEXTO_INICIAL_DEL_RECORDATORIO);
    expect(config.validar(draft)).toBeNull();
    expect(draft.messageText).not.toMatch(/prestaci/);
    expect(
      mensajeDeLaAccion("booking.send_reminder", "LINK").variables.map((v) => v.token),
    ).toEqual(["{nombre}", "{lugar}", "{dia}", "{hora}", "{profesional}"]);
    expect(config.validar({ messageText: "Hola {nombre}, tu turno es el {dia}." })).toMatch(
      /\{hora\}/,
    );
    expect(
      config.validar({ messageText: "Hola {nombre}, el {dia} a las {hora} por {prestacion}." }),
    ).toMatch(/no va en este mensaje/);
    expect(accionConMensajeDeWhatsapp("booking.send_reminder")).toBe(true);
    expect(previewDePlantilla(TEXTO_INICIAL_DEL_RECORDATORIO)).toContain(
      "Clínica Ejemplo (sede Centro)",
    );
  });
});

// R14 (docs/rubros.md §7): el QR de reseña y el control, solo en una clínica.
describe("después del turno (clínica)", () => {
  it("una automotora no ve el trigger ni las acciones", () => {
    expect(triggerOptions(false).map((o) => o.value)).not.toContain("booking.completed");
    expect(triggerOptions(false, true).map((o) => o.value)).toContain("booking.completed");
    expect(accionesParaTrigger("opportunity.won").map((o) => o.value)).not.toContain(
      "booking.send_qr_review",
    );
  });

  it("el QR de reseña exige al menos 3 horas de espera", () => {
    const config = CONFIG_DE_ACCION["booking.send_qr_review"];
    const draft = { ...config.draftVacio(), qrCodeId: "qr1" };
    expect(config.validar(draft)).toBeNull();
    expect(config.validar({ ...draft, delayAmount: "2" })).toMatch(/al menos 3 horas/);
    expect(config.aPayload(draft)).toMatchObject({ qrCodeId: "qr1", delayMinutes: 180 });
  });

  it("el control: texto inicial sin datos de salud y sus variables", () => {
    const config = CONFIG_DE_ACCION["booking.schedule_control"];
    expect(config.validar(config.draftVacio())).toBeNull();
    expect(
      mensajeDeLaAccion("booking.schedule_control", "LINK").variables.map((v) => v.token),
    ).toEqual(["{nombre}", "{semanas}", "{lugar}"]);
    expect(config.validar({ messageText: "Hola {nombre}, tu {prestacion}." })).toMatch(
      /no va en este mensaje/,
    );
  });
});
