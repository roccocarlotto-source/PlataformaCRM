import type { SelectOption } from "../../design-system/Select";

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
// HOY HAY UN TRIGGER Y UNA ACCIÓN, y eso no es una limitación de diseño: los
// otros dos casos reales —recordatorio de turno por WhatsApp, envío del QR de
// reseña— están bloqueados por trámites externos a este repo
// (docs/automations-architecture.md §1-2). El motor se construyó genérico
// igual; esta pantalla también.
//
// AGREGAR UN TRIGGER es agregar una entrada a TRIGGER_OPTIONS y nada más.
// AGREGAR UNA ACCIÓN es agregar una entrada a ACTION_OPTIONS, una a
// CONFIG_DE_ACCION (cómo se lee, se valida y se arma su actionConfig) y un
// `case` al switch de campos en AutomationFormPage — tres lugares, ninguno de
// ellos una reescritura del formulario.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Triggers
// ---------------------------------------------------------------------------

// Espejo de TRIGGER_OPPORTUNITY_WON.
export const TRIGGER_OPPORTUNITY_WON = "opportunity.won";

export const TRIGGER_OPTIONS: SelectOption<string>[] = [
  {
    value: TRIGGER_OPPORTUNITY_WON,
    label: "Oportunidad ganada",
    subtitle: "Cuando una oportunidad pasa al estado Ganada",
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

// Espejo de ACTION_CREATE_FOLLOW_UP.
export const ACTION_CREATE_FOLLOW_UP = "activity.create_follow_up";

export const ACTION_OPTIONS: SelectOption<string>[] = [
  {
    value: ACTION_CREATE_FOLLOW_UP,
    label: "Crear actividad de seguimiento",
    subtitle: "Una tarea para el dueño de la oportunidad",
  },
];

export function actionLabel(value: string): string {
  return ACTION_OPTIONS.find((option) => option.value === value)?.label ?? value;
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

export const CONFIG_DE_ACCION: Record<string, ConfigDeAccion> = {
  [ACTION_CREATE_FOLLOW_UP]: configDeSeguimiento,
};

// El default del formulario: con una sola acción viene elegida, igual que el
// proveedor de modelo en AgentFormPage. Con dos o más, esto sigue siendo "la
// primera del catálogo" y no hay que tocar el formulario.
export const DEFAULT_TRIGGER = TRIGGER_OPTIONS[0].value;
export const DEFAULT_ACTION = ACTION_OPTIONS[0].value;
