import { z } from "zod";

// ---------------------------------------------------------------------------
// Catálogo de triggers del motor de automatizaciones
// (docs/automations-architecture.md §4).
//
// LISTA CERRADA EN CÓDIGO. Un trigger ES un eventType del outbox: coinciden
// 1:1 con el string que el productor pasa a emitOutboxEvent. No hay
// traducción intermedia ni tabla de mapeo — el CRUD de reglas valida
// Automation.triggerType contra esta lista, y el dispatcher se registra como
// handler del outbox para cada entrada (automationRegistrations.ts).
//
// Vive en su propio archivo, chico, para que opportunity.service.ts (que
// emite), el worker de oportunidades estancadas (que también emite) y
// automation.service.ts (que valida) puedan importar la constante sin
// arrastrar el dispatcher, el catálogo de acciones ni activity.service.
//
// AGREGAR UN TRIGGER son cuatro cosas, las cuatro en código: el string acá,
// el schema de su config en CONFIG_DE_TRIGGER, un PRODUCTOR que emita el
// evento, y el handler de despacho en automationRegistrations.ts (que se
// deriva solo de TRIGGERS_CONOCIDOS). Sin handler, el evento va a DEAD_LETTER
// directo por handler ausente — que es el comportamiento diseñado del outbox
// para un bug de configuración.
//
// DOS FORMAS DE PRODUCIR UN EVENTO, y los dos triggers de hoy son uno de cada:
//
//   - opportunity.won es un CAMBIO: opportunity.service.ts lo emite en la
//     misma transacción del UPDATE que lo causa, en el instante en que pasa.
//   - opportunity.stale es un ESTADO ("lleva N días sin movimiento"): nada lo
//     dispara, así que lo va a buscar un barrido diario
//     (src/workers/opportunityStaleWorker.ts). Ítem 76 de
//     docs/frontend-cambios-pendientes.md.
//
// El despacho no distingue una forma de la otra: los dos terminan en el mismo
// outbox y los atiende el mismo dispatcher.
// ---------------------------------------------------------------------------

export const TRIGGER_OPPORTUNITY_WON = "opportunity.won";
export const TRIGGER_OPPORTUNITY_STALE = "opportunity.stale";

export const TRIGGERS_CONOCIDOS = [TRIGGER_OPPORTUNITY_WON, TRIGGER_OPPORTUNITY_STALE] as const;

export type TriggerType = (typeof TRIGGERS_CONOCIDOS)[number];

export function esTriggerConocido(valor: string): valor is TriggerType {
  return (TRIGGERS_CONOCIDOS as readonly string[]).includes(valor);
}

// ---------------------------------------------------------------------------
// La configuración de cada trigger (Automation.triggerConfig)
//
// Mismo reparto que el actionConfig de las acciones: la columna es JSON sin
// forma, y la forma la declara el trigger acá, con un schema zod que el CRUD
// aplica ANTES de guardar — una regla mal configurada es un 400 al crearla,
// nunca un comportamiento raro del worker.
// ---------------------------------------------------------------------------

// opportunity.won no tiene nada que configurar. z.object({}) SIN .strict() a
// propósito: descarta las claves de más en vez de rechazarlas, así que una
// regla que se pasa de opportunity.stale a opportunity.won sin mandar un
// triggerConfig nuevo queda guardada con "{}" limpio y no con un
// daysWithoutActivity huérfano que ningún código lee.
export const configDeOportunidadGanadaSchema = z.object({});

// SIN DEFAULT OCULTO, mismo estilo que daysUntilDue de
// activity.create_follow_up: si falta, la regla no se crea. El 0 es válido
// —"estancada desde ya"— porque es lo que permite probar la regla a mano sin
// esperar días; el tope de 365 es de cordura, igual que el de daysUntilDue.
export const configDeOportunidadEstancadaSchema = z.object({
  daysWithoutActivity: z
    .number({
      required_error: "daysWithoutActivity es requerido",
      invalid_type_error: "daysWithoutActivity debe ser un número entero",
    })
    .int("daysWithoutActivity debe ser un número entero")
    .min(0, "daysWithoutActivity no puede ser negativo")
    .max(365, "daysWithoutActivity no puede superar los 365 días"),
});

export type ConfigDeOportunidadEstancada = z.infer<typeof configDeOportunidadEstancadaSchema>;

export type EsquemaDeTrigger = z.ZodType<Record<string, unknown>, z.ZodTypeDef, unknown>;

// Un Record sobre TriggerType y no un Map: si alguien suma un trigger a
// TRIGGERS_CONOCIDOS sin su schema, esto deja de compilar.
export const CONFIG_DE_TRIGGER: Record<TriggerType, EsquemaDeTrigger> = {
  [TRIGGER_OPPORTUNITY_WON]: configDeOportunidadGanadaSchema,
  [TRIGGER_OPPORTUNITY_STALE]: configDeOportunidadEstancadaSchema,
};

// ---------------------------------------------------------------------------
// Triggers con UNA SOLA regla activa por organización
//
// opportunity.stale lo es, y el motivo es de semántica, no de performance. El
// evento lleva una oportunidad, no una regla: el dispatcher corre TODAS las
// reglas activas del trigger para cada evento. Con dos reglas (3 días y 10
// días), la de 3 haría emitir el evento y la de 10 correría igual sobre una
// oportunidad que no lleva 10 días quieta — su número no significaría nada, y
// además saldrían dos borradores por cada estancamiento. Una regla por
// organización hace que daysWithoutActivity diga exactamente lo que dice.
// ---------------------------------------------------------------------------
export const TRIGGERS_DE_REGLA_UNICA: readonly TriggerType[] = [TRIGGER_OPPORTUNITY_STALE];
