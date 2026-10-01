import type { BadgeVariant } from "../../design-system/Badge";
import type { SelectOption } from "../../design-system/Select";
import type { ConversationStatus, MessageDeliveryStatus } from "./types";

// Rótulos del módulo de conversaciones, fuera de los componentes —mismo
// criterio que agent/labels.ts y opportunity/labels.ts— para que el listado y
// el detalle nombren cada valor igual sin importarse entre sí.
//
// LOS CANALES NO ESTÁN ACÁ: CHANNEL_OPTIONS/CHANNEL_LABEL ya existen en
// features/agent/labels.ts y se importan de ahí. Un segundo mapa de dos
// valores que pueda decir "WhatsApp" de una forma en una pantalla y de otra
// en la otra no le sirve a nadie.

// Estados del enum ConversationStatus. Son tres y están fijos en el schema:
// un estado nuevo es una migración.
//
// "Derivada a un humano" en vez de "Derivada" a secas: la palabra sola no
// dice a quién ni por qué, y lo que distingue a este estado es justamente que
// el agente dejó de responder y la conversación quedó en manos de una
// persona.
export const STATUS_OPTIONS: SelectOption<ConversationStatus>[] = [
  { value: "ACTIVE", label: "Activa" },
  { value: "TRANSFERRED_TO_HUMAN", label: "Derivada a un humano" },
  { value: "CLOSED", label: "Cerrada" },
];

// Derivado de la lista de arriba, no escrito de nuevo: un rótulo que cambie
// se cambia en un solo lugar. Mismo patrón que CHANNEL_LABEL.
export const STATUS_LABEL = Object.fromEntries(
  STATUS_OPTIONS.map((option) => [option.value, option.label]),
) as Record<ConversationStatus, string>;

// El color del Badge lo decide el feature, nunca el design system (ver el
// comentario de Badge.tsx).
//
// Derivada va en `info` y no en `danger`: que una conversación pase a una
// persona no es una falla, es el circuito previsto de §6 — y pintarla de rojo
// en una bandeja llena la leería como un problema a resolver. Cerrada es
// `neutral` por lo mismo: es el final normal, no una baja.
export const STATUS_BADGE_VARIANT: Record<ConversationStatus, BadgeVariant> = {
  ACTIVE: "success",
  TRANSFERRED_TO_HUMAN: "info",
  CLOSED: "neutral",
};

// Estado de entrega de un saliente (WA-1 de docs-privados/prueba-en-vivo-2026-09-29.md (local, no está en GitHub)),
// como texto chico al lado de la hora de la burbuja. PENDING es "enviando":
// el turno produjo la respuesta y el envío todavía no se confirmó.
export const DELIVERY_STATUS_LABEL: Record<MessageDeliveryStatus, string> = {
  PENDING: "Enviando",
  SENT: "Enviado",
  DELIVERED: "Entregado",
  READ: "Leído",
  FAILED: "No entregado",
};

// La marca de una conversación que se le devolvió al agente sin que nadie le
// respondiera al cliente (humanRequestUnanswered). En danger y no en info: a
// diferencia de "Derivada", esto sí es algo pendiente que alguien tiene que
// resolver. La misma en la bandeja y en el detalle.
export const MARCA_SIN_RESPUESTA = "Pidió hablar con una persona · sin responder";
