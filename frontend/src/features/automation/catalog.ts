import type { SelectOption } from "../../design-system/Select";
import type { WhatsappFormat } from "./types";
import { TOKEN_LINK, TOKEN_NOMBRE } from "./whatsappPreview";

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

// Espejo de TRIGGER_OPPORTUNITY_WON y TRIGGER_OPPORTUNITY_STALE.
export const TRIGGER_OPPORTUNITY_WON = "opportunity.won";
export const TRIGGER_OPPORTUNITY_STALE = "opportunity.stale";

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
];

// El rótulo de un trigger en el listado. Un valor fuera de la lista —un
// trigger que el backend ya conoce y este espejo todavía no— se muestra crudo
// en vez de como "—": el dato real informa más que su ausencia, mismo criterio
// que modelProviderLabel en features/agent/labels.ts.
export function triggerLabel(value: string): string {
  return TRIGGER_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

// ---------------------------------------------------------------------------
// Acciones
// ---------------------------------------------------------------------------

// Espejo de ACTION_CREATE_FOLLOW_UP, ACTION_DRAFT_FOLLOW_UP,
// ACTION_SEND_QR_FOLLOWUP y ACTION_SEND_DISCOUNT_VOUCHER.
export const ACTION_CREATE_FOLLOW_UP = "activity.create_follow_up";
export const ACTION_DRAFT_FOLLOW_UP = "agent.draft_follow_up";
export const ACTION_SEND_QR_FOLLOWUP = "opportunity.send_qr_followup";
export const ACTION_SEND_DISCOUNT_VOUCHER = "opportunity.send_discount_voucher";

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
  // El borrador de una regla nueva con esta acción.
  draftVacio: () => ConfigDraft;
  // El borrador a partir del actionConfig que devolvió el backend.
  draftDesde: (config: Record<string, unknown>) => ConfigDraft;
  // El error de validación del cliente, o null si puede viajar. Duplica a
  // propósito lo que el backend ya valida: no para reemplazarlo —quien manda
  // sigue siendo el 400— sino para que el rango se vea ANTES de mandar, con
  // el mensaje en el idioma de la pantalla.
  validar: (draft: ConfigDraft) => string | null;
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

// Los topes de configDeSeguimientoQrSchema
// (src/services/automationActions/sendQrFollowup.ts): de 0 horas —apenas se
// gana— a 30 días.
export const MIN_DELAY_HOURS = 0;
export const MAX_DELAY_HOURS = 720;

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

export function textoInicial(actionType: string, formato: string): string {
  const textos = TEXTO_INICIAL[actionType];
  if (!textos) return "";
  return formatoLlevaLink(formato) ? textos.conLink : textos.sinLink;
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

// Mismo criterio que daysUntilDue: el vacío se valida antes (Number("") es 0)
// y después se exige entero y en rango.
function validarHoras(draft: ConfigDraft): string | null {
  const texto = (draft.delayHours ?? "").trim();
  if (texto === "") {
    return "Indicá cuántas horas esperar antes de mandar el WhatsApp.";
  }
  const horas = Number(texto);
  if (!Number.isInteger(horas)) {
    return "Las horas de espera tienen que ser un número entero.";
  }
  if (horas < MIN_DELAY_HOURS || horas > MAX_DELAY_HOURS) {
    return `Las horas de espera tienen que estar entre ${MIN_DELAY_HOURS} y ${MAX_DELAY_HOURS}.`;
  }
  return null;
}

const configDeSeguimientoQr: ConfigDeAccion = {
  draftVacio: () => ({
    qrCodeId: "",
    delayHours: "",
    ...mensajeVacio(ACTION_SEND_QR_FOLLOWUP),
  }),

  draftDesde: (config) => ({
    qrCodeId: typeof config.qrCodeId === "string" ? config.qrCodeId : "",
    delayHours: typeof config.delayHours === "number" ? String(config.delayHours) : "",
    ...mensajeDesde(config),
  }),

  validar: (draft) => {
    if ((draft.qrCodeId ?? "") === "") {
      return "Elegí el QR que se le va a mandar al cliente.";
    }
    return validarHoras(draft) ?? validarMensaje(draft);
  },

  aPayload: (draft) => ({
    qrCodeId: draft.qrCodeId,
    delayHours: Number(draft.delayHours),
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
    delayHours: "",
    expiresInDays: "",
    branchId: "",
    ...mensajeVacio(ACTION_SEND_DISCOUNT_VOUCHER),
  }),

  draftDesde: (config) => ({
    label: typeof config.label === "string" ? config.label : "",
    delayHours: typeof config.delayHours === "number" ? String(config.delayHours) : "",
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
    const errorDeHoras = validarHoras(draft);
    if (errorDeHoras) return errorDeHoras;
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
    delayHours: Number(draft.delayHours),
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
};

// Las acciones que mandan un WhatsApp con plantilla: su formulario muestra el
// formato, el texto, la vista previa y el estado de aprobación.
export function accionConMensajeDeWhatsapp(actionType: string): boolean {
  return actionType === ACTION_SEND_QR_FOLLOWUP || actionType === ACTION_SEND_DISCOUNT_VOUCHER;
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

export const CONFIG_DE_TRIGGER: Record<string, ConfigDeTrigger> = {
  [TRIGGER_OPPORTUNITY_WON]: configVacia,
  [TRIGGER_OPPORTUNITY_STALE]: configDeEstancada,
};

// El default del formulario: la PRIMERA entrada de cada catálogo, no un valor
// escrito a mano —mismo criterio que el proveedor de modelo en AgentFormPage—.
// La acción por defecto es la primera que ADMITE el trigger por defecto, para
// que una regla nueva arranque siempre en una combinación válida.
export const DEFAULT_TRIGGER = TRIGGER_OPTIONS[0].value;
export const DEFAULT_ACTION = accionesParaTrigger(DEFAULT_TRIGGER)[0].value;
