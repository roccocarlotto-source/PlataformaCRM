import { z } from "zod";
import { ESTADOS, type ServiceOrderStatus } from "../config/estados";

// ---------------------------------------------------------------------------
// Los eventos de la orden de servicio (docs/servicios.md §3.3 y §9, S8): las
// constantes, los schemas y el filtro de la regla. Puro, sin base: lo importa
// el catálogo de triggers (services/automationTriggers.ts).
//
//   - service_order.status_changed: cada vez que una orden ENTRA a un estado.
//     Un cambio de estado, y también la orden que nace directamente en Agendado
//     o Recibido (decisión de Rocco, 2026-10-15: muchas nacen en Recibido, con
//     el cliente sin turno, y "pasa a Recibido" tiene que dispararse ahí).
//     En ese caso `from` es null.
//   - service_order.delivered: la orden pasó a Entregado.
//
// Los dos solo con el módulo Servicios (MODULO_DEL_TRIGGER).
// ---------------------------------------------------------------------------

export const TRIGGER_ORDEN_CAMBIA_DE_ESTADO = "service_order.status_changed";
export const TRIGGER_ORDEN_ENTREGADA = "service_order.delivered";

const estadoSchema = z.enum(ESTADOS as [ServiceOrderStatus, ...ServiceOrderStatus[]], {
  errorMap: () => ({ message: "toStatuses tiene un estado que no existe" }),
});

/** La regla de "cambia de estado" dice a qué estados (al menos uno, sin
 *  repetir). Sin default: una regla que dispara en cada movimiento tiene que
 *  ser una decisión, no un olvido. */
export const configDelCambioDeEstadoSchema = z.object({
  toStatuses: z
    .array(estadoSchema, {
      required_error: "toStatuses es requerido",
      invalid_type_error: "toStatuses debe ser una lista de estados",
    })
    .min(1, "Elegí al menos un estado")
    .refine((lista) => new Set(lista).size === lista.length, "toStatuses tiene estados repetidos"),
});

export type ConfigDelCambioDeEstado = z.infer<typeof configDelCambioDeEstadoSchema>;

/** Lo que lleva el evento (§9). `from` null: la orden nació en ese estado. */
export const payloadDeLaOrdenSchema = z.object({
  serviceOrderId: z.string().uuid(),
  customerVehicleId: z.string().uuid(),
  contactId: z.string().uuid(),
  branchId: z.string().uuid(),
  from: estadoSchema.nullable(),
  to: estadoSchema,
  // Solo en service_order.delivered.
  deliveredAt: z.string().datetime().optional(),
});

export type PayloadDeLaOrden = z.infer<typeof payloadDeLaOrdenSchema>;

/** ¿La regla de "cambia de estado" corre con este evento? Solo si el destino
 *  está entre sus estados. Una config o un payload que no pasan el schema no
 *  corren (el dispatcher ya valida la config; esto no adivina). */
export function laReglaCorreConElCambio(config: unknown, payload: unknown): boolean {
  const regla = configDelCambioDeEstadoSchema.safeParse(config);
  const evento = payloadDeLaOrdenSchema.safeParse(payload);
  return regla.success && evento.success && regla.data.toStatuses.includes(evento.data.to);
}
