import { z } from "zod";
import type { Modulo } from "../config/ediciones";
import { TRIGGER_BOOKING_REMINDER_DUE as TRIGGER_DEL_RECORDATORIO } from "../clinicas/recordatorios/config";
import {
  OFFSET_MAXIMO,
  OFFSET_MINIMO,
  TRIGGER_NEXT_SERVICE_DUE as TRIGGER_DEL_PROXIMO_SERVICE,
} from "../servicios/recordatorio/config";
import {
  TRIGGER_ORDEN_CAMBIA_DE_ESTADO,
  TRIGGER_ORDEN_ENTREGADA,
  configDelCambioDeEstadoSchema,
  laReglaCorreConElCambio,
} from "../servicios/eventosDeLaOrden/config";
import { TRIGGER_RECAMBIO, configDelRecambioSchema } from "../servicios/recambio/config";

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
// Consulta sin avance (ítem 185): un contacto que escribió y lleva X días
// callado, sin oportunidad abierta y sin la marca "sin interés". Un ESTADO,
// como opportunity.stale: lo produce el barrido diario de
// src/workers/inquiryStalledWorker.ts.
export const TRIGGER_CONTACT_INQUIRY_STALLED = "contact.inquiry_stalled";
// R13 (docs/rubros.md §6 y §7.3): "Recordatorio antes del turno", solo en
// clínicas (MODULO_DEL_TRIGGER). Nadie lo emite como evento: la regla guarda
// la plantilla y si está activa; el recordatorio lo agenda el consumidor de
// booking.created / booking.rescheduled (src/clinicas/recordatorios).
export const TRIGGER_BOOKING_REMINDER_DUE = TRIGGER_DEL_RECORDATORIO;
// R14 (docs/rubros.md §7): "Cuando se atiende un turno", solo en clínicas.
// Lo emite R10 al marcar Atendido (o al cerrar solo a las 3 h).
export const TRIGGER_BOOKING_COMPLETED = "booking.completed";
// S7 (docs/servicios.md §6.2): "Cuando se acerca o vence el próximo service",
// solo con el módulo Servicios. Un ESTADO, como opportunity.stale: lo produce
// el barrido diario de src/servicios/recordatorio/barrido.ts, un evento por
// (regla, vehículo, fecha).
export const TRIGGER_SERVICE_NEXT_SERVICE_DUE = TRIGGER_DEL_PROXIMO_SERVICE;
// S8 (docs/servicios.md §9): "Cuando una orden de servicio cambia de estado" y
// "Cuando se entrega una orden de servicio", solo con el módulo Servicios. Dos
// CAMBIOS, como opportunity.won: los emite el alta y el cambio de estado de la
// orden (src/servicios/services/ordenes.service.ts) en su transacción.
export const TRIGGER_SERVICE_ORDER_STATUS_CHANGED = TRIGGER_ORDEN_CAMBIA_DE_ESTADO;
export const TRIGGER_SERVICE_ORDER_DELIVERED = TRIGGER_ORDEN_ENTREGADA;
// S13 (docs/servicios.md §7): "Cuando se acerca el recambio de un vehículo",
// solo con el módulo Servicios. Un ESTADO: lo produce la misma pasada horaria
// del próximo service (src/servicios/recambio/barrido.ts).
export const TRIGGER_SERVICE_REPLACEMENT_DUE = TRIGGER_RECAMBIO;

export const TRIGGERS_CONOCIDOS = [
  TRIGGER_OPPORTUNITY_WON,
  TRIGGER_OPPORTUNITY_STALE,
  TRIGGER_CONTACT_INQUIRY_STALLED,
  TRIGGER_BOOKING_REMINDER_DUE,
  TRIGGER_BOOKING_COMPLETED,
  TRIGGER_SERVICE_NEXT_SERVICE_DUE,
  TRIGGER_SERVICE_ORDER_STATUS_CHANGED,
  TRIGGER_SERVICE_ORDER_DELIVERED,
  TRIGGER_SERVICE_REPLACEMENT_DUE,
] as const;

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

// Consulta sin avance (ítem 185). Los dos con default, a diferencia de los
// otros triggers: son los valores que Rocco fijó para el caso típico (3 días
// y un solo seguimiento), y una regla creada por API sin config tiene que
// hacer lo razonable. El 0 vale para probarla a mano; el tope de 365 es de
// cordura. maxFollowUps cuenta los seguimientos posteriores al último mensaje
// del cliente (ver findStalledInquiries).
export const DIAS_SIN_RESPUESTA_POR_DEFECTO = 3;
export const MAX_SEGUIMIENTOS_POR_DEFECTO = 1;
export const MAX_SEGUIMIENTOS_TOPE = 20;

export const configDeConsultaSinAvanceSchema = z.object({
  daysSinceLastMessage: z
    .number({ invalid_type_error: "daysSinceLastMessage debe ser un número entero" })
    .int("daysSinceLastMessage debe ser un número entero")
    .min(0, "daysSinceLastMessage no puede ser negativo")
    .max(365, "daysSinceLastMessage no puede superar los 365 días")
    .default(DIAS_SIN_RESPUESTA_POR_DEFECTO),
  maxFollowUps: z
    .number({ invalid_type_error: "maxFollowUps debe ser un número entero" })
    .int("maxFollowUps debe ser un número entero")
    .min(1, "maxFollowUps tiene que ser al menos 1")
    .max(MAX_SEGUIMIENTOS_TOPE, `maxFollowUps no puede superar ${String(MAX_SEGUIMIENTOS_TOPE)}`)
    .default(MAX_SEGUIMIENTOS_POR_DEFECTO),
});

export type ConfigDeConsultaSinAvance = z.infer<typeof configDeConsultaSinAvanceSchema>;

// S7: cuántos días antes (negativo) o después (positivo) de la fecha del
// service sale el aviso. Sin default: es lo que define la regla. Puede haber
// varias reglas (una semana antes y 15 días después de vencido).
export const configDelProximoServiceSchema = z.object({
  offsetDays: z
    .number({
      required_error: "offsetDays es requerido",
      invalid_type_error: "offsetDays debe ser un número entero",
    })
    .int("offsetDays debe ser un número entero")
    .min(OFFSET_MINIMO, `offsetDays no puede ser menor que ${String(OFFSET_MINIMO)}`)
    .max(OFFSET_MAXIMO, `offsetDays no puede superar ${String(OFFSET_MAXIMO)}`),
});

export type ConfigDelProximoService = z.infer<typeof configDelProximoServiceSchema>;

export type EsquemaDeTrigger = z.ZodType<Record<string, unknown>, z.ZodTypeDef, unknown>;

// Un Record sobre TriggerType y no un Map: si alguien suma un trigger a
// TRIGGERS_CONOCIDOS sin su schema, esto deja de compilar.
export const CONFIG_DE_TRIGGER: Record<TriggerType, EsquemaDeTrigger> = {
  [TRIGGER_OPPORTUNITY_WON]: configDeOportunidadGanadaSchema,
  [TRIGGER_OPPORTUNITY_STALE]: configDeOportunidadEstancadaSchema,
  [TRIGGER_CONTACT_INQUIRY_STALLED]: configDeConsultaSinAvanceSchema,
  // R13: sin configuración propia (las horas son de la sede).
  [TRIGGER_BOOKING_REMINDER_DUE]: z.object({}),
  // R14: sin configuración propia (la demora es de cada acción).
  [TRIGGER_BOOKING_COMPLETED]: z.object({}),
  [TRIGGER_SERVICE_NEXT_SERVICE_DUE]: configDelProximoServiceSchema,
  // S8: a qué estados (toStatuses). La entrega no tiene nada que configurar.
  [TRIGGER_SERVICE_ORDER_STATUS_CHANGED]: configDelCambioDeEstadoSchema,
  [TRIGGER_SERVICE_ORDER_DELIVERED]: z.object({}),
  // S13: meses desde la compra y días antes (defaults 48 y 60).
  [TRIGGER_SERVICE_REPLACEMENT_DUE]: configDelRecambioSchema,
};

/** El módulo que necesita un trigger (R13). Sin entrada: lo tiene cualquiera
 *  que tenga el módulo de automatizaciones. */
export const MODULO_DEL_TRIGGER: Readonly<Partial<Record<TriggerType, Modulo>>> = {
  // docs/rubros.md §7.3: una clínica no tiene oportunidades (D3), así que
  // tampoco sus triggers. Las dos ediciones de una automotora tienen el
  // módulo: para ella no cambia nada.
  [TRIGGER_OPPORTUNITY_WON]: "oportunidades",
  [TRIGGER_OPPORTUNITY_STALE]: "oportunidades",
  [TRIGGER_BOOKING_REMINDER_DUE]: "recordatorios_de_turno",
  [TRIGGER_BOOKING_COMPLETED]: "post_turno",
  // S7: el taller (docs/servicios.md §1).
  [TRIGGER_SERVICE_NEXT_SERVICE_DUE]: "servicios",
  // S8.
  [TRIGGER_SERVICE_ORDER_STATUS_CHANGED]: "servicios",
  [TRIGGER_SERVICE_ORDER_DELIVERED]: "servicios",
  // S13.
  [TRIGGER_SERVICE_REPLACEMENT_DUE]: "servicios",
};

/** Los triggers que una organización puede usar con estos módulos: los que no
 *  piden módulo, más los de sus módulos. Pura: la usa el CRUD de reglas y la
 *  fija el test de "sin el módulo, sin cambios". */
export function triggersParaLosModulos(modulos: ReadonlySet<Modulo>): readonly TriggerType[] {
  return TRIGGERS_CONOCIDOS.filter((t) => {
    const modulo = MODULO_DEL_TRIGGER[t];
    return modulo === undefined || modulos.has(modulo);
  });
}

// ---------------------------------------------------------------------------
// Filtro de la regla (S8)
//
// Un trigger con condición POR REGLA sobre el evento: el dispatcher corre solo
// las reglas activas cuyo filtro da true. "Cambia de estado" la tiene (los
// estados destino de cada regla). Un trigger sin entrada corre todas sus reglas,
// como siempre: los de antes de S8 no tienen ninguna.
// ---------------------------------------------------------------------------
export const FILTRO_DE_LA_REGLA: Readonly<
  Partial<Record<TriggerType, (config: unknown, payload: unknown) => boolean>>
> = {
  [TRIGGER_SERVICE_ORDER_STATUS_CHANGED]: laReglaCorreConElCambio,
};

// ---------------------------------------------------------------------------
// Triggers DIRIGIDOS a una regla
//
// El evento lleva la regla que lo produjo (payload.automationId) y el
// dispatcher corre SOLO esa. Es lo que permite varias reglas del mismo trigger
// con condiciones distintas: el aviso de "7 días antes" no dispara la regla de
// "15 días después". Los demás triggers corren todas sus reglas, como siempre.
// ---------------------------------------------------------------------------
export const TRIGGERS_DIRIGIDOS_A_UNA_REGLA: readonly TriggerType[] = [
  TRIGGER_SERVICE_NEXT_SERVICE_DUE,
  // S13: el evento también lleva su regla.
  TRIGGER_SERVICE_REPLACEMENT_DUE,
];

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
// contact.inquiry_stalled también: el evento lleva un contacto y el barrido
// usa UN umbral de días y UN tope por organización, por lo mismo.
export const TRIGGERS_DE_REGLA_UNICA: readonly TriggerType[] = [
  TRIGGER_OPPORTUNITY_STALE,
  TRIGGER_CONTACT_INQUIRY_STALLED,
  // R13: una sola regla de recordatorio por organización.
  TRIGGER_BOOKING_REMINDER_DUE,
  // S13 (§7.2): el recambio es una política de la organización.
  TRIGGER_SERVICE_REPLACEMENT_DUE,
];
