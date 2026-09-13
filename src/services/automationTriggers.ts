// ---------------------------------------------------------------------------
// Catálogo de triggers del motor de automatizaciones
// (docs/automations-architecture.md §4).
//
// LISTA CERRADA EN CÓDIGO. Un trigger ES un eventType del outbox: coinciden
// 1:1 con el string que el service de negocio pasa a emitOutboxEvent. No hay
// traducción intermedia ni tabla de mapeo — el CRUD de reglas valida
// Automation.triggerType contra esta lista, y el dispatcher se registra como
// handler del outbox para cada entrada (automationRegistrations.ts).
//
// Vive en su propio archivo, chico, para que opportunity.service.ts (que
// emite) y automation.service.ts (que valida) puedan importar la constante
// sin arrastrar el dispatcher, el catálogo de acciones ni activity.service.
//
// AGREGAR UN TRIGGER son tres cosas, las tres en código: el string acá, la
// emisión del evento dentro de la transacción del cambio que lo origina, y el
// handler de despacho en automationRegistrations.ts. Sin lo tercero, el
// evento va a DEAD_LETTER directo por handler ausente — que es el
// comportamiento diseñado del outbox para un bug de configuración.
// ---------------------------------------------------------------------------

export const TRIGGER_OPPORTUNITY_WON = "opportunity.won";

export const TRIGGERS_CONOCIDOS = [TRIGGER_OPPORTUNITY_WON] as const;

export type TriggerType = (typeof TRIGGERS_CONOCIDOS)[number];

export function esTriggerConocido(valor: string): valor is TriggerType {
  return (TRIGGERS_CONOCIDOS as readonly string[]).includes(valor);
}
