import type { BadgeVariant } from "../../design-system/Badge";
import type { SelectOption } from "../../design-system/Select";
import type { WhatsappApproval, WhatsappFormat } from "./types";
import {
  TOKEN_LINK,
  TOKEN_NOMBRE,
  TOKEN_PRESTACION,
  TOKEN_SALUDO,
  TOKEN_VEHICULO,
} from "./whatsappPreview";

// ---------------------------------------------------------------------------
// Catálogo de triggers y acciones del motor de automatizaciones, del lado del
// frontend (ítem 62 de docs/frontend-cambios-pendientes.md).
//
// POR QUÉ EXISTE ESTE ARCHIVO. El catálogo real vive en código del backend
// —`TRIGGERS_CONOCIDOS` en src/services/automationTriggers.ts y el registro de
// src/services/automationActions.ts— y NO hay ningún endpoint que lo exponga.
// Así que la pantalla necesita su propio espejo, chico y tipado, igual que
// MODEL_PROVIDER_OPTIONS en features/agent/labels.ts es el espejo de
// LLM_PROVIDER_NAMES. Es una lista y no un input libre a propósito: el backend
// rechaza con 400 cualquier string que no esté en su catálogo, así que ofrecer
// texto libre sería invitar a un error que nadie puede resolver desde la
// pantalla.
//
// HOY HAY DOS TRIGGERS Y CUATRO ACCIONES (ACCIONES_POR_TRIGGER): "Oportunidad
// ganada" -> tarea de seguimiento, envío del QR por WhatsApp (ítem 159) o del
// cupón de descuento (ítem 177), y
// "Oportunidad sin movimiento" -> borrador de seguimiento redactado por la IA
// (ítem 76). El otro caso previsto —recordatorio de turno por WhatsApp— sigue
// sin construir (docs/automations-architecture.md §1-2).
//
// AGREGAR UN TRIGGER es agregar una entrada a TRIGGER_OPTIONS, una a
// CONFIG_DE_TRIGGER (aunque no tenga campos: la config vacía) y, si tiene
// campos, un `case` al switch de campos del trigger en AutomationFormPage.
// AGREGAR UNA ACCIÓN es agregar una entrada a ACTION_OPTIONS, una a
// CONFIG_DE_ACCION (cómo se lee, se valida y se arma su actionConfig), sumarla
// a ACCIONES_POR_TRIGGER y un `case` al switch de campos de la acción —
// ninguno de esos lugares es una reescritura del formulario.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Triggers
// ---------------------------------------------------------------------------

// Espejo de TRIGGER_OPPORTUNITY_WON, TRIGGER_OPPORTUNITY_STALE y
// TRIGGER_CONTACT_INQUIRY_STALLED (ítem 185).
export const TRIGGER_OPPORTUNITY_WON = "opportunity.won";
export const TRIGGER_OPPORTUNITY_STALE = "opportunity.stale";
export const TRIGGER_CONTACT_INQUIRY_STALLED = "contact.inquiry_stalled";

export const TRIGGER_OPTIONS: SelectOption<string>[] = [
  {
    value: TRIGGER_OPPORTUNITY_WON,
    label: "Oportunidad ganada",
    subtitle: "Cuando una oportunidad pasa al estado Ganada",
  },
  {
    value: TRIGGER_OPPORTUNITY_STALE,
    label: "Oportunidad sin movimiento",
    subtitle: "Cuando una oportunidad abierta lleva varios días sin cambios",
  },
  {
    value: TRIGGER_CONTACT_INQUIRY_STALLED,
    label: "Consulta sin avance",
    subtitle: "Cuando alguien consultó y lleva varios días sin responder",
  },
];

// ESENCIAL (docs/ediciones.md §8): el catálogo es el mismo; solo cambia cómo
// se nombra la venta, porque ahí no hay etapas sino el estado Vendida.
const TRIGGER_OPTIONS_ESENCIAL: SelectOption<string>[] = TRIGGER_OPTIONS.map((option) =>
  option.value === TRIGGER_OPPORTUNITY_WON
    ? { ...option, label: "Venta registrada", subtitle: "Cuando se registra una venta" }
    : option,
);

/** Las opciones del selector de trigger. `simple`: sin procesos de venta
 *  (ESENCIAL). */
export function triggerOptions(simple: boolean): SelectOption<string>[] {
  return simple ? TRIGGER_OPTIONS_ESENCIAL : TRIGGER_OPTIONS;
}

// El rótulo de un trigger en el listado. Un valor fuera de la lista —un
// trigger que el backend ya conoce y este espejo todavía no— se muestra crudo
// en vez de como "—": el dato real informa más que su ausencia, mismo criterio
// que modelProviderLabel en features/agent/labels.ts.
export function triggerLabel(value: string, simple = false): string {
  return triggerOptions(simple).find((option) => option.value === value)?.label ?? value;
}

// ---------------------------------------------------------------------------
// Acciones
// ---------------------------------------------------------------------------

// Espejo de ACTION_CREATE_FOLLOW_UP, ACTION_DRAFT_FOLLOW_UP,
// ACTION_SEND_QR_FOLLOWUP, ACTION_SEND_DISCOUNT_VOUCHER y
// ACTION_INQUIRY_FOLLOW_UP (ítem 185).
export const ACTION_CREATE_FOLLOW_UP = "activity.create_follow_up";
export const ACTION_DRAFT_FOLLOW_UP = "agent.draft_follow_up";
export const ACTION_SEND_QR_FOLLOWUP = "opportunity.send_qr_followup";
export const ACTION_SEND_DISCOUNT_VOUCHER = "opportunity.send_discount_voucher";
export const ACTION_INQUIRY_FOLLOW_UP = "inquiry.follow_up";

export const ACTION_OPTIONS: SelectOption<string>[] = [
  {
    value: ACTION_CREATE_FOLLOW_UP,
    label: "Crear actividad de seguimiento",
    subtitle: "Una tarea para el dueño de la oportunidad",
  },
  {
    value: ACTION_DRAFT_FOLLOW_UP,
    label: "Redactar seguimiento con IA",
    subtitle: "Un borrador de mensaje para que el dueño lo revise y lo mande",
  },
  {
    value: ACTION_SEND_QR_FOLLOWUP,
    label: "Enviar QR por WhatsApp",
    subtitle: "Un WhatsApp al cliente con el link de un QR, unas horas después",
  },
  {
    value: ACTION_SEND_DISCOUNT_VOUCHER,
    label: "Enviar cupón de descuento",
    subtitle: "Un WhatsApp al cliente con un cupón de un solo uso, unas horas después",
  },
  {
    value: ACTION_INQUIRY_FOLLOW_UP,
    label: "Retomar la consulta",
    subtitle:
      "Un WhatsApp al cliente; por Messenger, Instagram o el sitio web, una tarea para el vendedor",
  },
];

export function actionLabel(value: string): string {
  return ACTION_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

// Espejo de la compatibilidad que cada acción declara en el backend
// (AccionRegistrada.triggers): el CRUD rechaza con 400 una regla que combine
// una acción con un trigger que no admite. Acá sirve para que el selector de
// acción ofrezca solo las que tienen sentido con el evento elegido, en vez de
// dejar armar una combinación que el backend va a rechazar.
//
// No es preferencia de pantalla: "Crear actividad de seguimiento" colgada de
// "Oportunidad sin movimiento" crearía la misma tarea TODOS los días, porque
// esa acción no deja la marca que frena al barrido diario.
export const ACCIONES_POR_TRIGGER: Record<string, readonly string[]> = {
  [TRIGGER_OPPORTUNITY_WON]: [
    ACTION_CREATE_FOLLOW_UP,
    ACTION_SEND_QR_FOLLOWUP,
    ACTION_SEND_DISCOUNT_VOUCHER,
  ],
  [TRIGGER_OPPORTUNITY_STALE]: [ACTION_DRAFT_FOLLOW_UP],
  [TRIGGER_CONTACT_INQUIRY_STALLED]: [ACTION_INQUIRY_FOLLOW_UP],
};

// Las acciones que el selector ofrece para un trigger. Un trigger que este
// espejo todavía no conoce no restringe nada: quien decide es el backend.
export function accionesParaTrigger(triggerType: string): SelectOption<string>[] {
  const permitidas = ACCIONES_POR_TRIGGER[triggerType];
  if (!permitidas) return ACTION_OPTIONS;
  return ACTION_OPTIONS.filter((option) => permitidas.includes(option.value));
}

// ---------------------------------------------------------------------------
// La configuración de cada acción
// ---------------------------------------------------------------------------

// El borrador de la config en el formulario: TODOS los campos como string,
// incluso los numéricos. Es lo que un <input> produce, y guardarlo así evita
// el problema clásico de un campo numérico controlado —que "" y 0 se
// confundan mientras se está borrando el contenido—. La conversión al tipo
// real ocurre en un solo lugar, `aPayload`, y recién al guardar.
export type ConfigDraft = Record<string, string>;

export interface ConfigDeAccion {
  // El borrador de una regla nueva con esta acción. `esClinica` (R15): el
  // seguimiento de consultas de una clínica arranca con su propio texto.
  draftVacio: (esClinica?: boolean) => ConfigDraft;
  // El borrador a partir del actionConfig que devolvió el backend.
  draftDesde: (config: Record<string, unknown>) => ConfigDraft;
  // El error de validación del cliente, o null si puede viajar. Duplica a
  // propósito lo que el backend ya valida: no para reemplazarlo —quien manda
  // sigue siendo el 400— sino para que el rango se vea ANTES de mandar, con
  // el mensaje en el idioma de la pantalla.
  validar: (draft: ConfigDraft, esClinica?: boolean) => string | null;
  // El actionConfig tal como lo espera el schema de esa acción en el backend.
  aPayload: (draft: ConfigDraft) => Record<string, unknown>;
}

// Los topes de configDeSeguimientoSchema
// (src/services/automationActions/createFollowUpActivity.ts). Exportados
// porque el formulario también los usa para el maxLength/min/max del navegador
// — comodidad, no garantía: quien valida de verdad es Zod del otro lado.
export const MAX_SUBJECT = 200;
export const MIN_DAYS_UNTIL_DUE = 0;
export const MAX_DAYS_UNTIL_DUE = 365;
// El tope de `notes`. Se replica acá —y se chequea en validar()— por el mismo
// motivo que MAX_SUBJECT: que el mensaje salga en el idioma de la pantalla y
// no como el "notes no puede superar los 5000 caracteres" de Zod. Igual que
// con el título, el maxLength del <textarea> hace que desde el teclado no se
// llegue a ese mensaje; validar() es el backstop de la ACCIÓN, no del input
// que hoy le toca dibujar, y por eso se prueba en catalog.test.ts.
export const MAX_NOTES = 5000;

const configDeSeguimiento: ConfigDeAccion = {
  draftVacio: () => ({ subject: "", daysUntilDue: "", notes: "" }),

  draftDesde: (config) => ({
    subject: typeof config.subject === "string" ? config.subject : "",
    // El número llega como number en el JSON; al borrador entra como texto.
    daysUntilDue: typeof config.daysUntilDue === "number" ? String(config.daysUntilDue) : "",
    // `notes` es opcional: una regla guardada sin notas no trae la clave, y el
    // borrador la abre vacía — el mismo "" con el que arranca una regla nueva.
    notes: typeof config.notes === "string" ? config.notes : "",
  }),

  validar: (draft) => {
    if (draft.subject.trim() === "") {
      return "Escribí el título de la tarea que se va a crear.";
    }
    if (draft.subject.trim().length > MAX_SUBJECT) {
      return `El título de la tarea no puede superar los ${MAX_SUBJECT} caracteres.`;
    }
    if (draft.daysUntilDue.trim() === "") {
      return "Indicá en cuántos días vence la tarea.";
    }
    // Number("") es 0 y Number("3 ") es 3: por eso se valida el string vacío
    // antes y se exige entero después. `1e2` también pasaría Number(), pero
    // Number.isInteger lo acepta (es 100) y el backend también — no es un
    // agujero, es la misma tolerancia de los dos lados.
    const dias = Number(draft.daysUntilDue);
    if (!Number.isInteger(dias)) {
      return "Los días hasta el vencimiento tienen que ser un número entero.";
    }
    if (dias < MIN_DAYS_UNTIL_DUE || dias > MAX_DAYS_UNTIL_DUE) {
      return `Los días hasta el vencimiento tienen que estar entre ${MIN_DAYS_UNTIL_DUE} y ${MAX_DAYS_UNTIL_DUE}.`;
    }
    // Las notas son OPCIONALES: acá no se pide que estén, solo que si están no
    // sean más largas que lo que el backend acepta.
    if (draft.notes.trim().length > MAX_NOTES) {
      return `Las notas no pueden superar los ${MAX_NOTES} caracteres.`;
    }
    return null;
  },

  aPayload: (draft) => {
    const notes = draft.notes.trim();
    return {
      subject: draft.subject.trim(),
      daysUntilDue: Number(draft.daysUntilDue),
      // Sin notas NO VIAJA LA CLAVE, y no un "": el schema del backend rechaza
      // el string vacío a propósito, y guardar "" en la regla sería anotar una
      // intención que nadie tuvo. Mismo criterio que `body: input.body ||
      // undefined` en el formulario manual de actividades.
      ...(notes === "" ? {} : { notes }),
    };
  },
};

// ---------------------------------------------------------------------------
// La demora de las reglas del QR y del cupón. El backend la guarda en minutos
// (delayMinutes, de 0 —apenas se gana— a 30 días; demoraDelEnvio.ts); el
// formulario la pide como un número entero más una unidad. Las reglas
// guardadas antes de los minutos traen delayHours: se leen en minutos igual
// que en el backend, y al guardarlas viajan ya como delayMinutes.
// ---------------------------------------------------------------------------

export type UnidadDeDemora = "minutes" | "hours" | "days";

export const MINUTOS_POR_UNIDAD: Record<UnidadDeDemora, number> = {
  minutes: 1,
  hours: 60,
  days: 24 * 60,
};

export const UNIDAD_DE_DEMORA_OPTIONS: SelectOption<UnidadDeDemora>[] = [
  { value: "minutes", label: "Minutos" },
  { value: "hours", label: "Horas" },
  { value: "days", label: "Días" },
];

export const MAX_DELAY_MINUTES = 30 * MINUTOS_POR_UNIDAD.days;

// Cada cuánto revisan los envíos vencidos los workers del QR y del cupón: el
// default de QR_FOLLOWUP_WORKER_POLL_MS y DISCOUNT_VOUCHER_FOLLOWUP_WORKER_POLL_MS
// (src/config/env.ts). Un envío sale hasta ese lapso después de lo pedido, y
// con esperas de minutos eso se nota: el texto de ayuda lo avisa.
export const INTERVALO_DE_LOS_ENVIOS_MINUTOS = 5;

// La unidad con la que arranca una regla nueva: la de siempre.
const UNIDAD_POR_DEFECTO: UnidadDeDemora = "hours";

// Los minutos que pide un actionConfig guardado, o null si no trae demora.
export function minutosDeLaDemora(config: Record<string, unknown>): number | null {
  if (typeof config.delayMinutes === "number") return config.delayMinutes;
  if (typeof config.delayHours === "number") return config.delayHours * MINUTOS_POR_UNIDAD.hours;
  return null;
}

// Los minutos expresados en la unidad más grande que los divide exacto: 1440
// es "1 día", 90 es "90 minutos". El 0 se muestra en la unidad por defecto.
export function demoraEnUnidad(minutos: number): { cantidad: number; unidad: UnidadDeDemora } {
  if (minutos > 0) {
    for (const unidad of ["days", "hours"] as const) {
      if (minutos % MINUTOS_POR_UNIDAD[unidad] === 0) {
        return { cantidad: minutos / MINUTOS_POR_UNIDAD[unidad], unidad };
      }
    }
    return { cantidad: minutos, unidad: "minutes" };
  }
  return { cantidad: 0, unidad: UNIDAD_POR_DEFECTO };
}

function unidadDelDraft(draft: ConfigDraft): UnidadDeDemora {
  const unidad = draft.delayUnit;
  return unidad === "minutes" || unidad === "days" ? unidad : "hours";
}

function demoraVacia(): ConfigDraft {
  return { delayAmount: "", delayUnit: UNIDAD_POR_DEFECTO };
}

function demoraDesde(config: Record<string, unknown>): ConfigDraft {
  const minutos = minutosDeLaDemora(config);
  if (minutos === null) return demoraVacia();
  const { cantidad, unidad } = demoraEnUnidad(minutos);
  return { delayAmount: String(cantidad), delayUnit: unidad };
}

function demoraAPayload(draft: ConfigDraft): { delayMinutes: number } {
  return { delayMinutes: Number(draft.delayAmount) * MINUTOS_POR_UNIDAD[unidadDelDraft(draft)] };
}

// Mismo criterio que daysUntilDue: el vacío se valida antes (Number("") es 0)
// y después se exige entero y en rango. El tope se mide en minutos, así que
// vale igual en cualquier unidad.
function validarDemoraDelDraft(draft: ConfigDraft): string | null {
  const texto = (draft.delayAmount ?? "").trim();
  if (texto === "") {
    return "Indicá cuánto esperar antes de mandar el WhatsApp.";
  }
  const cantidad = Number(texto);
  if (!Number.isInteger(cantidad)) {
    return "La espera tiene que ser un número entero.";
  }
  if (cantidad < 0) {
    return "La espera no puede ser negativa.";
  }
  if (cantidad * MINUTOS_POR_UNIDAD[unidadDelDraft(draft)] > MAX_DELAY_MINUTES) {
    return "La espera no puede superar los 30 días.";
  }
  return null;
}

// ---------------------------------------------------------------------------
// El mensaje de WhatsApp de las reglas que mandan uno (el QR y el cupón):
// formato y texto. La plantilla de Meta NO se configura aparte: el backend la
// arma al guardar la regla (automationWhatsapp.service.ts). Espejo de
// src/services/automationActions/mensajeDeWhatsapp.ts.
// ---------------------------------------------------------------------------

export const FORMATOS_DE_MENSAJE: ReadonlyArray<{
  value: WhatsappFormat;
  label: string;
  subtitle: string;
}> = [
  { value: "LINK", label: "Solo link", subtitle: "El link va en el texto del mensaje" },
  { value: "IMAGE", label: "Solo imagen", subtitle: "La imagen del QR arriba del texto, sin link" },
  {
    value: "LINK_AND_IMAGE",
    label: "Imagen y link",
    subtitle: "La imagen del QR arriba y el link en el texto",
  },
];

export function formatoLlevaLink(formato: string): boolean {
  return formato !== "IMAGE";
}

export function formatoLlevaImagen(formato: string): boolean {
  return formato === "IMAGE" || formato === "LINK_AND_IMAGE";
}

// El texto con el que arranca una regla nueva, con y sin link. Los "con link"
// son los que ya ofrecía la pantalla de plantillas (ítem 160).
const TEXTO_INICIAL: Record<string, { conLink: string; sinLink: string }> = {
  [ACTION_SEND_QR_FOLLOWUP]: {
    conLink:
      "Hola {nombre}, gracias por tu compra. Nos ayudaría mucho conocer tu opinión sobre la atención que recibiste. Podés dejarla en este enlace: {link} ¡Muchas gracias!",
    sinLink:
      "Hola {nombre}, gracias por tu compra. Nos ayudaría mucho conocer tu opinión sobre la atención que recibiste: escaneá este QR para dejarla. ¡Muchas gracias!",
  },
  [ACTION_SEND_DISCOUNT_VOUCHER]: {
    conLink:
      "Hola {nombre}, gracias por tu compra. Te regalamos un cupón de descuento para tu próxima visita. Lo encontrás en este enlace: {link} ¡Te esperamos!",
    sinLink:
      "Hola {nombre}, gracias por tu compra. Te regalamos un cupón de descuento para tu próxima visita: mostrá este QR en el local para usarlo. ¡Te esperamos!",
  },
};

// El del seguimiento de una consulta (ítem 185), espejo de TEXTO_POR_DEFECTO
// de src/services/automationActions/inquiryFollowUp.ts. Sin formato ni link.
export const TEXTO_INICIAL_DE_CONSULTA =
  "¡{saludo}! Te escribimos por tu consulta sobre {vehiculo}. ¿Seguís interesado? Si querés, te ayudamos a coordinar una visita o un test drive.";

// R15 (docs/rubros.md §9.1): el de una clínica, espejo de
// TEXTO_POR_DEFECTO_DE_CLINICA de src/clinicas/seguimientoDeConsultas.ts.
export const TEXTO_INICIAL_DE_CONSULTA_DE_CLINICA =
  "¡{saludo}! Te escribimos por tu consulta sobre {prestacion}. ¿Querés que te ayudemos a coordinar un turno?";

export function textoInicial(actionType: string, formato: string, esClinica = false): string {
  if (actionType === ACTION_INQUIRY_FOLLOW_UP) {
    return esClinica ? TEXTO_INICIAL_DE_CONSULTA_DE_CLINICA : TEXTO_INICIAL_DE_CONSULTA;
  }
  const textos = TEXTO_INICIAL[actionType];
  if (!textos) return "";
  return formatoLlevaLink(formato) ? textos.conLink : textos.sinLink;
}

// ---------------------------------------------------------------------------
// Qué variables lleva el mensaje de cada acción, para la tarjeta del mensaje
// (MensajeDeWhatsappCard): el QR y el cupón, {nombre} y {link} según el
// formato; el seguimiento de una consulta, {saludo} y {vehiculo}, sin formato
// (es solo texto). Espejo de variablesDeLaAccion en
// src/services/whatsappTemplate.service.ts.
// ---------------------------------------------------------------------------
export interface VariableDelMensaje {
  token: string;
  // Lo que se le dice al negocio que va ahí.
  ayuda: string;
  obligatoria: boolean;
}

export interface MensajeDeLaAccion {
  // Si la regla elige entre solo link, solo imagen o las dos.
  conFormato: boolean;
  variables: VariableDelMensaje[];
}

export function mensajeDeLaAccion(
  actionType: string,
  formato: string,
  esClinica = false,
): MensajeDeLaAccion {
  if (actionType === ACTION_INQUIRY_FOLLOW_UP) {
    return {
      conFormato: false,
      variables: [
        {
          token: TOKEN_SALUDO,
          ayuda: esClinica
            ? "el saludo con el nombre del paciente («Hola Ana»), o «Hola» a secas si no lo dio"
            : "el saludo con el nombre del cliente («Hola Ana»), o «Hola» a secas si no lo dio",
          obligatoria: true,
        },
        // R15: en una clínica, la prestación en lugar del vehículo.
        esClinica
          ? {
              token: TOKEN_PRESTACION,
              ayuda: "la prestación que consultó, o «lo que consultaste» si no se sabe",
              obligatoria: false,
            }
          : {
              token: TOKEN_VEHICULO,
              ayuda: "el vehículo que consultó, o «el vehículo que consultaste» si no se sabe",
              obligatoria: false,
            },
      ],
    };
  }
  return {
    conFormato: true,
    variables: [
      { token: TOKEN_NOMBRE, ayuda: "el nombre del cliente", obligatoria: true },
      ...(formatoLlevaLink(formato)
        ? [{ token: TOKEN_LINK, ayuda: "el link, después del nombre", obligatoria: true }]
        : []),
    ],
  };
}

// Al cambiar de formato: si el texto sigue siendo uno de los iniciales (o está
// vacío), pasa al que corresponde, con o sin link; si el negocio lo escribió,
// no se toca.
export function textoParaFormato(actionType: string, texto: string, formato: string): string {
  const textos = TEXTO_INICIAL[actionType];
  if (textos && (texto === textos.conLink || texto === textos.sinLink || texto.trim() === "")) {
    return textoInicial(actionType, formato);
  }
  return texto;
}

function contar(texto: string, token: string): number {
  return texto.split(token).length - 1;
}

// Lo que se ve antes de mandar. El resto de las reglas de Meta (que no empiece
// ni termine con una variable, el largo) las valida el backend con su 400.
export function validarMensaje(draft: ConfigDraft): string | null {
  const texto = (draft.messageText ?? "").trim();
  const conLink = formatoLlevaLink(draft.whatsappFormat ?? "LINK");
  if (texto === "") return "Escribí el texto del mensaje de WhatsApp.";
  if (contar(texto, TOKEN_NOMBRE) !== 1) {
    return `El mensaje tiene que incluir ${TOKEN_NOMBRE} una vez: ahí va el nombre del cliente.`;
  }
  if (conLink && contar(texto, TOKEN_LINK) !== 1) {
    return `El mensaje tiene que incluir ${TOKEN_LINK} una vez: ahí va el link.`;
  }
  if (!conLink && contar(texto, TOKEN_LINK) > 0) {
    return `Con "Solo imagen" el link no va en el texto: sacá ${TOKEN_LINK}.`;
  }
  if (conLink && texto.indexOf(TOKEN_NOMBRE) > texto.indexOf(TOKEN_LINK)) {
    return `${TOKEN_NOMBRE} tiene que ir antes que ${TOKEN_LINK}.`;
  }
  return null;
}

// El mensaje del seguimiento de una consulta (ítem 185): {saludo} una vez,
// {vehiculo} a lo sumo una, en ese orden, y ninguna otra variable. El resto
// de las reglas de Meta (no empezar ni terminar con una variable, el largo)
// las valida el backend con su 400.
// R15: en una clínica la segunda variable es {prestacion} y no {vehiculo}.
export function validarMensajeDeConsulta(draft: ConfigDraft, esClinica = false): string | null {
  const texto = (draft.messageText ?? "").trim();
  const interes = esClinica ? TOKEN_PRESTACION : TOKEN_VEHICULO;
  const ajeno = esClinica ? TOKEN_VEHICULO : TOKEN_PRESTACION;
  if (texto === "") return "Escribí el texto del mensaje de WhatsApp.";
  if (contar(texto, TOKEN_SALUDO) !== 1) {
    return `El mensaje tiene que incluir ${TOKEN_SALUDO} una vez: ahí va el saludo con el nombre del ${esClinica ? "paciente" : "cliente"}, o «Hola» si no lo dio.`;
  }
  if (contar(texto, interes) > 1) {
    return `El mensaje no puede incluir ${interes} más de una vez.`;
  }
  if (
    contar(texto, TOKEN_NOMBRE) > 0 ||
    contar(texto, TOKEN_LINK) > 0 ||
    contar(texto, ajeno) > 0
  ) {
    return `En este mensaje solo valen ${TOKEN_SALUDO} y ${interes}.`;
  }
  if (texto.includes(interes) && texto.indexOf(TOKEN_SALUDO) > texto.indexOf(interes)) {
    return `${TOKEN_SALUDO} tiene que ir antes que ${interes}.`;
  }
  return null;
}

const configDeSeguimientoDeConsulta: ConfigDeAccion = {
  draftVacio: (esClinica = false) => ({
    messageText: esClinica ? TEXTO_INICIAL_DE_CONSULTA_DE_CLINICA : TEXTO_INICIAL_DE_CONSULTA,
  }),
  draftDesde: (config) => ({
    messageText: typeof config.messageText === "string" ? config.messageText : "",
  }),
  validar: validarMensajeDeConsulta,
  aPayload: (draft) => ({ messageText: (draft.messageText ?? "").trim() }),
};

function mensajeVacio(actionType: string): ConfigDraft {
  return { whatsappFormat: "LINK", messageText: textoInicial(actionType, "LINK") };
}

// Una regla guardada antes del formato elegible no trae ninguno de los dos:
// es "solo link", y el texto lo completa el formulario con el de su plantilla
// aprobada (AutomationFormPage).
function mensajeDesde(config: Record<string, unknown>): ConfigDraft {
  return {
    whatsappFormat: typeof config.whatsappFormat === "string" ? config.whatsappFormat : "LINK",
    messageText: typeof config.messageText === "string" ? config.messageText : "",
  };
}

function mensajeAPayload(draft: ConfigDraft): Record<string, unknown> {
  return { whatsappFormat: draft.whatsappFormat, messageText: (draft.messageText ?? "").trim() };
}

const configDeSeguimientoQr: ConfigDeAccion = {
  draftVacio: () => ({
    qrCodeId: "",
    ...demoraVacia(),
    ...mensajeVacio(ACTION_SEND_QR_FOLLOWUP),
  }),

  draftDesde: (config) => ({
    qrCodeId: typeof config.qrCodeId === "string" ? config.qrCodeId : "",
    ...demoraDesde(config),
    ...mensajeDesde(config),
  }),

  validar: (draft) => {
    if ((draft.qrCodeId ?? "") === "") {
      return "Elegí el QR que se le va a mandar al cliente.";
    }
    return validarDemoraDelDraft(draft) ?? validarMensaje(draft);
  },

  aPayload: (draft) => ({
    qrCodeId: draft.qrCodeId,
    ...demoraAPayload(draft),
    ...mensajeAPayload(draft),
  }),
};

// Los topes de configDeCuponSchema
// (src/services/automationActions/sendDiscountVoucherFollowup.ts).
export const MAX_VOUCHER_LABEL = 200;
export const MIN_EXPIRES_IN_DAYS = 1;
export const MAX_EXPIRES_IN_DAYS = 365;

const configDeCupon: ConfigDeAccion = {
  draftVacio: () => ({
    label: "",
    ...demoraVacia(),
    expiresInDays: "",
    branchId: "",
    ...mensajeVacio(ACTION_SEND_DISCOUNT_VOUCHER),
  }),

  draftDesde: (config) => ({
    label: typeof config.label === "string" ? config.label : "",
    ...demoraDesde(config),
    expiresInDays: typeof config.expiresInDays === "number" ? String(config.expiresInDays) : "",
    branchId: typeof config.branchId === "string" ? config.branchId : "",
    ...mensajeDesde(config),
  }),

  validar: (draft) => {
    const label = (draft.label ?? "").trim();
    if (label === "") {
      return "Escribí qué descuento es (lo ve el cliente en su cupón).";
    }
    if (label.length > MAX_VOUCHER_LABEL) {
      return `El descuento no puede superar los ${MAX_VOUCHER_LABEL} caracteres.`;
    }
    if ((draft.branchId ?? "") === "") {
      return "Elegí la sucursal desde cuyo WhatsApp sale el cupón.";
    }
    const errorDeDemora = validarDemoraDelDraft(draft);
    if (errorDeDemora) return errorDeDemora;
    const textoDias = (draft.expiresInDays ?? "").trim();
    const dias = Number(textoDias);
    if (
      textoDias === "" ||
      !Number.isInteger(dias) ||
      dias < MIN_EXPIRES_IN_DAYS ||
      dias > MAX_EXPIRES_IN_DAYS
    ) {
      return `El cupón tiene que vencer en un número entero de días, entre ${MIN_EXPIRES_IN_DAYS} y ${MAX_EXPIRES_IN_DAYS}.`;
    }
    return validarMensaje(draft);
  },

  aPayload: (draft) => ({
    label: draft.label.trim(),
    ...demoraAPayload(draft),
    expiresInDays: Number(draft.expiresInDays),
    branchId: draft.branchId,
    ...mensajeAPayload(draft),
  }),
};

// La config de las acciones y de los triggers que NO tienen ningún campo: el
// borrador es vacío, siempre es válido, y lo que viaja es "{}". Existe igual
// —en vez de que el formulario trate "sin entrada" como "sin campos"— para
// que una entrada ausente siga significando "este espejo no sabe configurar
// esto", que es otra cosa.
const configVacia: ConfigDeAccion = {
  draftVacio: () => ({}),
  draftDesde: () => ({}),
  validar: () => null,
  aPayload: () => ({}),
};

export const CONFIG_DE_ACCION: Record<string, ConfigDeAccion> = {
  [ACTION_CREATE_FOLLOW_UP]: configDeSeguimiento,
  // agent.draft_follow_up no tiene config propia: su único parámetro —cuántos
  // días sin movimiento— es del trigger (ítem 76).
  [ACTION_DRAFT_FOLLOW_UP]: configVacia,
  [ACTION_SEND_QR_FOLLOWUP]: configDeSeguimientoQr,
  [ACTION_SEND_DISCOUNT_VOUCHER]: configDeCupon,
  [ACTION_INQUIRY_FOLLOW_UP]: configDeSeguimientoDeConsulta,
};

// Las acciones que mandan un WhatsApp con plantilla: su formulario muestra el
// texto, la vista previa y el estado de aprobación (y el formato, en las que
// llevan imagen).
export function accionConMensajeDeWhatsapp(actionType: string): boolean {
  return (
    actionType === ACTION_SEND_QR_FOLLOWUP ||
    actionType === ACTION_SEND_DISCOUNT_VOUCHER ||
    actionType === ACTION_INQUIRY_FOLLOW_UP
  );
}

// ---------------------------------------------------------------------------
// La configuración de cada trigger (Automation.triggerConfig, ítem 76)
//
// La MISMA forma que la de las acciones —borrador en strings, validar,
// aPayload— porque es el mismo problema: un JSON cuya forma decide el backend
// con un schema zod, editado desde inputs que producen texto.
// ---------------------------------------------------------------------------

export type ConfigDeTrigger = ConfigDeAccion;

// Los topes de configDeOportunidadEstancadaSchema
// (src/services/automationTriggers.ts).
export const MIN_DAYS_WITHOUT_ACTIVITY = 0;
export const MAX_DAYS_WITHOUT_ACTIVITY = 365;

const configDeEstancada: ConfigDeTrigger = {
  draftVacio: () => ({ daysWithoutActivity: "" }),

  draftDesde: (config) => ({
    daysWithoutActivity:
      typeof config.daysWithoutActivity === "number" ? String(config.daysWithoutActivity) : "",
  }),

  // Mismo criterio que daysUntilDue de la acción de seguimiento: el vacío se
  // valida antes (Number("") es 0) y después se exige entero y en rango.
  validar: (draft) => {
    const texto = (draft.daysWithoutActivity ?? "").trim();
    if (texto === "") {
      return "Indicá cuántos días sin movimiento tiene que llevar la oportunidad.";
    }
    const dias = Number(texto);
    if (!Number.isInteger(dias)) {
      return "Los días sin movimiento tienen que ser un número entero.";
    }
    if (dias < MIN_DAYS_WITHOUT_ACTIVITY || dias > MAX_DAYS_WITHOUT_ACTIVITY) {
      return `Los días sin movimiento tienen que estar entre ${MIN_DAYS_WITHOUT_ACTIVITY} y ${MAX_DAYS_WITHOUT_ACTIVITY}.`;
    }
    return null;
  },

  aPayload: (draft) => ({ daysWithoutActivity: Number(draft.daysWithoutActivity) }),
};

// Los topes y defaults de configDeConsultaSinAvanceSchema
// (src/services/automationTriggers.ts).
export const MIN_DAYS_SINCE_LAST_MESSAGE = 0;
export const MAX_DAYS_SINCE_LAST_MESSAGE = 365;
export const DEFAULT_DAYS_SINCE_LAST_MESSAGE = 3;
export const MIN_FOLLOW_UPS = 1;
export const MAX_FOLLOW_UPS = 20;
export const DEFAULT_MAX_FOLLOW_UPS = 1;

const configDeConsultaSinAvance: ConfigDeTrigger = {
  draftVacio: () => ({
    daysSinceLastMessage: String(DEFAULT_DAYS_SINCE_LAST_MESSAGE),
    maxFollowUps: String(DEFAULT_MAX_FOLLOW_UPS),
  }),

  draftDesde: (config) => ({
    daysSinceLastMessage:
      typeof config.daysSinceLastMessage === "number"
        ? String(config.daysSinceLastMessage)
        : String(DEFAULT_DAYS_SINCE_LAST_MESSAGE),
    maxFollowUps:
      typeof config.maxFollowUps === "number"
        ? String(config.maxFollowUps)
        : String(DEFAULT_MAX_FOLLOW_UPS),
  }),

  validar: (draft) => {
    const dias = Number((draft.daysSinceLastMessage ?? "").trim());
    if (
      (draft.daysSinceLastMessage ?? "").trim() === "" ||
      !Number.isInteger(dias) ||
      dias < MIN_DAYS_SINCE_LAST_MESSAGE ||
      dias > MAX_DAYS_SINCE_LAST_MESSAGE
    ) {
      return `Los días sin respuesta tienen que ser un número entero entre ${MIN_DAYS_SINCE_LAST_MESSAGE} y ${MAX_DAYS_SINCE_LAST_MESSAGE}.`;
    }
    const max = Number((draft.maxFollowUps ?? "").trim());
    if (
      (draft.maxFollowUps ?? "").trim() === "" ||
      !Number.isInteger(max) ||
      max < MIN_FOLLOW_UPS ||
      max > MAX_FOLLOW_UPS
    ) {
      return `La cantidad máxima de seguimientos tiene que ser un número entero entre ${MIN_FOLLOW_UPS} y ${MAX_FOLLOW_UPS}.`;
    }
    return null;
  },

  aPayload: (draft) => ({
    daysSinceLastMessage: Number(draft.daysSinceLastMessage),
    maxFollowUps: Number(draft.maxFollowUps),
  }),
};

export const CONFIG_DE_TRIGGER: Record<string, ConfigDeTrigger> = {
  [TRIGGER_OPPORTUNITY_WON]: configVacia,
  [TRIGGER_OPPORTUNITY_STALE]: configDeEstancada,
  [TRIGGER_CONTACT_INQUIRY_STALLED]: configDeConsultaSinAvance,
};

// El default del formulario: la PRIMERA entrada de cada catálogo, no un valor
// escrito a mano —mismo criterio que el proveedor de modelo en AgentFormPage—.
// La acción por defecto es la primera que ADMITE el trigger por defecto, para
// que una regla nueva arranque siempre en una combinación válida.
export const DEFAULT_TRIGGER = TRIGGER_OPTIONS[0].value;
export const DEFAULT_ACTION = accionesParaTrigger(DEFAULT_TRIGGER)[0].value;

// El rótulo y el color de cada estado de la revisión de Meta. Los usan el
// formulario (MensajeDeWhatsappCard) y la lista de automatizaciones.
export const ESTADOS_DE_APROBACION: Record<
  WhatsappApproval["estado"],
  { label: string; variant: BadgeVariant }
> = {
  SIN_PLANTILLA: { label: "Sin enviar", variant: "neutral" },
  PENDIENTE: { label: "Pendiente", variant: "info" },
  APROBADA: { label: "Aprobada", variant: "success" },
  RECHAZADA: { label: "Rechazada", variant: "danger" },
};
